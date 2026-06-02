# LLD: Season Management

## Context

The Season Management module powers the My Team section of the app — a standalone nav section separate from the draft workflow. It connects a user's real Sleeper league (via Sleeper Sync) with the existing dynasty value data (KTC/FantasyCalc from the ETL pipeline) to deliver four tools: Roster Evaluator, Trade Analyzer, Trade Recommender, and Waiver Scorer. Each tool runs a structured algorithm pass first and then passes the scored output to Claude for contextual reasoning. Claude is never called with raw data alone — every Claude invocation receives an explicitly computed signal set.

Start/sit advice is explicitly out of scope for this module. It requires a weekly projections data source not present in the current ETL stack and is deferred to a future initiative.

Drives specs: `docs/specs/season-management-specs.md`

## Responsibilities

- Serve the My Team section: roster overview, trade analysis, trade recommendations, waiver recommendations
- Evaluate the user's roster against their league using dynasty values and positional comparisons
- Score individual trades (pending Sleeper offers) against five explicit signals
- Surface proactive trade opportunities by scanning all league rosters and grouping by roster need
- Score waiver wire adds paired with their optimal drop candidate
- Assemble structured algorithm output and pass it to Claude for contextual reasoning
- Trigger Sleeper sync on app load and on manual refresh

## Architecture

```
Express Server
    └── src/season/
            ├── router.ts              — Express route handlers
            ├── context.ts             — shared context assembly (roster + league state)
            ├── rosterEvaluator.ts     — grade + percentile scoring
            ├── tradeScorer.ts         — five-signal trade scoring
            ├── tradeRecommender.ts    — proactive opportunity scanner
            ├── waiverScorer.ts        — add/drop pair scoring
            └── seasonAdvisor.ts       — Claude reasoning layer
```

## API Surface

| Method | Path | Description |
|---|---|---|
| GET | `/season/:league_id/overview` | Roster grades, percentiles, team context |
| GET | `/season/:league_id/trades/pending` | Pending Sleeper trade offers with scores |
| POST | `/season/:league_id/trades/analyze` | Analyze a specific pending trade (with Claude) |
| GET | `/season/:league_id/trades/recommendations` | Proactive trade suggestions grouped by need |
| GET | `/season/:league_id/waivers` | Waiver add/drop pairs with scores |
| POST | `/season/:league_id/waivers/analyze` | Analyze a specific add/drop pair (with Claude) |

## Shared Context Assembly

Every tool in the Season Manager starts by assembling a `LeagueContext` object from SQLite. This is the ground truth passed into every scorer and every Claude call.

```ts
type LeagueContext = {
  league: SleeperLeague;            // settings, scoring format, roster positions
  userRoster: RosterEntry[];        // user's players with dynasty_value, age, position
  allRosters: TeamRoster[];         // all teams: roster_id, display_name, record, players
  freeAgents: PlayerWithValue[];    // players not on any roster, ranked by dynasty_value
  pendingOffers: SleeperTradeOffer[]; // from sleeper_trade_offers where status = 'pending'
  leagueMedians: PositionMedians;   // median dynasty_value per position across all rosters
};
```

`LeagueContext` is assembled once per request and passed down to all scorers. It is not cached — assembly reads from SQLite, which reflects the last Sleeper sync.

## Roster Evaluator

Grades the user's team by positional group. Runs on every `GET /season/:league_id/overview` call.

### Positional Grade Algorithm

For each position group (QB, RB, WR, TE):

1. **Value score:** Sum `dynasty_value` of all starters at that position on the user's roster (using the league's roster position config to determine starter count).
2. **Age curve score:** Weighted average age of starters at the position, inverted against a position-specific prime age baseline (QB: 27, RB: 24, WR: 25, TE: 26). Players 3+ years past their prime penalize the score; players 2+ years below peak prime receive a bonus.
3. **Depth score:** Ratio of the user's total positional value (starters + bench) to the league median for that position.
4. **Percentile rank:** The user's starter value sum ranked against all other teams in the league at the same position. `rank / (team_count - 1)` expressed as a 0–100 percentile.

