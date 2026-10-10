# EARS Specs: Season Management

Drives: `docs/llds/season-management.md`

Status markers: `[x]` implemented · `[ ]` gap · `[D]` deferred

---

## Navigation

**DFF-SM-001** `[x]`
The system shall render a top-level "My Team" navigation section that is accessible independently of any active or historical draft.

**DFF-SM-002** `[x]`
When the My Team section loads and no league is connected, the system shall display a league connection prompt with options to enter a Sleeper username or a league ID directly.

**DFF-SM-003** `[x]`
When the My Team section loads and at least one league is connected, the system shall render the Roster Overview as the landing view.

**DFF-SM-004** `[x]`
The My Team section shall display a manual refresh button that triggers `POST /sleeper/sync` and re-fetches the Roster Overview on completion.

---

## Roster Overview

**DFF-SM-010** `[x]`
The system shall expose `GET /season/:league_id/overview` which returns a `RosterOverview` object including overall grade, overall percentile, team context, and per-position breakdown.

**DFF-SM-011** `[x]`
For each position group (QB, RB, WR, TE), the system shall compute a value score as the sum of `dynasty_value` of all starters at that position using the league's roster position configuration.

**DFF-SM-012** `[x]`
For each position group, the system shall compute an age curve score as the weighted mean age of starters at that position compared against a position-specific prime age baseline (QB: 27, RB: 24, WR: 25, TE: 26). Players 3+ years past peak prime shall penalize the score; players 2+ years below peak prime shall receive a bonus.

**DFF-SM-013** `[x]`
For each position group, the system shall compute a depth score as the ratio of the user's total positional dynasty value (starters and bench) to the league median for that position.

**DFF-SM-014** `[x]`
For each position group, the system shall compute a percentile rank as the user's starter value sum ranked against all other teams in the league at the same position, expressed as a 0–100 percentile.

**DFF-SM-015** `[x]`
Each position group shall receive a composite score weighted as: value score 50%, depth score 30%, age curve score 20%.

**DFF-SM-016** `[x]`
The system shall map position composite scores to letter grades: 85–100 → A, 70–84 → B, 55–69 → C, 40–54 → D, 0–39 → F.

**DFF-SM-017** `[x]`
The overall team grade shall be the weighted average of position composites, weighted by the league's roster slot count per position.

**DFF-SM-018** `[x]`
The Roster Overview endpoint shall not invoke Claude. It shall return pure algorithm output only.

**DFF-SM-019** `[x]`
The UI shall render the overall grade and percentile as the Roster Overview header, with per-position grade, percentile, and starter list displayed below.

---

## Team Context

**DFF-SM-025** `[x]` *superseded by DFF-SM-100–DFF-SM-104*
~~The system shall classify each team as `contender` or `rebuilder` based on win-loss record: teams in the top half of the league standings shall be classified as `contender`; teams in the bottom half shall be classified as `rebuilder`.~~

**DFF-SM-026** `[x]` *superseded by DFF-SM-105*
~~The UI shall display the user's team context classification (contender / rebuilder) as a badge on the Roster Overview.~~

---

## Trade Scoring

**DFF-SM-030** `[x]`
The system shall expose `GET /season/:league_id/trades/pending` which returns all pending Sleeper trade offers from `sleeper_trade_offers` **that involve the user's roster** (as proposer or responder), each with a pre-computed `TradeScore`. Pending offers between other teams shall be excluded — the five-signal model is user-perspective only.

**DFF-SM-031** `[x]`
The system shall expose `POST /season/:league_id/trades/analyze` which accepts a `transaction_id` referencing a synced pending offer or a `trade_offer` payload referencing a hypothetical recommendation candidate (when both are present, `trade_offer` takes precedence), computes (or retrieves) the `TradeScore`, invokes Claude with the score and league context, and returns Claude's structured reasoning.

**DFF-SM-032** `[x]`
For each trade, the system shall compute a value delta as the sum of `dynasty_value` of all assets received minus the sum of `dynasty_value` of all assets sent. Player values shall use `players.dynasty_value`; pick values shall use `pick_values` keyed by `(year, round)`.

**DFF-SM-033** `[x]`
For each trade, the system shall compute an age curve score as the weighted mean age of assets received minus the weighted mean age of assets sent, normalized against the league's average player age.

