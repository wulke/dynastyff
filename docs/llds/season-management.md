# LLD: Season Management

## Context

The Season Management module powers the My Team section of the app — a standalone nav section separate from the draft workflow. It connects a user's real Sleeper league (via Sleeper Sync) with the existing dynasty value data (KTC/FantasyCalc from the ETL pipeline) to deliver four tools: Roster Evaluator, Trade Analyzer, Trade Recommender, and Waiver Scorer. Each tool runs a structured algorithm pass first and then passes the scored output to Claude for contextual reasoning. Claude is never called with raw data alone — every Claude invocation receives an explicitly computed signal set.

Start/sit advice is explicitly out of scope for this module. It requires a weekly projections data source not present in the current ETL stack and is deferred to a future initiative.

Drives specs: `docs/specs/season-management-specs.md`

## Responsibilities

- Serve the My Team section: roster overview, trade analysis, trade recommendations, waiver recommendations
- Evaluate the user's roster against their league using dynasty values and positional comparisons
- Score individual trades (pending Sleeper offers) against five explicit signals
- Classify every team as contender / middle / rebuilder and judge whether a counterparty would plausibly accept a trade (Acceptance Model)
- Surface proactive trade opportunities by scanning all league rosters, gated by the Acceptance Model and grouped by move type
- Let Claude curate and reshape trade offers through read-only tools, never returning an offer that fails the gate (Trade Curator)
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
            ├── teamClassifier.ts      — contender / middle / rebuilder tiers + manager activity
            ├── acceptanceModel.ts     — team-perceived value, gate, likelihood, mutual ranking
            ├── tradeRecommender.ts    — move-type candidate generator (gated, value-matched)
            ├── tradeCurator.ts        — Claude tool loop over the gated pool
            ├── waiverScorer.ts        — add/drop pair scoring
            └── seasonAdvisor.ts       — Claude reasoning layer