### Letter Grade

Each position group receives a composite score from the three components (weighted: value 50%, depth 30%, age curve 20%). The composite maps to a letter grade:

| Composite (0–100) | Grade |
|---|---|
| 85–100 | A |
| 70–84 | B |
| 55–69 | C |
| 40–54 | D |
| 0–39 | F |

An overall team grade is the weighted average of position composites (weighted by league roster slot count per position).

### Response Shape

```ts
type RosterOverview = {
  overallGrade: LetterGrade;
  overallPercentile: number;
  teamContext: TeamContext;       // record, contender/rebuilder classification
  positions: {
    [position: string]: {
      grade: LetterGrade;
      percentile: number;
      valueScore: number;
      ageCurveScore: number;
      depthScore: number;
      starters: RosterEntry[];
    };
  };
};
```

The roster overview response does **not** include a Claude call — it is a pure algorithm output rendered as the landing view. Claude is invoked only when the user requests analysis of a specific trade or waiver opportunity.

## Trade Scorer

Scores each pending Sleeper trade offer against five signals. Used in `GET /season/:league_id/trades/pending` (all pending offers) and `POST /season/:league_id/trades/analyze` (single offer with Claude reasoning).

### Five-Signal Model

**1. Value Delta**
Sum of `dynasty_value` for all assets going out vs. all assets coming in. Positive = user wins in raw value. Pick values use the `pick_values` table (`year`, `round`). Player values use `players.dynasty_value`.

**2. Age Curve Score**
Directional age shift of the trade. Weighted mean age of assets received minus weighted mean age of assets sent. Negative = user is buying younger (good for rebuilds); positive = user is selling youth (good for contenders). Score is normalized against the league's average player age to contextualize the shift.

**3. Positional Need Gap**
Before and after comparison of the user's positional grade for each position affected by the trade. A trade that improves a C-grade position receives a positive need score; a trade that weakens an A-grade position receives a negative score. Magnitude scales with the severity of the gap being addressed or created.

**4. Team Context**
Contender/rebuilder classification derived from the user's record and the `teamContext` in the roster overview. A rebuilding team should favor value delta and age curve; a contending team should favor positional need and short-term impact. The scorer applies a multiplier to each signal based on team context (contender: need gap weight ×1.4, value delta ×0.8; rebuilder: age curve weight ×1.4, value delta ×1.2).

**5. Asset Liquidity**
Preference alignment between the assets involved and the inferred preferences of the other team. A team with many future picks is likely pick-averse; a team with few picks is likely pick-hungry. Scored as a match/mismatch signal: +1 if the trade sends what the other team likely wants, −1 if misaligned, 0 if neutral. Derived from the ratio of picks to players on each team's roster.

### Trade Score Object

```ts
type TradeScore = {
  transactionId: string;
  assetsOut: ScoredAsset[];
  assetsIn: ScoredAsset[];
  signals: {
    valueDelta: number;          // raw dynasty value delta (positive = user wins)
    ageCurveScore: number;       // age shift, normalized
    positionalNeedScore: number; // need gap improvement, normalized
    teamContextMultiplier: number;
    assetLiquidity: -1 | 0 | 1;
  };
  compositeScore: number;        // weighted sum of signals, normalized to -100..+100
  verdict: 'win' | 'loss' | 'neutral'; // compositeScore > +10 = win, < -10 = loss
};
```

The composite score is the final number passed to Claude. Claude does not recompute it — it interprets it.

### Claude Reasoning (analyze endpoint)

`POST /season/:league_id/trades/analyze` invokes Claude with the full `LeagueContext` and the `TradeScore` object. Claude's role is to explain *why* the composite score is what it is, surface non-obvious factors (schedule context, injury risk, the other team's situation), and give the user a clear recommendation with caveats.