**DFF-SM-034** `[x]`
For each trade, the system shall compute a positional need score by comparing the user's position grades before and after the trade. Trades that improve a C-or-below grade position shall receive a positive score; trades that weaken an A-grade position shall receive a negative score.

**DFF-SM-035** `[x]`
For each trade, the system shall apply a team context multiplier: contender mode shall weight positional need ×1.4 and value delta ×0.8; rebuilder mode shall weight age curve ×1.4 and value delta ×1.2.

**DFF-SM-036** `[x]`
For each trade, the system shall compute an asset liquidity signal of +1, 0, or −1 based on whether the assets sent match the inferred preferences of the counterparty (derived from the ratio of picks to players on their roster).

**DFF-SM-037** `[x]`
The system shall compute a composite trade score as the weighted sum of the five signals, normalized to a −100 to +100 scale.

**DFF-SM-038** `[x]`
The system shall assign a verdict of `win` when composite score > +10, `loss` when composite score < −10, and `neutral` otherwise.

**DFF-SM-039** `[x]`
The UI shall display each pending offer with its verdict badge (Win / Loss / Neutral) and an "Analyze" button that triggers the Claude reasoning call.

---

## Trade Analysis (Claude)

**DFF-SM-040** `[x]`
When `POST /season/:league_id/trades/analyze` is called, the system shall invoke Claude with: the assembled `LeagueContext` summary (user roster grades, team context, league median values), the full `TradeScore` object with all five signal values, and the structured response format instruction.

**DFF-SM-041** `[x]`
Claude's trade analysis response shall follow this format: Verdict / Primary signal (citing the most decisive signal) / Key factors (at least two, each citing a specific signal value or roster context) / Non-obvious consideration / Recommendation (single sentence).

**DFF-SM-042** `[x]`
All value claims in the Claude response shall cite the specific dynasty value figure (e.g. "dynasty value: 4200").

**DFF-SM-043** `[x]`
When the Claude API call fails for a trade analysis request, the system shall return the raw `TradeScore` object with `claudeUnavailable: true`. The UI shall render the signal scores directly without the Claude narrative.

**DFF-SM-044** `[x]`
The system shall cache the `LeagueContext` summary as a prompt prefix using the Anthropic prompt caching API to reduce latency and cost across multiple trade analysis calls within a session.

---

## Trade Recommendations

**DFF-SM-050** `[x]` *superseded by DFF-SM-130*
~~The system shall expose `GET /season/:league_id/trades/recommendations` which scans all other league rosters and returns proactive trade candidates grouped by roster need.~~

**DFF-SM-051** `[x]` *superseded by DFF-SM-134 (relative depth replaces surplus)*
~~The system shall identify surplus positions for the user as positions graded A or B where bench depth — the combined dynasty value of bench and taxi players at the position, IR excluded — strictly exceeds the league-median bench depth at that position.~~

**DFF-SM-052** `[x]` *superseded by DFF-SM-132–DFF-SM-135*
~~A trade candidate shall be generated for another team when: the user has surplus at a position where that team grades C or below (enabling an outbound asset that team needs), and that team has surplus at a position the user grades C or below (providing an inbound asset).~~

**DFF-SM-053** `[x]`
Each trade candidate shall be scored using the same five-signal Trade Scorer. Only candidates with a positive composite score shall be surfaced.

**DFF-SM-054** `[x]` *superseded by DFF-SM-140*
~~Trade candidates shall be grouped by the roster need they address: WR targets, RB targets, QB targets, TE targets, pick acquisitions, and value sells.~~

**DFF-SM-055** `[x]` *superseded by DFF-SM-141*
~~Each group shall surface at most 3 candidates, ranked by composite score descending.~~

**DFF-SM-056** `[x]`
The Trade Recommendations endpoint shall not invoke Claude. Claude is invoked only when the user clicks "Analyze" on a specific candidate, which routes to `POST /season/:league_id/trades/analyze`.

**DFF-SM-057** `[x]` *superseded by DFF-SM-145*
~~The UI shall render trade recommendations in a grouped accordion by need category. Each candidate shall display the counterparty team name, the proposed assets, and the composite score.~~

---

## Waiver Wire

**DFF-SM-060** `[x]`
The system shall expose `GET /season/:league_id/waivers` which returns ranked add/drop pairs for free agents in the connected league.