```

## API Surface

| Method | Path | Description |
|---|---|---|
| GET | `/season/:league_id/overview` | Roster grades, percentiles, team context |
| GET | `/season/:league_id/trades/pending` | Pending Sleeper trade offers with scores |
| POST | `/season/:league_id/trades/analyze` | Analyze a pending trade or a hypothetical candidate (with Claude) |
| GET | `/season/:league_id/trades/recommendations` | Proactive trade suggestions, gated by the Acceptance Model, grouped by move type |
| POST | `/season/:league_id/trades/curate` | Claude curates and reshapes offers for a candidate or a counterparty (cached) |
| GET | `/season/:league_id/untouchables` | The user's untouchable assets |
| PUT | `/season/:league_id/untouchables` | Replace the user's untouchable assets |
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
  // Added for the Acceptance Model:
  //   TeamRoster gains pointsFor, totalMoves, waiverBudgetUsed (from sleeper_teams);
  //   RosterEntry/PlayerWithValue gain redraftValue (players.redraft_value, nullable);
  //   completedTrades: SleeperTradeOfferRecord[]  — status = 'complete', this season;
  //   untouchables: AssetRef[];                    — trade_untouchables for the user;
  //   tradeSettings: { acceptanceBand: number };   — league_trade_settings, default 0.10
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
  teamContext: TeamContext;       // win-now tier classification and inputs
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

## Team Classifier

Replaces the win%-only `classifyTeamContext` for **every** team, the user's and each counterparty's (map decision: [acceptance model](https://github.com/wulke/dynastyff/issues/214)). Lives in `src/season/teamClassifier.ts`.

### Tiers

Each team gets a `winNowScore` in 0–1 from three league-relative percentiles (0 = worst, 1 = best; ties share the mean rank):

| Input | Source |
|---|---|
| `strengthPct` | Percentile of summed starter `dynasty_value` (Roster Evaluator starters, IR excluded) |
| `pointsForPct` | Percentile of `sleeper_teams.points_for` |
| `winPct` | Percentile of win% (ties count half); 0.5 for every team before any games are played |

Weights shift with season progress `p = min(gamesPlayed / 8, 1)`, where `gamesPlayed` is the league's maximum `wins + losses + ties`:

```
w_strength = 0.6 − 0.3p     // 0.6 at week 0 → 0.3 from week 8
w_points   = 0.2 + 0.1p     // 0.2 → 0.3
w_record   = 0.2 + 0.2p     // 0.2 → 0.4
winNowScore = w_strength·strengthPct + w_points·pointsForPct + w_record·winPct
```

Tier: `contender` when `winNowScore ≥ 0.6`, `rebuilder` when `≤ 0.4`, otherwise `middle`. All thresholds are tunable constants.

```ts
type TeamTier = 'contender' | 'middle' | 'rebuilder';
type TeamClassification = {
  tier: TeamTier;
  winNowScore: number;          // 0–1
  inputs: { strengthPct: number; pointsForPct: number; winPct: number; gamesPlayed: number };
};
```

`RosterOverview.teamContext` carries the classification, so the overview badge shows contender / middle / rebuilder.

### Manager Activity

Activity uses only data Sleeper Sync already fetches: `roster.settings.total_moves`, `roster.settings.waiver_budget_used`, and this season's completed trades (`sleeper_trade_offers.status = 'complete'`).

- `dormant`: zero moves, zero FAAB spent, and zero completed trades, once `gamesPlayed ≥ 3`.
- `low`: moves are below a quarter of the league median.
- `active`: everything else, and every team before week 3.

## Acceptance Model

Decides whether a counterparty would plausibly accept a trade, and how likely they are to. Lives in `src/season/acceptanceModel.ts` and is shared by the Trade Recommender and the Trade Curator's `evaluate_trade` tool. The user-side five-signal Trade Scorer is unchanged.

### Team-Perceived Value

Each team values an asset as a blend of dynasty and redraft value, weighted by its tier:

```
perceived(asset, team) = (1 − r)·dynastyValue + r·redraftValue
r = 0.50 contender | 0.25 middle | 0.10 rebuilder
```

- **Players:** `redraftValue` is `players.redraft_value` (FantasyCalc redraft, normalized 0–9999; see the ETL pipeline LLD). When it is null, `perceived = dynastyValue` and the evaluation carries a `missingRedraft` warning.
- **Picks:** a pick has no redraft value (`redraftValue = 0`). Contenders also discount picks beyond the next rookie draft by 10% per extra year. Pick `dynastyValue` comes from `pick_values` on the player-aligned scale (prerequisite bug [#221](https://github.com/wulke/dynastyff/issues/221)).

### Roster-Spot Credit

When piece counts differ, the side receiving **fewer** pieces is credited for the roster spots the other side has to fill, FantasyCalc style:

```
extra = |piecesA − piecesB|
credit = Σ min(0.698 · v_i, SPOT_CAP)  over the `extra` lowest-valued pieces of the larger side
SPOT_CAP = 700                          // FantasyCalc's 753 rescaled from its ~10,839 max to our 9,999 scale
```

`v_i` is in the evaluating team's perceived values.

### Gate

From counterparty `T`'s perspective, in `T`'s perceived values:

```
give = Σ perceived(assets T sends, T)
get  = Σ perceived(assets T receives, T) + creditFor(T)
lossPct = (give − get) / max(give + get, 1)
pass ⇔ lossPct ≤ band
```

`band` defaults to **0.10** and is stored per league (`league_trade_settings.acceptance_band`). A trade the user would propose must **also** have a user composite > 0 from the five-signal Trade Scorer. Both conditions together form `passesGate`.

### Likelihood

A 0–100 score for trades that pass the gate. All weights are tunable constants.

```
F = 100 · clamp((band − lossPct) / (2·band), 0, 1)     // fairness margin: 0 at the band edge, 100 when T wins by ≥ band
N = clamp(50 + Σ_pos (T.composite_after − T.composite_before), 0, 100)
                                                         // need fit: T re-graded by the Roster Evaluator with the trade applied