**System prompt structure:**
1. Role: dynasty FF trade analyst — opinionated, grounded in the signal data, not generic
2. `LeagueContext` summary (user roster grades, team context, league median values)
3. `TradeScore` object with all five signal values
4. Instruction: explain the trade recommendation in terms of the signals; cite specific values; highlight the most decisive signal; surface at least one non-obvious factor; use the response format below

**Response format:**

```
**Verdict:** Win / Loss / Neutral

**Primary signal:** [Which of the five signals most drives this verdict and why]

**Key factors:**
- [Factor citing a specific signal value or roster context]
- [Factor]
- ...

**Non-obvious consideration:** [Something the signals don't directly capture — injury history, schedule, the other team's desperation, etc.]

**Recommendation:** [Single clear sentence]
```

## Trade Recommender

Scans all other teams' rosters to surface proactive trade opportunities. Results are grouped by the user's roster need. Called by `GET /season/:league_id/trades/recommendations`.

### Candidate Generation

For each other team in the league:
1. Identify the user's surplus positions (grade A or B positions where bench depth exceeds league median).
2. Identify the other team's surplus positions using the same grade logic.
3. A trade candidate is generated when: the user has surplus at a position the other team also has surplus at (so they can give something) AND the other team has surplus at a position the user grades C or below (so there's something to receive).
4. Each candidate is scored with the Trade Scorer's five-signal model.
5. Only candidates with `compositeScore > 0` (net positive for the user) are surfaced.

### Grouping

Candidates are grouped by the roster need they address:

- **WR targets** — trades that improve the user's WR grade
- **RB targets** — trades that improve the user's RB grade
- **QB targets** — trades that improve the user's QB grade
- **TE targets** — trades that improve the user's TE grade
- **Pick acquisitions** — trades that net the user future draft capital
- **Value sells** — trades where the user ships aging/surplus assets for youth or picks (sell-high opportunities)

Each group shows the top 3 candidates by composite score. Claude is not invoked on the full recommendations list — it is invoked when the user drills into a specific candidate via `POST /season/:league_id/trades/analyze`.

### Response Shape

```ts
type TradeRecommendations = {
  groups: {
    [groupKey: string]: {
      label: string;
      candidates: TradeCandidateWithScore[];
    };
  };
  lastComputedAt: string;
};
```

## Waiver Scorer

Scores free agent additions paired with their optimal drop candidate. Called by `GET /season/:league_id/waivers`.

### Add/Drop Pair Algorithm

For each free agent with `dynasty_value > 0`:
1. Identify the user's weakest position that matches the free agent's position.
2. Find the optimal drop candidate: the user's lowest `dynasty_value` player at that position who is not a starter (bench only). If the position is not over its roster limit, no drop is needed.
3. Score the swap:
   - **Value delta:** `free_agent.dynasty_value - drop_candidate.dynasty_value` (positive = net gain)
   - **Positional need:** same positional need gap signal as the Trade Scorer
   - **Age curve:** whether the add is younger than the drop
4. Only pairs with positive value delta AND a non-null drop candidate (or no drop needed) are surfaced.

Pairs are ranked by combined value delta + positional need score. Top 5 pairs per position group are returned.

### Claude Reasoning (analyze endpoint)

`POST /season/:league_id/waivers/analyze` invokes Claude with the pair's score object and the `LeagueContext`. Claude evaluates whether the swap is net-positive in context — factoring in the user's competitive window, the drop candidate's role, and any non-obvious considerations about the free agent.

**Response format:** Same structure as trade analysis (Verdict / Primary signal / Key factors / Non-obvious / Recommendation).

## Season Advisor (Claude Layer)

`src/season/seasonAdvisor.ts` is the shared Claude invocation module used by both the trade and waiver analyze endpoints. It owns prompt assembly, Claude API calls, and response parsing.

**Model:** `claude-sonnet-4-6`

**Prompt caching:** The `LeagueContext` summary (roster grades, team context, league medians) is cached as a prefix across calls within a session. The trade or waiver score object is the uncached dynamic suffix.

**Context size discipline:** The full player pool is never sent to Claude. The context includes: the user's roster (positions, values, grades), the counterparty's roster (positions, values), league median values per position, and the score object. All other teams are summarized as aggregates only.

**Error handling:** If the Claude API call fails, the analyze endpoint returns the raw score object with a `claudeUnavailable: true` flag. The client renders the signal scores directly without the narrative. This ensures the algorithmic output is always available even when Claude is not.

## UI Integration

The My Team section is a standalone top-level nav section. It does not share state with the draft context.

**Landing view — Roster Overview:**
- Renders the `RosterOverview` response: overall grade + percentile as the header, per-position breakdown below
- Contender/rebuilder mode badge derived from `teamContext`
- Manual refresh button triggers `POST /sleeper/sync` and then re-fetches the overview
- League connection prompt shown if no leagues are connected

**Pending Offers:**
- Lists pending Sleeper trade offers with `verdict` badge (Win / Loss / Neutral) from the pre-computed `TradeScore`
- "Analyze" button on each offer triggers `POST /season/:league_id/trades/analyze` and renders Claude's reasoning inline
- Link out to Sleeper to act on the trade

**Trade Recommendations:**
- Grouped accordion by need category
- Each candidate shows: the other team, assets proposed (user sends X, receives Y), composite score
- "Analyze" button drills into the full Claude analysis

**Waiver Wire:**
- Add/drop pairs ranked by score
- Each row: free agent name + position + value, drop candidate name + position + value, value delta badge
- "Analyze" button triggers Claude reasoning for the pair

## Decisions

| Decision | Chosen | Alternatives | Rationale |
|---|---|---|---|
| Algorithm-first Claude | Structured score object → Claude reasoning | LLM-only recommendations | Every suggestion is traceable to explicit signals; Claude explains rather than invents; ensures grounding even if Claude is unavailable |
| Roster overview without Claude | Pure algorithm output | Claude on every page load | Overview is high-frequency (loads on every visit); Claude cost and latency are only justified when the user is actively evaluating a specific decision |
| Five-signal trade model | Value delta + age curve + positional need + team context + asset liquidity | Value delta only | Single-signal trade evaluation is exactly what Sleeper already provides; the multi-signal model is the differentiated value |
| Composite score normalization | -100 to +100 with ±10 neutral band | Raw weighted sum | Normalized score is immediately interpretable by both the UI and Claude; the neutral band avoids false precision on marginal trades |
| Trade recommendation grouping | By roster need | Flat ranked list | Need-based grouping matches how dynasty managers think; makes the "why" self-evident without requiring Claude on the list view |
| Waiver add/drop pairing | Always pair add with optimal drop | Add-only | An add recommendation that ignores what you'd have to drop is incomplete; pairing is mandatory for actionability |
| Claude context size | User roster + counterparty roster + league medians + score object | Full league rosters | Full league context inflates token cost with data irrelevant to the specific decision; medians capture league context compactly |
| Prompt caching | Cache `LeagueContext` prefix | No caching | League context is stable within a session; caching reduces latency and cost on multi-trade analysis sessions |
| Start/sit | Deferred | In scope | Requires a weekly projections source not in the current ETL stack; separate initiative |

## Open Questions

- [ ] Should the trade recommendations be recomputed on every request or cached for a configurable TTL (e.g., 1 hour)?
- [ ] How should the Roster Evaluator handle taxi squad and IR players — include in depth scoring or exclude from grades?
- [ ] Should the age curve baseline ages be configurable per league (e.g., superflex leagues value QBs differently)?
- [ ] Should Claude's reasoning be persisted to SQLite so the user can review past analyses, or always recomputed on demand?
