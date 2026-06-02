# EARS Specs: Season Management

Drives: `docs/llds/season-management.md`

Status markers: `[x]` implemented · `[ ]` gap · `[D]` deferred

---

## Navigation

**DFF-SM-001** `[ ]`
The system shall render a top-level "My Team" navigation section that is accessible independently of any active or historical draft.

**DFF-SM-002** `[ ]`
When the My Team section loads and no league is connected, the system shall display a league connection prompt with options to enter a Sleeper username or a league ID directly.

**DFF-SM-003** `[ ]`
When the My Team section loads and at least one league is connected, the system shall render the Roster Overview as the landing view.

**DFF-SM-004** `[ ]`
The My Team section shall display a manual refresh button that triggers `POST /sleeper/sync` and re-fetches the Roster Overview on completion.

---

## Roster Overview

**DFF-SM-010** `[ ]`
The system shall expose `GET /season/:league_id/overview` which returns a `RosterOverview` object including overall grade, overall percentile, team context, and per-position breakdown.

**DFF-SM-011** `[ ]`
For each position group (QB, RB, WR, TE), the system shall compute a value score as the sum of `dynasty_value` of all starters at that position using the league's roster position configuration.

**DFF-SM-012** `[ ]`
For each position group, the system shall compute an age curve score as the weighted mean age of starters at that position compared against a position-specific prime age baseline (QB: 27, RB: 24, WR: 25, TE: 26). Players 3+ years past peak prime shall penalize the score; players 2+ years below peak prime shall receive a bonus.

**DFF-SM-013** `[ ]`
For each position group, the system shall compute a depth score as the ratio of the user's total positional dynasty value (starters and bench) to the league median for that position.

**DFF-SM-014** `[ ]`
For each position group, the system shall compute a percentile rank as the user's starter value sum ranked against all other teams in the league at the same position, expressed as a 0–100 percentile.

**DFF-SM-015** `[ ]`
Each position group shall receive a composite score weighted as: value score 50%, depth score 30%, age curve score 20%.

**DFF-SM-016** `[ ]`
The system shall map position composite scores to letter grades: 85–100 → A, 70–84 → B, 55–69 → C, 40–54 → D, 0–39 → F.

**DFF-SM-017** `[ ]`
The overall team grade shall be the weighted average of position composites, weighted by the league's roster slot count per position.

**DFF-SM-018** `[ ]`
The Roster Overview endpoint shall not invoke Claude. It shall return pure algorithm output only.

**DFF-SM-019** `[ ]`
The UI shall render the overall grade and percentile as the Roster Overview header, with per-position grade, percentile, and starter list displayed below.

---

## Team Context

**DFF-SM-025** `[ ]`
The system shall classify each team as `contender` or `rebuilder` based on win-loss record: teams in the top half of the league standings shall be classified as `contender`; teams in the bottom half shall be classified as `rebuilder`.

**DFF-SM-026** `[ ]`
The UI shall display the user's team context classification (contender / rebuilder) as a badge on the Roster Overview.

---

## Trade Scoring

**DFF-SM-030** `[ ]`
The system shall expose `GET /season/:league_id/trades/pending` which returns all pending Sleeper trade offers from `sleeper_trade_offers` with a pre-computed `TradeScore` for each.

**DFF-SM-031** `[ ]`
The system shall expose `POST /season/:league_id/trades/analyze` which accepts a `transaction_id`, computes (or retrieves) the `TradeScore`, invokes Claude with the score and league context, and returns Claude's structured reasoning.

**DFF-SM-032** `[ ]`
For each trade, the system shall compute a value delta as the sum of `dynasty_value` of all assets received minus the sum of `dynasty_value` of all assets sent. Player values shall use `players.dynasty_value`; pick values shall use `pick_values` keyed by `(year, round)`.

**DFF-SM-033** `[ ]`
For each trade, the system shall compute an age curve score as the weighted mean age of assets received minus the weighted mean age of assets sent, normalized against the league's average player age.

**DFF-SM-034** `[ ]`
For each trade, the system shall compute a positional need score by comparing the user's position grades before and after the trade. Trades that improve a C-or-below grade position shall receive a positive score; trades that weaken an A-grade position shall receive a negative score.

**DFF-SM-035** `[ ]`
For each trade, the system shall apply a team context multiplier: contender mode shall weight positional need ×1.4 and value delta ×0.8; rebuilder mode shall weight age curve ×1.4 and value delta ×1.2.

**DFF-SM-036** `[ ]`
For each trade, the system shall compute an asset liquidity signal of +1, 0, or −1 based on whether the assets sent match the inferred preferences of the counterparty (derived from the ratio of picks to players on their roster).

**DFF-SM-037** `[ ]`
The system shall compute a composite trade score as the weighted sum of the five signals, normalized to a −100 to +100 scale.

**DFF-SM-038** `[ ]`
The system shall assign a verdict of `win` when composite score > +10, `loss` when composite score < −10, and `neutral` otherwise.

**DFF-SM-039** `[ ]`
The UI shall display each pending offer with its verdict badge (Win / Loss / Neutral) and an "Analyze" button that triggers the Claude reasoning call.

---

## Trade Analysis (Claude)

**DFF-SM-040** `[ ]`
When `POST /season/:league_id/trades/analyze` is called, the system shall invoke Claude with: the assembled `LeagueContext` summary (user roster grades, team context, league median values), the full `TradeScore` object with all five signal values, and the structured response format instruction.