C = context fit (below)
A = 1.0 active | 0.85 low | 0.6 dormant                 // activity multiplier
likelihood = A · (0.5·F + 0.25·N + 0.25·C)
```

**Context fit C** is the share of perceived value `T` receives that suits `T`'s tier, ×100:
- **contender:** win-now players (see the vet rule under Trade Recommender).
- **rebuilder:** picks, plus players at or below their position's prime age + 1 (the Roster Evaluator's prime ages).
- **middle:** a constant 50.

```ts
type AcceptanceEvaluation = {
  counterpartyRosterId: number;
  counterpartyTier: TeamTier;
  activity: 'active' | 'low' | 'dormant';
  give: number; get: number; credit: number;
  lossPct: number; band: number;
  passesGate: boolean;            // lossPct ≤ band AND user composite > 0
  likelihood: number;             // 0–100; 0 when the gate fails
  components: { fairness: number; needFit: number; contextFit: number; activity: number };
  warnings: string[];             // e.g. missingRedraft
};
```

### Mutual-Benefit Ranking

```
userScore   = clamp(TradeScore.compositeScore, 0, 100)
mutual      = min(userScore, likelihood) × tierBoost
tierBoost   = 1.15 when the move type fits the user's tier, else 1.0
```

The fitting move types are: rebuilder → sell vets and split; contender → buy vets and consolidate; middle → none. Each card shows both `userScore` and `likelihood`.

## Trade Recommender

Scans every other team and produces gated, ranked trade suggestions. Called by `GET /season/:league_id/trades/recommendations`. Map decision: [move types](https://github.com/wulke/dynastyff/issues/218).

### Asset Eligibility

- **User side:** every non-IR player and every owned future pick (next three seasons), except assets on the user's **untouchables** list (`trade_untouchables`). Starters are eligible.
- **Counterparty side:** every non-IR player and owned future pick.
- **Win-now (vet) rule:** a player is a vet when `redraft_value ≥ 1.2 × dynasty_value`. When `redraft_value` is null, the fallback is age ≥ QB 32 / RB 27 / WR 29 / TE 29.

### Move Types

For each counterparty `T` (classified by the Team Classifier), generate candidates for four move types:

1. **Sell vets** (`sell`): for each eligible user vet `V`, when `T` is `contender` or `middle`: outbound `V`, inbound value-matched from `T`'s picks and non-vet players.
2. **Buy vets** (`buy`): for each `T` vet, when `T` is `rebuilder` or `middle`: inbound that vet, outbound value-matched from the user's picks and non-vet players.
3. **Positional swap** (`swap`): for positions `P ≠ Q` where the user is **relatively deeper** at `P` (user composite − `T` composite ≥ 10) and `T` is relatively deeper at `Q` (`T` composite − user composite ≥ 10): outbound one user player at `P`, inbound a value-matched `T` player at `Q`. No A/B surplus is required.
4. **Consolidate / split** (`consolidate`):
   - *Consolidate:* user sends 2 assets for 1 `T` player worth more than either.
   - *Split:* user sends 1 player for 2 `T` assets.
   - Both are value-matched with the roster-spot credit applied.

### Value Matching

The inbound side (or the outbound side for buy vets) is chosen to bring the trade **closest to even** for `T`, by minimizing `|lossPct|` among options that pass the gate. It is never "their most valuable pick".

- Algorithmic packages are capped at **2 assets per side**.
- Search singles first, then pairs drawn from the 12 assets closest in perceived value to the target.
- Determinism: ties break on higher mutual score, then lower asset id.

Every candidate is evaluated by the Acceptance Model and scored by the Trade Scorer. **Only `passesGate` candidates survive.**

### Grouping and Diversity

- **Groups:** `sell` (Sell vets) / `buy` (Buy vets) / `swap` (Swaps) / `consolidate` (Consolidate / split). All four keys are always present.
- **Within a group:** sort by `mutual` descending, keep up to **3**, and use each user asset at most once (skip and take the next).
- **Across groups:** at most **2** suggestions per counterparty. When a counterparty would exceed 2, the lowest-`mutual` suggestion is dropped and its group backfills.
- **Curator pool:** the top **25** gated candidates by `mutual`, before diversity, are also returned to the server-side curator. They are not sent to the client.

Recomputed on every request (unchanged, DFF-SM-085). Candidates keep the hypothetical `offer` payload (synthetic negative transaction ids) so `POST /trades/analyze` still works.

### Response Shape

```ts
type TradeMoveGroup = 'sell' | 'buy' | 'swap' | 'consolidate';

