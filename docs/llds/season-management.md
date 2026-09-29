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

The domain logic lives in `src/season/`; the Express handlers live in `src/server/season-routes.ts` alongside the other route factories (`sleeper-routes.ts`, `app.ts`), following the repo's established server-module convention.

```
Express Server (src/server/season-routes.ts, registered in app.ts)
    └── src/season/
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
| POST | `/season/:league_id/trades/analyze` | Analyze a pending trade or a hypothetical candidate (with Claude) |
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

### Component Normalization

Each position component is produced on a 0–100 scale before weighting, so the composite maps cleanly to letter grades:

- **Value score (SM-011):** raw sum of starter `dynasty_value` at the position. For the composite it is normalized as `100 × (userSum / leagueMaxSum)` across all teams at that position (`50` when the league max is 0). The raw sum is also returned.
- **Age curve score (SM-012):** per starter, `clamp(50 + 20 × (prime − age), 0, 100)` — players 2+ years below prime score ≥ 90 (bonus), players 3+ past prime score ≤ 10 (penalty). The position score is the `dynasty_value`-weighted mean of per-player scores (unweighted mean when total weight is 0; starters with `age = NULL` score neutral 50).
- **Depth score (SM-013):** ratio of the user's total positional value to the league median, mapped as `clamp(100 × ratio / 2, 0, 100)` — 2× the median scores 100, at-median scores 50. When the league median is 0: `100` if the user has value, else `50`.
- **Percentile (SM-014):** `100 × (teams strictly below) / (teamCount − 1)`; `50` when the league has a single team.
- **Overall percentile:** every team's overall composite is computed with the same algorithm, then percentile-ranked.

### Taxi / IR handling

Taxi-squad players count toward the **depth score** only. IR players are excluded from every grade component (value, age, depth, percentile) but remain in roster display data. Starter determination uses the `slot_type` recorded by Sleeper Sync (`starter` slots; flex starters attribute to their natural position group).

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
      composite: number;        // 0–100 weighted composite the grade derives from
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

Scores each pending Sleeper trade offer **involving the user's roster** against five signals. Offers between two other teams are excluded — the five-signal model is strictly the user's perspective (value delta "for the user" is undefined for third-party trades). Used in `GET /season/:league_id/trades/pending` (all pending offers involving the user) and `POST /season/:league_id/trades/analyze` (single offer with Claude reasoning).

### Asset Direction

A pending offer's assets are attributed to the user by direction, using Sleeper's transaction payload:

- **Players** — `adds[player_id] = receiving_roster_id`, `drops[player_id] = giving_roster_id`. The user **receives** players where `adds[id] === user_roster_id`; the user **sends** players where `drops[id] === user_roster_id`.
- **Picks** — each pick object carries `roster_id` (the pick's origin), `previous_owner_id`, and `owner_id` (post-trade owner). The user **receives** picks where `owner_id === user_roster_id`; the user **sends** picks where `previous_owner_id === user_roster_id`.

`GET /season/:league_id/trades/pending` is scoped to offers where the user's roster is the proposer or one of the responders (DFF-SM-030); third-party offers have no defined user value delta and are excluded.

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

### Signal Normalization

Every signal is expressed on the −100…+100 scale before weighting, so the composite is directly interpretable and the ±10 verdict band is meaningful.

| Signal | Formula | Base weight |
|---|---|---|
| **valueDelta** | `raw = Σ value(assets in) − Σ value(assets out)`; `normalized = clamp(100 × raw / max(userRosterValue, 1), −100, 100)`. Player value = `players.dynasty_value`; pick value = the `pick_values` row for `(year, round)` with `pick_in_round = 0`. | 0.5 |
| **ageCurveScore** | `raw = weightedMeanAge(in) − weightedMeanAge(out)` (weights = dynasty value; unweighted when total weight is 0); `normalized = clamp(100 × raw / leagueAveragePlayerAge, −100, 100)`. Positive = buying older. The composite uses **−ageCurveScore** (getting younger raises the score). | 0.2 base, ×1.4 rebuilder |
| **positionalNeedScore** | Apply the trade to the user's roster (players only) and re-evaluate with that roster replaced in place, so league-wide normalization stays consistent; received players fill a vacant starting slot at their position when one exists (per the league's roster positions), otherwise bench. `raw = Σ over affected positions (composite_after − composite_before)`; `normalized = clamp(raw, −100, 100)`. Picks do not affect positional grades, so a picks-only trade scores 0. | 0.2, ×1.4 contender |
| **assetLiquidity** | Counterparty pick-to-player ratio = `heldPicks / max(rosteredPlayers, 1)`; pick-hungry when below half the league-median ratio, pick-averse when above 1.5×. Then `+100` if the assets the user sends match what that counterparty wants (sends picks to a pick-hungry team, or players to a pick-averse team), `−100` if misaligned, `0` when neutral or unknown. | 0.1 |
| **teamContextMultiplier** | Value delta: ×0.8 contender, ×1.2 rebuilder. Positional need: ×1.4 contender. Age (already sign-inverted): ×1.4 rebuilder. Weights are renormalized by their sum. | — |

`compositeScore = clamp(Σ (weighted signals) / Σ weights, −100, 100)`; verdict `win` when composite > +10, `loss` when < −10, otherwise `neutral` (DFF-SM-037/038).

Picks with no matching `pick_values` row contribute 0 and add a warning entry to the `TradeScore` (DFF-SM-082).

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

The recommender needs two per-team measures, both computed from the same Roster Evaluator math used by the overview (other teams are graded by evaluating the same `LeagueContext` with `userRosterId` pointed at each team):

- **Letter grade** at each of QB/RB/WR/TE (composite → A/B/C/D/F bands).
- **Surplus** (DFF-SM-051): grade A or B **and** bench depth — combined dynasty value of bench + taxi players at the position, IR excluded — strictly greater than the league-median bench depth at that position (median across all teams of the same bench-depth measure).

For each other team `T`:

1. Compute `T`-needs = positions where `T` grades C or below, and `T`-surplus = positions where `T` has surplus.
2. Compute the user's surplus positions and need positions (grade C or below).
3. **Player swap** — for each `(P, Q)` where `P` is a user-surplus position `T` needs and `Q` is a `T`-surplus position the user needs: outbound = the user's most valuable non-starter (bench or taxi, IR excluded) at `P`; inbound = `T`'s non-starter at `Q` with dynasty value closest to the outbound asset (ties break to the higher value, then lower player ID, for determinism).
4. **Pick acquisition** — for each user-surplus position `P` that `T` needs: outbound = the user's most valuable non-starter at `P`; inbound = `T`'s most valuable owned future pick (highest `pick_values` entry across `T`'s owned picks in the next three seasons, from the pick inventory that also feeds the liquidity signal).
5. **Value sell** — for each position `P` where the user has a player aged 30+ and `T` grades C or below at `P`: outbound = the user's most valuable player aged 30+ at `P` (starters allowed — selling a declining starter is the point); inbound = `T`'s most valuable owned future pick.

Candidates are deduplicated by the `(T, outbound, inbound)` triple. A candidate with no eligible inbound asset (e.g. `T` owns no future picks, or has no non-starter at `Q`) is skipped. Every candidate is scored with the same five-signal Trade Scorer; only candidates with `compositeScore > 0` are surfaced (DFF-SM-053).

Each candidate carries a hypothetical offer payload so the UI can send it straight to `POST .../trades/analyze`: the counterparty is the proposer, the user the sole responder, `adds`/`drops` carry the player legs keyed by Sleeper player ID, pick legs ride in `draft_picks` with `previous_owner_id` = counterparty and `owner_id` = user, and the `transactionId` is synthetic and negative (e.g. `-101`) so it can never collide with a real Sleeper transaction ID.

### Grouping

Candidates are assigned to exactly one group by precedence:

1. **Value sells** (`sell`) — the outbound asset is a player aged 30+ (DFF-SM-088).
2. **Pick acquisitions** (`picks`) — the inbound assets include a future pick.
3. **Position targets** (`wr` / `rb` / `qb` / `te`) — grouped by the inbound player's position.

The response always includes all six group keys (empty arrays when a group has no candidates) so clients get a stable shape. Each group is capped at its top 3 candidates by composite score descending (DFF-SM-055). Claude is not invoked on the recommendations list — it is invoked when the user drills into a specific candidate via `POST /season/:league_id/trades/analyze` with the candidate's `offer` payload.

### Response Shape

```ts
type TradeCandidateWithScore = {
  teamRosterId: number;
  teamName: string;
  group: 'qb' | 'rb' | 'wr' | 'te' | 'picks' | 'sell';
  rationale: string;   // e.g. "Swap surplus WR depth for RB help"
  score: TradeScore;
  offer: SleeperTradeOffer;  // hypothetical — POST it to /trades/analyze
};

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
| Claude client | Raw `fetch` + injectable `fetchImpl`, `ANTHROPIC_API_KEY`, `cache_control: ephemeral` | `@anthropic-ai/sdk` | Mirrors the Sleeper client pattern; no new dependency; fully testable offline with a stubbed fetch (CI needs no key) |
| Claude unavailable | Return the raw score with `claudeUnavailable: true` | Fail the request | The algorithmic output is always useful; the narrative is an enhancement (DFF-SM-043) |
| Asset liquidity input | Synced traded-pick inventory (`sleeper_traded_picks`) | Infer from transaction history | Authoritative and cheap; avoids a signal that always reads neutral (DFF-SLS-090/091) |
| Trade recommendation grouping | By roster need | Flat ranked list | Need-based grouping matches how dynasty managers think; makes the "why" self-evident without requiring Claude on the list view |
| Waiver add/drop pairing | Always pair add with optimal drop | Add-only | An add recommendation that ignores what you'd have to drop is incomplete; pairing is mandatory for actionability |
| Claude context size | User roster + counterparty roster + league medians + score object | Full league rosters | Full league context inflates token cost with data irrelevant to the specific decision; medians capture league context compactly |
| Prompt caching | Cache `LeagueContext` prefix | No caching | League context is stable within a session; caching reduces latency and cost on multi-trade analysis sessions |
| Start/sit | Deferred | In scope | Requires a weekly projections source not in the current ETL stack; separate initiative |
| Pending offers scope | Offers involving the user's roster only | All pending league offers | The five-signal model is user-perspective; third-party trades have no defined user value delta |
| Trade recommendations caching | Recomputed on every request | TTL cache (e.g., 1 hour) | Pure SQLite reads + in-memory math; consistent with fresh-context-per-request (SM-071); `lastComputedAt` stays accurate |
| Recommender matching condition | Outbound position must be one the *counterparty grades C or below* | Original SM-052 wording: counterparty *also has surplus* there | Amended spec: a team deep at a position has no reason to acquire more of it; the original condition produced candidates no counterparty would accept |
| Surplus definition | Bench depth (bench + taxi value, IR excluded) > league-median *bench depth* | Bench depth > league-median total positional value | The median comparison must be symmetric for the threshold to be meaningful; comparing bench value against other teams' full positional value would make surplus nearly unattainable |
| Hypothetical offer IDs | Synthetic negative transaction IDs on candidate offers | Hash/UUID strings | `SleeperTradeOfferRecord.transactionId` is numeric; negatives cannot collide with Sleeper IDs |
| Analyzing a candidate | `POST /trades/analyze` accepts `{ trade_offer: … }` alongside `{ transaction_id }` | Score candidates client-side; or persist hypothetical offers | Keeps one scoring path (the same five-signal scorer) and honors SM-056 (Claude only on explicit Analyze) without persisting speculative rows |
| Taxi/IR in grades | Taxi counts toward depth score; IR excluded from grades | Include both; exclude both | Taxi is real developmental depth (the essence of dynasty); IR contributes nothing near-term |
| Age curve baselines | Fixed constants (QB 27, RB 24, WR 25, TE 26) | Per-league configurable | Superflex skews value weighting more than age primes; no proven need for config surface |
| Claude reasoning persistence | Recomputed on demand | Persist to SQLite | Scores recompute from fresh syncs; persisted narratives could contradict changed scores |
| Percentile with single team | 50 (neutral) | 0 or 100 | One team is simultaneously best and worst; neutral avoids misleading extremes |

