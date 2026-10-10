# Research: Counterparty signals available from Sleeper data

Issue: #213 (child of map #210). Date: 2026-10-10.

**Question.** What can we learn about the *other* teams in a league from Sleeper data, so that an acceptance model can judge whether a counterparty would plausibly accept a recommended trade?

**Why it matters.** The Trade Recommender's "value sell" path proposes the user's best player aged 30+ for the counterparty's best future pick whenever that team grades C or below at the position (`src/season/tradeRecommender.ts:249-261`, `:139-145`). The only counterparty input is a positional grade (`outlookFor`, `src/season/tradeRecommender.ts:92-124`). It never asks whether that team is contending or rebuilding, how it trades, or whether it values picks. That gap is how you get "Aaron Rodgers (~42) for a 2027 1st".

**Sources.** Repo code at `e02bd67` (cited as `file:line`). Sleeper's official API docs at <https://docs.sleeper.com/> (cited by section anchor). The only live API call made was `GET https://api.sleeper.app/v1/state/nfl`, which matched the documented shape. No public league id appears in the repo fixtures (they use placeholders such as `'111111111111111111'`), so **no league-level endpoint shapes were verified live**. Field shapes below come from the docs unless marked otherwise.

---

## 1. What Sleeper Sync stores and uses today

### 1.1 Fetch → store → consume, per endpoint