type TradeCandidateWithScore = {
  candidateId: string;              // stable hash of (T, outbound ids, inbound ids)
  teamRosterId: number;
  teamName: string;
  counterpartyTier: TeamTier;
  group: TradeMoveGroup;
  rationale: string;                // e.g. "Sell Christian McCaffrey to contender for draft capital"
  score: TradeScore;                // user side, unchanged
  acceptance: AcceptanceEvaluation; // counterparty side
  userScore: number;                // 0–100
  likelihood: number;               // 0–100
  mutual: number;
  offer: SleeperTradeOffer;         // hypothetical; POST to /trades/analyze or /trades/curate
};

type TradeRecommendations = {
  userTier: TeamTier;
  groups: Record<TradeMoveGroup, { label: string; candidates: TradeCandidateWithScore[] }>;
  lastComputedAt: string;
};
```

## Trade Curator (Claude)

Claude acts as a **curator with tools**. It selects from the gated algorithmic pool, reshapes offers (adds a sweetener, swaps a piece, builds a package of any size), and explains both sides. It never invents offers outside the gate. Map decision: [Claude's role](https://github.com/wulke/dynastyff/issues/215). Lives in `src/season/tradeCurator.ts`.

### Endpoint

`POST /season/:league_id/trades/curate`, with body `{ candidate_id }` **or** `{ team_roster_id }`.

- **`candidate_id`:** the candidate plus up to 5 other pool candidates with the same counterparty.
- **`team_roster_id`:** every pool candidate with that counterparty (up to 10).

The pool is recomputed server-side, so the client can only *select* a scope. An empty pool for a team still runs: Claude may try to build an offer from scratch through the tools.

### Tools

| Tool | Input | Output |
|---|---|---|
| `get_team` | `roster_id` | Roster (name, position, age, dynasty/redraft/perceived value, slot), owned picks, tier, positional grades, activity. Untouchables are flagged on the user team. |
| `get_asset_value` | `asset`, `perspective_roster_id` | Dynasty, redraft, and perceived value for that team |
| `evaluate_trade` | `offer` (`{ user_sends: AssetRef[], user_receives: AssetRef[], counterparty_roster_id }`) | `AcceptanceEvaluation` + user `TradeScore` + `mutual`, or a validation error (asset not owned, untouchable, duplicated, IR) |
| `submit_offers` | `{ offers: { offer, headline, rationale }[], near_misses: string, summary: string }` | Terminal. It ends the loop. |

All tools are read-only. `evaluate_trade` is the same code path as the recommender's gate.

### Loop

- **Model:** `claude-sonnet-5-5`.
- **System prefix (cached):** role, LeagueContext summary, user tier/needs, counterparty summaries. **Dynamic suffix:** the scoped pool as JSON.
- **Budget:** at most **8** tool turns. If `submit_offers` hasn't been called by then, the loop ends and the pool's top candidates are returned with `curatorIncomplete: true`. The per-run token budget is still open on the map.
- **Client:** the existing raw-`fetch` Claude client, extended with tool definitions and a manual tool loop. Implementation follows the `/claude-api` skill.

### Guardrail (server-side)

After `submit_offers`, the server re-runs `evaluate_trade` on every submitted offer.

- Offers failing `passesGate` are **removed** before the response. Claude's prose stays, but the offer card does not.
- Near-misses can only appear in `near_misses` text. They are never returned as offer objects.

### Caching

Results are stored in `trade_curation_cache`, keyed by `(league_id, scope, last_synced_at, values_updated_at, untouchables_hash)`. A new Sleeper sync, value refresh, or untouchables change naturally misses the cache.

```ts
type CuratedOffer = {
  offer: SleeperTradeOffer;
  headline: string;
  rationale: string;          // Claude, both sides
  evaluation: AcceptanceEvaluation;
  score: TradeScore;
  mutual: number;
};
type TradeCuration = {
  scope: { candidateId?: string; teamRosterId?: number };
  offers: CuratedOffer[];
  nearMisses: string;
  summary: string;
  curatorIncomplete: boolean;
  claudeUnavailable: boolean; // on API failure: offers = the scoped pool's top 3, no prose
  cachedAt: string;
};
```

### Untouchables

`GET /season/:league_id/untouchables` and `PUT /season/:league_id/untouchables` with body `{ assets: AssetRef[] }`.

- The list is stored in `trade_untouchables (league_id, asset_kind, asset_id)`.
- It applies to the **user's** assets only.
- Assets no longer on the user's roster are ignored at read time and pruned on the next PUT.

## Waiver Scorer

Scores free agent additions paired with their optimal drop candidate. Called by `GET /season/:league_id/waivers`.

### Add/Drop Pair Algorithm

For each free agent with `dynasty_value > 0` (pool capped at the top 50 by dynasty value — waivers are about the best available, not the whole player universe):
1. The free agent's position is the target position group for the add.
2. Determine whether a drop is required: the roster is *over its limit* when the user's non-IR player count is at or above the league's total slot count (`roster_positions.length`, which includes bench slots). Under the limit → no drop required. Over the limit → the drop candidate is the user's lowest-`dynasty_value` bench player at the same position (bench only — taxi is developmental depth and is never a waiver drop); if there is no bench player at that position while over the limit, the pair is skipped.
3. Score the pair:
   - **Value delta:** `free_agent.dynasty_value - drop_candidate.dynasty_value` (`0` when no drop is required); normalized to the trade scorer's scale (`100 × delta / user non-IR roster value`, clamped ±100).
   - **Positional need:** the same before/after composite-diff signal as the Trade Scorer — the post-add roster (drop removed, free agent added with the slot-fill rule from DFF-SM-034: vacant starting slot at the position, else bench) is re-evaluated and the target position's composite delta becomes the score.
   - **Age curve:** `+1` when the add is younger than the drop, `−1` when older, `0` on ties, unknown ages, or no drop. Reported as a signal; not part of the ranking.
4. Only pairs with a strictly positive value delta AND a valid drop (or no drop required) are surfaced.

Ranking score = normalized value delta + positional need score. Pairs are ranked by it descending, capped at 5 per position group. The response is recomputed on every request (mirroring DFF-SM-085) and carries the actual computation time.

### Response Shape

```ts
type WaiverPair = {
  add: { id, name, position, age, dynastyValue };   // players-table free agent
  drop: { id, name, position, age, dynastyValue } | null;
  valueDelta: number;                                // raw dynasty points
  score: {
    valueDeltaScore: number;                         // normalized ±100
    positionalNeedScore: number;
    ageCurve: -1 | 0 | 1;
    rankScore: number;                               // valueDeltaScore + positionalNeedScore
  };
};