**DFF-SM-061** `[x]`
The system shall expose `POST /season/:league_id/waivers/analyze` which accepts an add/drop pair, invokes Claude with the pair's score and league context, and returns Claude's structured reasoning.

**DFF-SM-062** `[x]`
For each free agent with `dynasty_value > 0`, the system shall identify the user's weakest position matching the free agent's position as the target for the add.

**DFF-SM-063** `[x]`
For each add candidate, the system shall identify the optimal drop candidate as the lowest `dynasty_value` bench player at the same position on the user's roster. When the position is not over the roster limit, no drop candidate is required.

**DFF-SM-064** `[x]`
The system shall score each add/drop pair on: value delta (add value minus drop value), positional need gap (same signal as trade scoring), and age curve (whether the add is younger than the drop).

**DFF-SM-065** `[x]`
Only add/drop pairs with a positive value delta and a valid drop candidate (or no drop required) shall be surfaced.

**DFF-SM-066** `[x]`
The system shall return at most 5 add/drop pairs per position group, ranked by combined value delta and positional need score descending.

**DFF-SM-067** `[x]`
When `POST /season/:league_id/waivers/analyze` is called, the system shall invoke Claude using the same structured reasoning format as trade analysis (Verdict / Primary signal / Key factors / Non-obvious consideration / Recommendation).

**DFF-SM-068** `[x]`
The UI shall render each waiver pair as a single row showing the add player (name, position, dynasty value), the drop player (name, position, dynasty value), and a value delta badge. An "Analyze" button shall trigger the Claude reasoning call.

---

## Context Assembly

**DFF-SM-070** `[x]`
Each Season Management request shall assemble a `LeagueContext` object containing: league settings, the user's roster with dynasty values, all team rosters with records, free agents ranked by dynasty value, pending trade offers, and league median dynasty value per position.

**DFF-SM-071** `[x]`
`LeagueContext` shall be assembled fresh on each request from SQLite. It shall not be cached between requests.

**DFF-SM-072** `[x]`
The full player pool shall not be sent to Claude. The Claude context shall include only: the user's roster (positions and values), the counterparty's roster (positions and values), league median values per position, and the score object.

---

## Team Classifier