**DFF-SM-041** `[ ]`
Claude's trade analysis response shall follow this format: Verdict / Primary signal (citing the most decisive signal) / Key factors (at least two, each citing a specific signal value or roster context) / Non-obvious consideration / Recommendation (single sentence).

**DFF-SM-042** `[ ]`
All value claims in the Claude response shall cite the specific dynasty value figure (e.g. "dynasty value: 4200").

**DFF-SM-043** `[ ]`
When the Claude API call fails for a trade analysis request, the system shall return the raw `TradeScore` object with `claudeUnavailable: true`. The UI shall render the signal scores directly without the Claude narrative.

**DFF-SM-044** `[ ]`
The system shall cache the `LeagueContext` summary as a prompt prefix using the Anthropic prompt caching API to reduce latency and cost across multiple trade analysis calls within a session.

---

## Trade Recommendations

**DFF-SM-050** `[ ]`
The system shall expose `GET /season/:league_id/trades/recommendations` which scans all other league rosters and returns proactive trade candidates grouped by roster need.

**DFF-SM-051** `[ ]`
The system shall identify surplus positions for the user as positions graded A or B where bench depth exceeds the league median for that position.

**DFF-SM-052** `[ ]`
A trade candidate shall be generated for another team when: the user has surplus at a position that team also has surplus at (enabling an outbound asset), and that team has surplus at a position the user grades C or below (providing an inbound asset).

**DFF-SM-053** `[ ]`
Each trade candidate shall be scored using the same five-signal Trade Scorer. Only candidates with a positive composite score shall be surfaced.

**DFF-SM-054** `[ ]`
Trade candidates shall be grouped by the roster need they address: WR targets, RB targets, QB targets, TE targets, pick acquisitions, and value sells.

**DFF-SM-055** `[ ]`
Each group shall surface at most 3 candidates, ranked by composite score descending.

**DFF-SM-056** `[ ]`
The Trade Recommendations endpoint shall not invoke Claude. Claude is invoked only when the user clicks "Analyze" on a specific candidate, which routes to `POST /season/:league_id/trades/analyze`.

**DFF-SM-057** `[ ]`
The UI shall render trade recommendations in a grouped accordion by need category. Each candidate shall display the counterparty team name, the proposed assets, and the composite score.

---

## Waiver Wire

**DFF-SM-060** `[ ]`
The system shall expose `GET /season/:league_id/waivers` which returns ranked add/drop pairs for free agents in the connected league.

**DFF-SM-061** `[ ]`
The system shall expose `POST /season/:league_id/waivers/analyze` which accepts an add/drop pair, invokes Claude with the pair's score and league context, and returns Claude's structured reasoning.

**DFF-SM-062** `[ ]`
For each free agent with `dynasty_value > 0`, the system shall identify the user's weakest position matching the free agent's position as the target for the add.

**DFF-SM-063** `[ ]`
For each add candidate, the system shall identify the optimal drop candidate as the lowest `dynasty_value` bench player at the same position on the user's roster. When the position is not over the roster limit, no drop candidate is required.

**DFF-SM-064** `[ ]`
The system shall score each add/drop pair on: value delta (add value minus drop value), positional need gap (same signal as trade scoring), and age curve (whether the add is younger than the drop).

**DFF-SM-065** `[ ]`
Only add/drop pairs with a positive value delta and a valid drop candidate (or no drop required) shall be surfaced.

**DFF-SM-066** `[ ]`
The system shall return at most 5 add/drop pairs per position group, ranked by combined value delta and positional need score descending.

**DFF-SM-067** `[ ]`
When `POST /season/:league_id/waivers/analyze` is called, the system shall invoke Claude using the same structured reasoning format as trade analysis (Verdict / Primary signal / Key factors / Non-obvious consideration / Recommendation).

**DFF-SM-068** `[ ]`
The UI shall render each waiver pair as a single row showing the add player (name, position, dynasty value), the drop player (name, position, dynasty value), and a value delta badge. An "Analyze" button shall trigger the Claude reasoning call.

---

## Context Assembly

**DFF-SM-070** `[ ]`
Each Season Management request shall assemble a `LeagueContext` object containing: league settings, the user's roster with dynasty values, all team rosters with records, free agents ranked by dynasty value, pending trade offers, and league median dynasty value per position.

**DFF-SM-071** `[ ]`
`LeagueContext` shall be assembled fresh on each request from SQLite. It shall not be cached between requests.

**DFF-SM-072** `[ ]`
The full player pool shall not be sent to Claude. The Claude context shall include only: the user's roster (positions and values), the counterparty's roster (positions and values), league median values per position, and the score object.

---

## Edge Cases

**DFF-SM-080** `[ ]`
When a player on the user's Sleeper roster has `players_id = NULL` (unmatched during Sleeper sync), the system shall include the player in roster display using only Sleeper metadata (name, position) and treat their `dynasty_value` as 0 for all scoring calculations.

**DFF-SM-081** `[ ]`
When `GET /season/:league_id/overview` is called and the last Sleeper sync is older than 1 hour, the system shall include a `staleSince` timestamp in the response. The UI shall display a stale data warning with the manual refresh button.

**DFF-SM-082** `[ ]`
When a pending trade offer references a pick asset with no matching row in `pick_values`, the system shall treat that pick's dynasty value as 0 and include a warning flag in the `TradeScore` response.

**DFF-SM-083** `[ ]`
When the user's league has fewer than 4 teams with data (e.g., a partially synced league), the system shall return a 422 response from all Season Management endpoints with a clear error message indicating insufficient league data.