type WaiverPairs = {
  pairs: WaiverPair[];        // flat, rankScore descending, ≤5 per position group
  lastComputedAt: string;
};
```

### Claude Reasoning (analyze endpoint)

`POST /season/:league_id/waivers/analyze` accepts `{ add_player_id, drop_player_id? }` (players-table IDs from the pair listing; omit `drop_player_id` for no-drop pairs). The pair is re-derived server-side — the add must currently be a free agent in the connected league and the drop, when present, a bench player on the user's roster — so client payloads can only select, never fabricate, a pair. Claude is invoked with the pair's score object and the `LeagueContext` (user roster, league medians, the pair — there is no counterparty roster in a waiver swap). Claude evaluates whether the swap is net-positive in context — factoring in the user's competitive window, the drop candidate's role, and any non-obvious considerations about the free agent.

**Response format:** Same structure as trade analysis (Verdict / Primary signal / Key factors / Non-obvious / Recommendation).

## Season Advisor (Claude Layer)

`src/season/seasonAdvisor.ts` is the shared Claude invocation module used by both the trade and waiver analyze endpoints. It owns prompt assembly, Claude API calls, and response parsing.

**Model:** `claude-sonnet-5-5` for both the analyze endpoints and the Trade Curator loop (upgraded from `claude-sonnet-4-6`).

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
- Grouped by move type: Sell vets / Buy vets / Swaps / Consolidate. The header shows the user's tier.
- Each candidate shows: the other team and its tier, assets (user sends X, receives Y), **your score** and **their likelihood**.
- "Analyze" drills into the existing Claude analysis. "Work this with Claude" (per candidate, and per team) calls `/trades/curate` and renders curated offer cards, Claude's rationale, and near-miss notes.
- An untouchables editor (toggle on roster rows) drives `PUT /untouchables` and refetches recommendations.

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
| Trade recommendation grouping | By move type (sell / buy / swap / consolidate), ≤3 per group, ≤2 per counterparty | By roster need (original); single ranked list; by team | Supersedes need grouping: the baseline showed one trade repeated to three teams; move-type groups plus diversity rules give distinct, actionable ideas |
| Waiver add/drop pairing | Always pair add with optimal drop | Add-only | An add recommendation that ignores what you'd have to drop is incomplete; pairing is mandatory for actionability |
| Claude context size | User roster + counterparty roster + league medians + score object | Full league rosters | Full league context inflates token cost with data irrelevant to the specific decision; medians capture league context compactly |
| Prompt caching | Cache `LeagueContext` prefix | No caching | League context is stable within a session; caching reduces latency and cost on multi-trade analysis sessions |
| Start/sit | Deferred | In scope | Requires a weekly projections source not in the current ETL stack; separate initiative |
| Pending offers scope | Offers involving the user's roster only | All pending league offers | The five-signal model is user-perspective; third-party trades have no defined user value delta |
| Trade recommendations caching | Recomputed on every request | TTL cache (e.g., 1 hour) | Pure SQLite reads + in-memory math; consistent with fresh-context-per-request (SM-071); `lastComputedAt` stays accurate |
| Recommender matching condition | Superseded by the Acceptance Model gate + relative-depth swaps | Counterparty grades C or below (previous); counterparty also has surplus (original) | Grade-only matching still produced Rodgers-for-a-1st; acceptance is now judged from the counterparty's side in their own values |
| Surplus definition | No longer used by the recommender (swaps use relative depth ≥ 10 composite points) | Bench depth > league-median bench depth (previous) | Requiring an A/B surplus meant weak teams only ever got sell candidates |
| Hypothetical offer IDs | Synthetic negative transaction IDs on candidate offers | Hash/UUID strings | `SleeperTradeOfferRecord.transactionId` is numeric; negatives cannot collide with Sleeper IDs |
| Analyzing a candidate | `POST /trades/analyze` accepts `{ trade_offer: … }` alongside `{ transaction_id }` | Score candidates client-side; or persist hypothetical offers | Keeps one scoring path (the same five-signal scorer) and honors SM-056 (Claude only on explicit Analyze) without persisting speculative rows |
| Waiver "over the roster limit" | Non-IR player count ≥ `roster_positions.length` (total slots incl. bench) | Per-position bench caps | Sleeper exposes no per-position max; total slots is the only league-defined limit |
| Waiver drop candidate | Lowest-value bench player at the add's position; taxi never dropped | Lowest-value bench player league-wide | Position-matched drops keep the swap's positional-need signal honest; taxi is developmental |
| Waiver free-agent pool | Top 50 by dynasty value | Entire un-rostered pool | Scoring is O(evaluateRoster) per candidate; the actionable waiver tier is the top of the pool |
| Waiver ranking | valueDeltaScore + positionalNeedScore (age reported, not ranked) | Weighted blend | DFF-SM-066 ranks by "value delta and positional need"; age is a tie-breaking signal for the human, not the sort |
| Taxi/IR in grades | Taxi counts toward depth score; IR excluded from grades | Include both; exclude both | Taxi is real developmental depth (the essence of dynasty); IR contributes nothing near-term |
| Age curve baselines | Fixed constants (QB 27, RB 24, WR 25, TE 26) | Per-league configurable | Superflex skews value weighting more than age primes; no proven need for config surface |
| Claude reasoning persistence | Analyze: recomputed on demand. Curation: cached in SQLite keyed by sync time, value time and untouchables hash | Persist everything; recompute everything | The cache key makes stale narratives impossible (any input change misses), while curation tool loops are too costly to rerun on every view |
| Percentile with single team | 50 (neutral) | 0 or 100 | One team is simultaneously best and worst; neutral avoids misleading extremes |
| Acceptance shape | Hard gate + 0–100 likelihood | Gate only; score only | Lopsided offers never surface; survivors are still ranked by how likely the other manager is to say yes |
| Counterparty valuation | Tier-weighted dynasty/redraft blend | Market dynasty value only; context multipliers on dynasty value | A 42-year-old QB is worth ~nothing to a rebuilder but real points to a contender; redraft value captures that directly |
| Team classification | 3 tiers from strength, points-for and record percentiles, weights shifting with season progress | Win% only (previous); 2 tiers; continuous score | Win% after 3 games is noise (the user was 7th by record but 3rd in points); tiers stay explainable to the UI and to Claude |
| Fairness band | Counterparty loss ≤ 10%, per-league setting | 5% (KTC / DynastyProcess); need-tiered band | Values are already team-specific, and family leagues trade less precisely; tunable per league |
| Package adjustment | FantasyCalc-style roster-spot credit, cap 700 | KTC stud curve; none | Simple and explainable; KTC's curve is opaque and distorts even 1-for-1 gaps |
| Ranking | min(user score, likelihood) × tier boost | Weighted blend; user score with a likelihood floor | A suggestion is only as good as its weaker side |
| Manager signals | Activity only (moves, FAAB, trades this season) | Manual tags; full multi-season history | Free with current sync; trade-style tendencies wait for multi-season history |
| Move types | Sell vets, buy vets, relative-depth swaps, consolidate/split; tier weights ranking but doesn't gate | Tier-gated; user-chosen mode | Off-tier ideas stay visible, and a misclassified team still gets useful moves |
| Vet rule | redraft ≥ 1.2 × dynasty; age fallback per position | Flat 30+ (previous); position age cutoffs | Captures RBs aging faster than QBs without hand-tuned cutoffs |
| User protection | Untouchables list; starters otherwise eligible | Bench-only except sells | Selling a starter is often the right rebuild move |
| Inbound selection | Value-matched closest to even within the gate, ≤2 assets per side | Counterparty's most valuable pick (previous) | "Most valuable pick" collapsed every offer to the same 1st |
| Claude role in trades | Curator with tools; only gate-passing offers returned, enforced server-side | Explainer only; generator with tools | Claude adds creativity (sweeteners, packages) while the gate keeps every proposable offer realistic |
| Curation trigger | On demand, cached | Per sync; per page load | Cost scales with use; the list view stays instant |
| Curator model | `claude-sonnet-5-5`, ≤8 tool turns | Opus 5.5; configurable | Strong multi-turn tool use at a fraction of Opus cost |

## Edge Case Probe (Acceptance Model, Recommender, Curator)

- No games played → `winPct` = 0.5 for all teams; strength dominates the classifier (w_strength 0.6).
- `points_for` null (pre-season) → `pointsForPct` = 0.5 for all teams.
- Player missing `redraft_value` → perceived = dynasty value; `missingRedraft` warning; vet rule falls back to age.
- Pick with no `pick_values` row → contributes 0 (existing DFF-SM-082 behavior) and the evaluation carries a warning; such a pick is never chosen as a value-match.
- `give + get = 0` (all assets valueless) → `lossPct` = 0 with a denominator floor of 1; still requires user composite > 0, so it never surfaces.
- Counterparty with no eligible assets → no candidates for that team; the curator may still be asked and returns an empty `offers` list with a summary.
- Every user asset untouchable → recommendations return empty groups; the curator explains why.
- Claude submits an offer with an unowned, duplicated, IR or untouchable asset → `evaluate_trade` returns a validation error during the loop; any that slip into `submit_offers` are dropped by the server guardrail.
- Claude never calls `submit_offers` within 8 turns → `curatorIncomplete: true`, with the pool's top 3 returned.
- Claude API failure → `claudeUnavailable: true`, with the pool's top 3 and no prose (mirrors DFF-SM-043).
- Untouchables reference players since traded away → ignored at read time and pruned on the next PUT.
- League without a `league_trade_settings` row → band 0.10.
- Single-team or two-team league → percentiles are 0.5/neutral (consistent with the existing single-team percentile rule); the classifier yields `middle`.