| Endpoint (client) | Stored as | Fields kept | Fields fetched but discarded | Consumed by `LeagueContext`? |
|---|---|---|---|---|
| `GET /league/{id}` (`src/etl/sleeper/client.ts:55`) | `sleeper_leagues` (`src/db/schema.ts:447-456`) | name, season, scoring_settings, roster_positions, total_rosters, status (`src/etl/sleeper/sync.ts:290-313`) | `settings` object, `previous_league_id`, `draft_id` (typed at `src/etl/sleeper/types.ts:37-46`, never persisted) | Yes, as `league` (`src/season/context.ts:448-457`) |
| `GET /league/{id}/rosters` (`client.ts:57`) | `sleeper_teams` (`schema.ts:459-480`) + `sleeper_rosters` (`schema.ts:484-504`) | roster_id, owner_id, wins/losses/ties, fpts(+decimal) → `points_for`, fpts_against(+decimal) → `points_against` (`sync.ts:240-275`). Per-player slot = starter/taxi/ir/bench (`sync.ts:221-238`) | `settings.waiver_position`, `settings.waiver_budget_used`, `settings.total_moves` ([docs: rosters](https://docs.sleeper.com/#getting-rosters-in-a-league)) | Partly. `wins/losses/ties` and players are loaded. **`points_for`, `points_against` and `owner_id` are not selected** (`context.ts:412-423`) |
| `GET /league/{id}/users` (`client.ts:60`) | Folded into `sleeper_teams.display_name` / `team_name` (`sync.ts:496-513`) | display_name, metadata.team_name | `is_owner` (commissioner), `avatar`, `username` ([docs: users](https://docs.sleeper.com/#getting-users-in-a-league)) | display/team name only |
| `GET /league/{id}/transactions/{week}`, weeks 0..current (`sync.ts:455-469`) | `sleeper_trade_offers` (`schema.ts:517-545`) | **type = trade only** (`sync.ts:167-169`): status, roster_ids → proposer/responders, adds, drops, draft_picks, created, status_updated (`sync.ts:208-218`) | All `free_agent` and `waiver` transactions. On trades: `creator`, `consenter_ids`, `waiver_budget` (FAAB legs), `leg`, and `settings.waiver_bid` on waivers ([docs: transactions](https://docs.sleeper.com/#get-transactions)) | **Only `status = 'pending'`** (`context.ts:223-251`). Completed trades are stored but no code reads them |
| `GET /league/{id}/traded_picks` (`client.ts:66`) | `sleeper_traded_picks` (`schema.ts:548-571`) | season, round, roster_id (origin), previous_owner_id, owner_id | none | Yes, as `tradedPicks` (`context.ts:362-371`, `:465`) |
| `GET /players/nfl` (`client.ts:69`) | Disk cache trimmed to `{full_name, position}` (`src/etl/sleeper/registry-cache.ts:60-75`); `sleeper_player_map` (`schema.ts:507-513`) | name, position | `age`, `years_exp`, `injury_status`, `team`, `depth_chart_order` ([docs: players](https://docs.sleeper.com/#fetch-all-players)) | Indirectly. Player age comes from the ETL `players.age` column (`schema.ts:61`), not from Sleeper (`context.ts:169-191`). Unmatched players get `age: null` (`context.ts:196-207`) |
| `GET /state/nfl` (`client.ts:47`) | Not stored; only drives the week sweep (`sync.ts:638-642`) | n/a | n/a | n/a |

**Freshness.** Sync runs as the last step of `npm run etl`, on server start when the last sync is more than 15 minutes old, and on manual `POST /sleeper/sync` (`docs/llds/sleeper-sync.md:132-136`). Rosters and traded picks are replaced wholesale on each sync (`sync.ts:345-346`, `:395-396`). Team rows and trade offers are upserted (`sync.ts:315-327`, `:365-377`), so trade rows accumulate for the life of the league row. The sweep only covers the **connected league id, which is the current season** (`sync.ts:437-456`). Earlier seasons are never fetched.

### 1.2 Per-team signals available today

| Signal | Source | In `LeagueContext`? | Used for counterparty today? |
|---|---|---|---|
| W/L/T record → win% | `sleeper_teams.wins/losses/ties` | Yes (`context.ts:435-443`) | **No.** `classifyTeamContext` (top half by win% = contender, `src/season/rosterEvaluator.ts:125-142`) runs on the user's team only (`src/season/tradeScorer.ts:415`) |
| Points for / against | `sleeper_teams.points_for/points_against` | **No** (not selected, `context.ts:412-423`) | No |
| Roster composition by slot | `sleeper_rosters.slot_type` | Yes | Yes. Positional grades, needs and surplus (`tradeRecommender.ts:92-124`) |
| Per-player age and dynasty value | `players.age`, `players.dynasty_value` via `sleeper_rosters.players_id` | Yes (`context.ts:182-191`) | Indirectly, through the age-curve part of grades (`docs/llds/season-management.md:82`). There is no roster-level age profile |
| Future pick holdings | `sleeper_traded_picks` + assumed default ownership, rounds 1-4, next 3 seasons (`tradeScorer.ts:46-47`, `:297-326`) | Yes | Yes. Asset-liquidity signal (pick-to-player ratio vs league median, weight 0.1; `tradeScorer.ts:360-402`, `docs/llds/season-management.md:188`). The recommender also uses it to choose the counterparty's best pick (`tradeRecommender.ts:126-137`) |
| Pending trade offers | `sleeper_trade_offers` where `status='pending'` | Yes (`context.ts:223-251`) | Only to score offers involving the user |
| Completed / failed trade history (current season) | `sleeper_trade_offers` where `status in ('complete','failed')` | **No** | No |
| Manager identity | `sleeper_teams.owner_id`, `display_name`, `team_name` | display/team name only | Display only |

---

## 2. Available from Sleeper but not synced

All endpoints are read-only and need no auth. The docs ask callers to stay under about 1000 calls per minute ([docs: introduction](https://docs.sleeper.com/#introduction)). The current sync makes about 5 + (week+1) GETs per league per run (`sync.ts:447-456`).

| Data | Endpoint / field | Doc-verified shape | Notes |
|---|---|---|---|
| Standings inputs | `rosters[].settings.{wins,losses,ties,fpts,fpts_decimal,fpts_against,fpts_against_decimal}` | Yes ([rosters](https://docs.sleeper.com/#getting-rosters-in-a-league)) | **Already synced.** Only the context query needs to change |
| Max/potential points (`ppts`), divisions | `rosters[].settings.ppts`, `settings.division` | **Unverified.** Not in the official docs example | Treat as optional |
| Waiver activity counters | `rosters[].settings.waiver_budget_used`, `total_moves`, `waiver_position` | Yes ([rosters](https://docs.sleeper.com/#getting-rosters-in-a-league)) | Same payload as today, so columns are free to add |
| Weekly matchups / per-week points | `GET /league/{id}/matchups/{week}`: `roster_id`, `matchup_id`, `points`, `starters`, `players` | Yes ([matchups](https://docs.sleeper.com/#getting-matchups-in-a-league)) | One GET per week. Only needed for trend or all-play metrics |
| Playoff status | `GET /league/{id}/winners_bracket`, `/losers_bracket`: `r, m, t1, t2, w, l, t1_from, t2_from, p` | Yes ([playoff bracket](https://docs.sleeper.com/#getting-the-playoff-bracket)) | Only populated once playoffs are seeded. Before that, playoff odds must come from record plus league `settings` (e.g. playoff team count, playoff start week). Those keys sit inside the "settings object", which the docs leave unspecified, so they are **unverified** |
| League settings object | `GET /league/{id}` → `settings` | Shape **not documented** ([league](https://docs.sleeper.com/#get-a-specific-league)) | Already fetched and dropped (`types.ts:43`) |
| Prior-season league chain | `GET /league/{id}` → `previous_league_id` | Yes ([league](https://docs.sleeper.com/#get-a-specific-league)) | Walk the chain, then repeat the transactions sweep per season (about 18-19 GETs per season) |
| Waiver / FA transactions | Same `/transactions/{week}` payload, `type` = `free_agent` / `waiver`; `adds`, `drops`, `settings.waiver_bid`, `metadata` | Yes ([transactions](https://docs.sleeper.com/#get-transactions)) | **Already downloaded every sync** but discarded at `sync.ts:167` |
| Trade initiator / consenters / FAAB legs | Trade transaction: `creator` (user_id), `consenter_ids` (roster_ids), `waiver_budget[] {sender, receiver, amount}` | Yes ([transactions](https://docs.sleeper.com/#get-transactions)) | Today the proposer is inferred as `roster_ids[0]` (`sync.ts:195-211`, `docs/llds/sleeper-sync.md:109`). The docs do not state that convention. `creator` is the documented initiator field |
| Rejected / withdrawn proposals between other teams | `/transactions/{week}` statuses other than `complete` | **Unverified.** The docs only show `complete` | The repo already maps `failed`/`dropped` (`sync.ts:184-186`). Whether proposals between other teams appear in this public endpoint has not been confirmed |
| Draft history | `GET /league/{id}/drafts`, `GET /draft/{id}` (`slot_to_roster_id`, `draft_order`), `GET /draft/{id}/picks` (`player_id`, `roster_id`, `round`, `pick_no`, `is_keeper`, `metadata.position`) | Yes ([drafts](https://docs.sleeper.com/#get-all-drafts-for-a-league), [picks](https://docs.sleeper.com/#get-all-picks-in-a-draft)) | `draft_id` is already in the league payload. Rookie-draft positional preferences per manager |
| Draft-level traded picks | `GET /draft/{id}/traded_picks` | Yes ([docs](https://docs.sleeper.com/#get-traded-picks-in-a-draft)) | Redundant with league `traded_picks` for our use |
| Manager metadata | `/users`: `is_owner`, `avatar`, `username`, `metadata.team_name` | Yes ([users](https://docs.sleeper.com/#getting-users-in-a-league)) | Little predictive value. `user_id` is the stable key across seasons, which `roster_id` is not guaranteed to be (**unverified**) |
| Player age / experience from Sleeper | `/players/nfl` → `age`, `years_exp`, `injury_status` | Yes ([players](https://docs.sleeper.com/#fetch-all-players)) | Already fetched and trimmed away (`registry-cache.ts:60-75`). Would fill `age: null` for unmatched players (`context.ts:203`) |
| Taxi squad | `rosters[].taxi` | **Not in official docs.** Used by the repo (`sync.ts:229`) | Already synced as `slot_type='taxi'` |

---

## 3. Candidate counterparty signals

Cost key. **Free**: a query or derived computation over data already in SQLite. **Cheap**: new columns or a table, filled from a payload we already fetch. **Moderate**: new GETs and a new table/sync step. **High**: multi-season backfill or identity mapping.

| Signal | Available? | Exact source | Freshness | Cost to add |
|---|---|---|---|---|
| **Contend vs rebuild status** (record) | Yes | `sleeper_teams.wins/losses/ties`; `classifyTeamContext` already accepts any team (`rosterEvaluator.ts:126`) | Each sync (≤15 min) | **Free.** Call it with the counterparty's team. Weak early in the season (0 games → winPct 0.5, `rosterEvaluator.ts:128`) |
| Contend vs rebuild (points-based, less luck-driven) | Yes, stored | `sleeper_teams.points_for/points_against` | Each sync | **Free.** Add the two columns to the `context.ts:412-423` select and to `TeamRoster` |
| Contend vs rebuild (roster-based) | Derivable | Starter dynasty value and starter age from `sleeper_rosters` × `players` | Each sync + ETL | **Free.** Pure computation. Works in the off-season and week 1 |
| **Roster age profile** | Derivable | Value-weighted mean age of starters/top-N from `players.age` | ETL cadence for age; sync for roster | **Free.** Unmatched players lack age, so it is **cheap** to fill from `/players/nfl` `age` |
| **Pick hunger / pick aversion** | Partial | Pick-to-player ratio, `tradeScorer.ts:360-402` (count only, weight 0.1) | Each sync | **Free** to improve: value-weight the picks via `pickValues` and combine with contend/rebuild status |
| **Positional need** | Yes | Composites/needs, `tradeRecommender.ts:92-124` | Each sync | Already used |
| **Playoff status / odds** | Partial | Record (now); `winners_bracket`/`losers_bracket` (only once seeded); playoff team count in undocumented league `settings` | Each sync | **Cheap-Moderate.** Persist `league.settings` (already fetched), plus 2 GETs per league for brackets |
| **Trade frequency** (current season) | Yes, stored | Count of `sleeper_trade_offers` rows with `status='complete'` per roster (proposer or responder) | Each sync | **Free.** Load completed trades into context |
| **"Never trades picks" / pick-trading tendency** | Partial | `sleeper_trade_offers.draft_picks` on completed trades (current season); `sleeper_traded_picks` shows net pick movement across all seasons but not *when* | Each sync | **Free** for current season + net pick flow. **High** for multi-season history (walk `previous_league_id`, sweep each season, key by `owner_id`/user_id) |
| **Buys vs sells veterans** (age direction of past trades) | Partial | Completed trades' `adds`/`drops` × `players.age` | Each sync | **Free** (current season). Sample sizes will be tiny in most leagues |
| Manager activity / engagement | Yes, not stored | `rosters[].settings.total_moves`, `waiver_budget_used`; FA/waiver transactions discarded at `sync.ts:167` | Each sync | **Cheap.** Add columns to `sleeper_teams`; optionally a `sleeper_transactions` table for non-trade moves |
| FAAB remaining / FAAB in trades | Yes, not stored | `waiver_budget_used` (roster), `waiver_budget[]` (trade), `settings.waiver_bid` (waiver). Total budget is in the undocumented league settings | Each sync | **Cheap** (same payloads) |
| Rejection history (what they turned down) | **Unverified** | Non-complete trade statuses in `/transactions` | Each sync | Free if the API exposes it. Needs confirmation against a real league |
| Rookie-draft preferences | Yes, not synced | `/league/{id}/drafts` → `/draft/{id}/picks` | Static after each draft | **Moderate.** New table plus 2+ GETs per draft per season |
| Weekly scoring trend / all-play record | Yes, not synced | `/matchups/{week}` `points` | Weekly | **Moderate.** One GET per week, new table |
| Manager identity across seasons | Yes | `owner_id` (stored); `previous_league_id` (fetched, dropped) | Static | **High** only as a prerequisite for multi-season tendencies |

---

## Implications

Ranked by value to an acceptance model against cost.

1. **Counterparty contend/rebuild status (free).** Apply `classifyTeamContext` to the counterparty and combine it with points-for (already stored, just not selected) and a roster-based strength/age profile, so it also works at 0-0. On its own this would have blocked the Rodgers-for-a-1st case: a rebuilding counterparty should not want a 42-year-old.
2. **Roster age profile (free).** Value-weighted starter age. It is the most direct "would they want a 30+ player" signal and needs no new data.
3. **Pick hunger, value-weighted (free).** Upgrade the existing count-based liquidity signal to use `pickValues` and condition it on contend/rebuild. That turns "has picks" into "willing to spend picks".
4. **Current-season completed trades (free).** Load `status='complete'` rows into context to get trade frequency and pick-trading tendency. Useful, but small samples.
5. **Activity counters and FAAB (cheap).** `total_moves`/`waiver_budget_used` columns separate active managers from dormant ones. Dormant managers rarely accept anything.
6. **Playoff status (cheap-moderate).** Only adds value over win% late in the season, and depends on undocumented league settings.
7. **Multi-season trade history, draft history, matchups (moderate-high).** Defer until the free signals have been tried. "Never trades picks" really needs history, which means walking `previous_league_id`.

Open items to verify against a real league before building on them: rejected-proposal visibility, the `roster_ids[0]`-is-proposer convention vs `creator`, the contents of `league.settings`, and `roster.settings.ppts`.