*Map: [Realistic, counterparty-aware trades](https://github.com/wulke/dynastyff/issues/210). Decision: [acceptance model](https://github.com/wulke/dynastyff/issues/214).*

**DFF-SM-100** `[ ]`
The system shall classify every team in a connected league, including the user's, into exactly one tier: `contender`, `middle`, or `rebuilder`.

**DFF-SM-101** `[ ]`
The system shall compute each team's `winNowScore` as `w_strength·strengthPct + w_points·pointsForPct + w_record·winPct`, where each input is the team's league percentile (0–1) of summed starter dynasty value, `points_for`, and win percentage (ties counted as half a win), respectively.

**DFF-SM-102** `[ ]`
The system shall set the classifier weights from season progress `p = min(gamesPlayed / 8, 1)` as `w_strength = 0.6 − 0.3p`, `w_points = 0.2 + 0.1p`, `w_record = 0.2 + 0.2p`, where `gamesPlayed` is the league's maximum `wins + losses + ties`.

**DFF-SM-103** `[ ]`
The system shall assign `contender` when `winNowScore ≥ 0.6`, `rebuilder` when `winNowScore ≤ 0.4`, and `middle` otherwise.

**DFF-SM-104** `[ ]`
When no games have been played, or when `points_for` is unavailable, the system shall use a percentile of 0.5 for every team for the missing input.

**DFF-SM-105** `[ ]`
The UI shall display the user's tier (contender / middle / rebuilder) as a badge on the Roster Overview and on the Trade Recommendations header.

**DFF-SM-106** `[ ]`
The system shall classify each team's manager activity as `dormant` when, with `gamesPlayed ≥ 3`, the team has zero `total_moves`, zero `waiver_budget_used`, and zero completed trades this season; as `low` when its `total_moves` is below one quarter of the league median; and as `active` otherwise.

---

## Acceptance Model

**DFF-SM-110** `[ ]`
The system shall value each asset from a given team's perspective as `perceived = (1 − r)·dynastyValue + r·redraftValue`, with `r = 0.50` for contenders, `0.25` for middle teams, and `0.10` for rebuilders.

**DFF-SM-111** `[ ]`
If a player's `redraft_value` is null, then the system shall use the player's dynasty value as the perceived value and add a `missingRedraft` warning to the evaluation.

**DFF-SM-112** `[ ]`
The system shall treat a draft pick's redraft value as 0, and when the evaluating team is a contender, shall reduce the pick's perceived value by a further 10% for each season beyond the next rookie draft.

**DFF-SM-113** `[ ]`
When the two sides of a trade contain different numbers of assets, the system shall credit the side receiving fewer assets with `Σ min(0.698·v, 700)` over the lowest-valued surplus assets of the larger side, where `v` is the evaluating team's perceived value and the number of summed assets equals the difference in asset counts.

**DFF-SM-114** `[ ]`
The system shall compute the counterparty's `lossPct` as `(give − get) / max(give + get, 1)` in the counterparty's perceived values, where `give` is the value the counterparty sends and `get` is the value it receives plus its roster-spot credit.

**DFF-SM-115** `[ ]`
The system shall consider a trade to pass the acceptance gate only when the counterparty's `lossPct` is at most the league's acceptance band and the user's five-signal composite score is greater than 0.

**DFF-SM-116** `[ ]`
The system shall read the acceptance band from `league_trade_settings.acceptance_band` and shall default to 0.10 when the league has no settings row.

**DFF-SM-117** `[ ]`
For a trade that passes the gate, the system shall compute an acceptance likelihood (0–100) as `A·(0.5·F + 0.25·N + 0.25·C)`, where `F = 100·clamp((band − lossPct)/(2·band), 0, 1)`; `N = clamp(50 + Σ counterparty composite deltas from re-grading its roster with the trade applied, 0, 100)`; `C` is the tier context fit; and `A` is 1.0, 0.85, or 0.6 for active, low, or dormant managers.

**DFF-SM-118** `[ ]`
The system shall compute context fit `C` as 100 × the share of perceived value the counterparty receives that suits its tier: win-now players for contenders; picks and players at or below their position's prime age + 1 for rebuilders; and a constant 50 for middle teams.

**DFF-SM-119** `[ ]`
If a trade fails the acceptance gate, then the system shall report its likelihood as 0.

**DFF-SM-120** `[ ]`
The system shall rank trades by `mutual = min(clamp(userComposite, 0, 100), likelihood) × tierBoost`, where `tierBoost` is 1.15 when the move type fits the user's tier (rebuilder: sell vets, split; contender: buy vets, consolidate) and 1.0 otherwise.

**DFF-SM-121** `[ ]`
Every acceptance evaluation shall report the counterparty's tier, activity, `give`, `get`, roster-spot credit, `lossPct`, band, gate result, likelihood, each likelihood component, and warnings.

---

## Trade Recommendations (counterparty-aware)

*Decision: [move types](https://github.com/wulke/dynastyff/issues/218).*

**DFF-SM-130** `[ ]`
The system shall expose `GET /season/:league_id/trades/recommendations`, which scans all other league rosters and returns gated trade candidates grouped by move type, along with the user's tier.

**DFF-SM-131** `[ ]`
The system shall treat a player as win-now (a vet) when `redraft_value ≥ 1.2 × dynasty_value`, or, when `redraft_value` is null, when the player's age is at least 32 (QB), 27 (RB), 29 (WR), or 29 (TE).

**DFF-SM-132** `[ ]`
For each counterparty classified `contender` or `middle`, the system shall generate **sell vets** candidates in which the user sends one eligible vet and receives value-matched counterparty picks or non-vet players.

**DFF-SM-133** `[ ]`
For each counterparty classified `rebuilder` or `middle`, the system shall generate **buy vets** candidates in which the user receives one counterparty vet and sends value-matched user picks or non-vet players.

**DFF-SM-134** `[ ]`
The system shall generate **positional swap** candidates for position pairs `P ≠ Q` where the user's composite exceeds the counterparty's at `P` by at least 10 and the counterparty's composite exceeds the user's at `Q` by at least 10, in which the user sends a player at `P` and receives a value-matched counterparty player at `Q`.

**DFF-SM-135** `[ ]`
The system shall generate **consolidate** candidates (the user sends 2 assets for 1 counterparty player worth more than either) and **split** candidates (the user sends 1 player for 2 counterparty assets).

**DFF-SM-136** `[ ]`
The system shall exclude IR players from both sides and assets on the user's untouchables list from the user's side; starters and owned future picks for the next three seasons shall otherwise be eligible.

**DFF-SM-137** `[ ]`
The system shall choose the value-matched side of each candidate to minimize the counterparty's `|lossPct|` among options that pass the gate, searching single assets first and then pairs drawn from the 12 assets closest in perceived value, with at most 2 assets per side.

**DFF-SM-138** `[ ]`
Candidate selection shall be deterministic: ties shall break on higher `mutual`, then lower asset id.

**DFF-SM-139** `[ ]`
The system shall surface only candidates that pass the acceptance gate.

**DFF-SM-140** `[ ]`
The response shall always contain the four groups `sell`, `buy`, `swap`, and `consolidate`, each with a label and a (possibly empty) candidate list.

**DFF-SM-141** `[ ]`
Each group shall surface at most 3 candidates, ranked by `mutual` descending, and shall not repeat a user asset within the group.

**DFF-SM-142** `[ ]`
The response shall contain at most 2 candidates per counterparty across all groups; when a counterparty exceeds 2, the system shall drop its lowest-`mutual` candidate and backfill that group.

**DFF-SM-143** `[ ]`
Each candidate shall carry a stable `candidateId`, the counterparty's tier, the user `TradeScore`, the `AcceptanceEvaluation`, `userScore`, `likelihood`, `mutual`, a rationale, and a hypothetical offer with a synthetic transaction ID that cannot collide with Sleeper transaction IDs.

**DFF-SM-144** `[ ]`
The system shall retain the top 25 gated candidates by `mutual` (before diversity rules) as the curation pool, available server-side to the Trade Curator and not included in the recommendations response.

**DFF-SM-145** `[ ]`
The UI shall render trade recommendations grouped by move type, with each candidate showing the counterparty and its tier, the assets sent and received, the user's score, and the counterparty's likelihood.

---

## Trade Curator (Claude)

*Decision: [Claude's role](https://github.com/wulke/dynastyff/issues/215).*

**DFF-SM-150** `[ ]`
The system shall expose `POST /season/:league_id/trades/curate`, accepting either `{ candidate_id }` or `{ team_roster_id }`, and shall return 400 when neither or both are provided.

**DFF-SM-151** `[ ]`
The system shall recompute the curation pool server-side and scope it to the requested candidate plus up to 5 other pool candidates with the same counterparty, or to up to 10 pool candidates with the requested counterparty.

**DFF-SM-152** `[ ]`
The system shall run curation as a Claude tool loop using `claude-sonnet-5-5`, with the read-only tools `get_team`, `get_asset_value`, and `evaluate_trade`, and the terminal tool `submit_offers`.

**DFF-SM-153** `[ ]`
The `evaluate_trade` tool shall use the same acceptance-gate and scoring code path as the Trade Recommender, and shall return a validation error for any asset that is not owned by the stated side, is duplicated, is on IR, or is on the user's untouchables list.

**DFF-SM-154** `[ ]`
The system shall send the league context, the user's tier and needs, and counterparty summaries as a cached system prefix, and the scoped pool as the uncached suffix.

**DFF-SM-155** `[ ]`
The system shall stop the tool loop after at most 8 tool turns; if `submit_offers` was not called, it shall return the scoped pool's top 3 candidates with `curatorIncomplete: true`.

**DFF-SM-156** `[ ]`
After `submit_offers`, the system shall re-evaluate every submitted offer and shall remove any offer that does not pass the acceptance gate before responding.

**DFF-SM-157** `[ ]`
The system shall never return a gate-failing trade as an offer object; Claude's near-miss suggestions shall appear only in the `nearMisses` text.

**DFF-SM-158** `[ ]`
Each curated offer shall include the offer payload, a headline, Claude's rationale covering both sides, the `AcceptanceEvaluation`, the user `TradeScore`, and `mutual`.

**DFF-SM-159** `[ ]`
If the Claude API call fails during curation, then the system shall return the scoped pool's top 3 candidates with `claudeUnavailable: true` and no narrative.

**DFF-SM-160** `[ ]`
The Trade Recommendations endpoint shall not invoke Claude; Claude shall be invoked only from the analyze and curate endpoints on explicit user action.

**DFF-SM-161** `[ ]`
The UI shall provide a "Work this with Claude" action on each recommendation candidate and on each counterparty, and shall render curated offer cards, Claude's rationale, near-miss notes, and the summary.

**DFF-SM-162** `[ ]`
The system shall cache curation results in `trade_curation_cache` under a key derived from the league, the scope, the last Sleeper sync time, the last value refresh time, and a hash of the user's untouchables.

**DFF-SM-163** `[ ]`
When a cached curation exists for the current key, the system shall return it without invoking Claude; when any key input changes, the system shall compute a fresh curation.

**DFF-SM-164** `[ ]`
The system shall recompute Claude reasoning on each trade or waiver analyze request, and shall not persist analyze narratives between requests.

**DFF-SM-165** `[ ]`
The trade and waiver analyze endpoints shall use `claude-sonnet-5-5`.

---

## Untouchables

**DFF-SM-170** `[ ]`
The system shall expose `GET /season/:league_id/untouchables` returning the user's untouchable assets, and `PUT /season/:league_id/untouchables` replacing them with a provided list of player and pick references.

**DFF-SM-171** `[ ]`
The system shall reject untouchable entries that do not reference an asset currently owned by the user's roster with a 400 response.

**DFF-SM-172** `[ ]`
When an untouchable asset is no longer owned by the user, the system shall ignore it when generating candidates and prune it on the next PUT.

**DFF-SM-173** `[ ]`
The UI shall let the user toggle untouchable status on roster rows and owned picks, and shall refetch trade recommendations after a change.

---

## Context Assembly (acceptance additions)

**DFF-SM-180** `[ ]`
`LeagueContext` shall additionally include, for every team, `points_for`, `total_moves`, and `waiver_budget_used`; each rostered player's `redraft_value`; this season's completed trades; the user's untouchables; and the league's acceptance band.

---

## Edge Cases

**DFF-SM-080** `[x]`
When a player on the user's Sleeper roster has `players_id = NULL` (unmatched during Sleeper sync), the system shall include the player in roster display using only Sleeper metadata (name, position) and treat their `dynasty_value` as 0 for all scoring calculations.

**DFF-SM-081** `[x]`
When `GET /season/:league_id/overview` is called and the last Sleeper sync is older than 1 hour, the system shall include a `staleSince` timestamp in the response. The UI shall display a stale data warning with the manual refresh button.

**DFF-SM-082** `[x]`
When a pending trade offer references a pick asset with no matching row in `pick_values`, the system shall treat that pick's dynasty value as 0 and include a warning flag in the `TradeScore` response.

**DFF-SM-083** `[x]`
When the user's league has fewer than 4 teams with data (e.g., a partially synced league), the system shall return a 422 response from all Season Management endpoints with a clear error message indicating insufficient league data.

**DFF-SM-084** `[x]`
The Roster Evaluator shall include taxi-squad players in depth scoring and shall exclude IR players from all grade components while retaining them in roster display data.

**DFF-SM-085** `[x]`
The system shall recompute trade recommendations on every request without a TTL cache; the `lastComputedAt` timestamp shall reflect the actual computation time.

**DFF-SM-086** `[x]` *superseded by DFF-SM-163 (curation) — analyze behavior unchanged, see DFF-SM-164*
~~The system shall recompute Claude reasoning on each analyze request and shall not persist narrative responses between requests.~~

**DFF-SM-087** `[x]`
When scoring a trade, the system shall attribute assets to the user by direction: players the user receives are those where `adds[player_id]` equals the user's roster ID and players the user sends are those where `drops[player_id]` equals the user's roster ID (or, when the payload omits `drops`, players the trade adds to another roster who are currently on the user's roster); picks the user receives are those whose `owner_id` equals the user's roster ID and picks the user sends are those whose `previous_owner_id` equals the user's roster ID. Assets moving between two other teams shall be excluded.

**DFF-SM-088** `[x]` *superseded by DFF-SM-131, DFF-SM-136–DFF-SM-138, DFF-SM-142*
~~Trade candidate asset selection shall be deterministic: the outbound asset for surplus-based candidates shall be the user's most valuable non-starter (bench or taxi, IR excluded) at the surplus position; the inbound asset for a player swap shall be the counterparty's non-starter at the target position with the dynasty value closest to the outbound asset; the inbound asset for a pick acquisition shall be the counterparty's most valuable owned future pick; and a value sell shall ship the user's most valuable player aged 30 or older at a position the counterparty grades C or below. Hypothetical candidates shall carry synthetic transaction IDs that cannot collide with Sleeper transaction IDs.~~
