# EARS Specs: Data Model

Drives: `docs/llds/data-model.md`

Status markers: `[x]` implemented · `[ ]` gap · `[D]` deferred

---

## Players

**DFF-DATA-001** `[x]`
The system shall store each player with the following attributes: id, name, position, nfl_team, age, is_rookie, dynasty_value, value_ktc, value_fantasycalc, value_dynastydaddy, value_rosteraudit, adp, updated_at.

**DFF-DATA-002** `[x]`
The system shall restrict `players.position` to the values: QB, RB, WR, TE.

**DFF-DATA-003** `[ ]`
When the ETL pipeline refreshes player data, the system shall update `players.dynasty_value`, all non-NULL per-source value columns (`value_ktc`, `value_fantasycalc`, `value_dynastydaddy`, `value_rosteraudit`), `players.adp`, and `players.updated_at` for all rows where the player already exists.

**DFF-DATA-005** `[x]`
The system shall store per-source normalized dynasty values for each player in `value_ktc`, `value_fantasycalc`, `value_dynastydaddy`, and `value_rosteraudit`; each column shall be NULL when that source did not provide a value for the player.

**DFF-DATA-004** `[ ]`
When the ETL pipeline encounters a player not currently in `players`, the system shall insert a new row for that player with all required attributes.

---

## Pick Values

**DFF-DATA-010** `[x]`
The system shall store a dynasty value for each future pick asset keyed by `(year, round)` in the `pick_values` table with the following columns: id, year, round, dynasty_value, updated_at.

**DFF-DATA-011** `[x]`
When the ETL pipeline refreshes pick value data, the system shall update `pick_values.dynasty_value` and `pick_values.updated_at` for all rows where `(year, round)` already exists.

**DFF-DATA-012** `[x]`
When the ETL pipeline encounters a `(year, round)` combination not currently in `pick_values`, the system shall insert a new row for that combination.

---

## Drafts

**DFF-DATA-020** `[x]`
When a draft is created, the system shall persist: team_count, rounds, scoring_format, user_pick_position, future_pick_years, future_pick_rounds, and roster_config as a JSON blob.

**DFF-DATA-021** `[x]`
The system shall restrict `drafts.scoring_format` to the values: `ppr`, `half_ppr`, `standard`.

**DFF-DATA-022** `[x]`
The system shall restrict `drafts.status` to the values: `in_progress`, `completed`.

**DFF-DATA-023** `[x]`
When a draft is completed, the system shall set `drafts.completed_at` to the current timestamp.

---

## Teams

**DFF-DATA-030** `[x]`
When a draft is created, the system shall create exactly `drafts.team_count` team rows associated with that draft.

**DFF-DATA-031** `[x]`
When a draft is created, the system shall assign exactly one team with `is_user = 1`; all other teams shall have `is_user = 0`.

**DFF-DATA-032** `[x]`
When a draft is created, the system shall assign each bot team a name from the predefined generic name list (e.g. Bob, Carl) and a randomly selected archetype.

**DFF-DATA-033** `[x]`
The system shall restrict `teams.archetype` to the values: `win_now`, `punt`, `rb_heavy`, `qb_early`, `bpa`, `balanced`, and NULL (for the user's team).

---

## Draft Order

**DFF-DATA-040** `[x]`
When a draft is created, the system shall generate `drafts.team_count × drafts.rounds` rows in `draft_order`, covering every pick slot in snake order.

**DFF-DATA-041** `[x]`
The system shall assign pick slots in odd rounds in ascending team position order and in even rounds in descending team position order.

**DFF-DATA-042** `[ ]`
When a pick slot trade is accepted, the system shall update `draft_order.team_id` for the affected rows to reflect the new owner.

---

## Picks

**DFF-DATA-050** `[x]`
When a player is drafted, the system shall immediately write a row to `picks` with: draft_id, draft_order_id, team_id, player_id, pick_number, round, and picked_at.

**DFF-DATA-051** `[x]`
The system shall never update or delete a row in `picks` after it is written; picks are an immutable historical record.

**DFF-DATA-052** `[x]`
When a player is drafted, the system shall write a corresponding row to `roster_players` with the drafting team as the current owner.

---

## Roster Players

**DFF-DATA-060** `[x]`
The system shall store current player ownership in `roster_players` with the following columns: id, draft_id, team_id, player_id.

**DFF-DATA-061** `[x]`
The system shall maintain exactly one row in `roster_players` per player per draft at all times after that player is drafted.

**DFF-DATA-062** `[ ]`
When a player-for-player trade is accepted, the system shall update `roster_players.team_id` for each traded player to reflect the new owning team.

**DFF-DATA-063** `[ ]`
The system shall use `roster_players` as the authoritative source of current player ownership; `picks.team_id` shall not be used for ownership queries.

---

## Team Pick Assets

**DFF-DATA-070** `[x]`
When a draft is created, the system shall initialize `team_pick_assets` with one row per team per future pick (future_pick_years × future_pick_rounds), giving all teams identical starting inventories.

**DFF-DATA-071** `[ ]`
When a future pick asset trade is accepted, the system shall update `team_pick_assets.team_id` for the affected rows to reflect the new owner.

**DFF-DATA-072** `[ ]`
When querying the dynasty value of a future pick asset, the system shall join `team_pick_assets` to `pick_values` on `(year, round)`.

---

## User Queue

**DFF-DATA-090** `[x]`
The system shall store the user's player watchlist in a `user_queue` table with the following columns: id, draft_id, player_id, rank.

**DFF-DATA-091** `[x]`
The system shall maintain exactly one row per player per draft in `user_queue`; adding a player already in the queue shall update its rank rather than insert a duplicate.

**DFF-DATA-092** `[x]`
When a queued player is drafted (by any team), the system shall remove that player's row from `user_queue`.

**DFF-DATA-093** `[x]` → #60
The system shall expose queue management via: POST /drafts/:id/queue (add or update), DELETE /drafts/:id/queue/:player_id (remove), and GET /drafts/:id/queue (retrieve ordered list).

---

## Trades

**DFF-DATA-080** `[x]`
When a trade is resolved, the system shall write a row to `trades` with: draft_id, pick_number, round, initiating_team_id, receiving_team_id, assets_sent (JSON), assets_received (JSON), status, and created_at.

**DFF-DATA-081** `[x]`
The system shall restrict `trades.status` to the values: `accepted`, `declined`, `force_declined`.

**DFF-DATA-082** `[ ]`
The system shall record declined and force-declined trades in `trades` with the appropriate status; only accepted trades trigger asset transfers.
