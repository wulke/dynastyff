# EARS Specs: Sleeper Sync

Drives: `docs/llds/sleeper-sync.md`

Status markers: `[x]` implemented · `[ ]` gap · `[D]` deferred

---

## Invocation

**DFF-SLS-001** `[ ]`
The system shall expose an `npm run sync:sleeper` command that executes the Sleeper sync step in isolation without running the full ETL scraper pipeline.

**DFF-SLS-002** `[ ]`
When `npm run etl` completes the player value scraper phase, the system shall run the Sleeper sync step as the final step of the ETL pipeline.

**DFF-SLS-003** `[ ]`
When no leagues are present in `sleeper_connections`, the system shall skip the Sleeper sync step silently and log a single informational message indicating no leagues are configured.

**DFF-SLS-004** `[ ]`
Failure of the Sleeper sync step shall not fail the overall ETL run; the system shall log a warning per failed league and allow the ETL run to complete successfully.

---

## League Connection

**DFF-SLS-010** `[ ]`
The system shall expose `GET /sleeper/user/:username` which resolves a Sleeper username to a Sleeper user ID and returns the list of dynasty leagues for the current NFL season.

**DFF-SLS-011** `[ ]`
The system shall expose `GET /sleeper/league/:league_id` which returns league metadata for a given Sleeper league ID, allowing the user to preview a league before connecting.

**DFF-SLS-012** `[ ]`
The system shall expose `POST /sleeper/connections` which adds a league to `sleeper_connections` and records `league_id`, `league_name`, `season`, `user_id`, and `roster_id`.

**DFF-SLS-013** `[ ]`
The system shall expose `DELETE /sleeper/connections/:id` which removes a league from `sleeper_connections`.

**DFF-SLS-014** `[ ]`
The system shall expose `GET /sleeper/connections` which returns all currently connected leagues.

---

## On-Demand Sync

**DFF-SLS-020** `[ ]`
The system shall expose `POST /sleeper/sync` which triggers an immediate Sleeper-only sync for all connected leagues and returns after the sync completes.

**DFF-SLS-021** `[ ]`
The system shall expose `GET /sleeper/sync/status` which returns the last sync run result per league, including `started_at`, `completed_at`, and any per-league errors.

**DFF-SLS-022** `[ ]`
On Express server startup, when at least one league is connected and the most recent sync for any league is older than 15 minutes, the system shall trigger a background Sleeper sync without blocking server startup or incoming requests.

---

## Sleeper API Calls

**DFF-SLS-030** `[ ]`
For each connected league, the system shall call `GET /league/{league_id}` to fetch league settings and metadata.

**DFF-SLS-031** `[ ]`
For each connected league, the system shall call `GET /league/{league_id}/rosters` to fetch all team rosters expressed as arrays of Sleeper player IDs.

**DFF-SLS-032** `[ ]`
For each connected league, the system shall call `GET /league/{league_id}/users` to fetch team owner display names.

**DFF-SLS-033** `[ ]`
For each connected league, the system shall call `GET /league/{league_id}/transactions/{week}` to fetch pending and recent trade offers.

**DFF-SLS-034** `[ ]`
The system shall fetch the Sleeper NFL player registry from `GET /players/nfl` once per sync run and cache the result to `data/sleeper-players-cache.json`.

**DFF-SLS-035** `[ ]`
When `data/sleeper-players-cache.json` exists and is less than 24 hours old, the system shall use the cached registry without making a new API call.

**DFF-SLS-036** `[ ]`
When `data/sleeper-players-cache.json` is absent or older than 24 hours and the `/players/nfl` fetch fails, the system shall abort the sync for all leagues and log a clear error. When a valid cache exists, the system shall proceed using the stale cache and log a warning.

---

## Player Matching

**DFF-SLS-040** `[ ]`
For each Sleeper player ID on a roster, the system shall look up the player's `full_name` and `position` from the cached Sleeper player registry.

**DFF-SLS-041** `[ ]`
The system shall match each Sleeper player to a canonical `players` table row using the same name + position fuzzy match pipeline used by the ETL scrapers (exact match → Dice ≥ 0.85 → `player-aliases.json`).

**DFF-SLS-042** `[ ]`
Matched Sleeper ID → `players.id` mappings shall be stored in `sleeper_player_map` and reused across subsequent sync runs without re-running the match algorithm.

**DFF-SLS-043** `[ ]`
When a Sleeper player ID cannot be matched to any canonical `players` row, the system shall store the roster entry with `players_id = NULL` and log a warning. The sync shall continue.

---

## Persistence

**DFF-SLS-050** `[ ]`
The system shall upsert one row per connected league into `sleeper_leagues` on each sync, updating `name`, `season`, `scoring_settings`, `roster_positions`, `total_rosters`, `status`, and `synced_at`.

**DFF-SLS-051** `[ ]`
The system shall upsert one row per team per league into `sleeper_teams` on each sync, updating `display_name`, `team_name`, `wins`, `losses`, `ties`, `points_for`, and `points_against`.

**DFF-SLS-052** `[ ]`
The system shall replace all `sleeper_rosters` rows for a league on each sync, writing one row per player slot with `slot_type` (`starter` | `bench` | `ir` | `taxi`), `sleeper_player_id`, and `players_id`.

**DFF-SLS-053** `[ ]`
The system shall upsert rows into `sleeper_trade_offers` for all transactions with `type = 'trade'` fetched from the transactions endpoint, recording `status`, `proposer_roster_id`, `responder_roster_ids`, `adds`, `drops`, and `draft_picks`.

**DFF-SLS-054** `[ ]`
The system shall insert one row into `sleeper_sync_runs` per sync execution, recording `started_at`, `completed_at`, `league_ids_attempted`, `league_ids_succeeded`, and `error` (nullable).

---

## Partial Failure

**DFF-SLS-060** `[ ]`
When a network error or unexpected API response shape occurs for a single league during sync, the system shall skip that league, record the error in `sleeper_sync_runs`, and continue syncing remaining leagues.

**DFF-SLS-061** `[ ]`
When an individual roster or transaction payload for a league has an unexpected shape, the system shall skip that payload, log a warning, and continue processing the rest of the league's data.

**DFF-SLS-062** `[ ]`
Per-source columns in `sleeper_*` tables for leagues that fail a sync run shall remain unchanged; the system shall not overwrite existing data with nulls for failed leagues.

---

## Season Year

**DFF-SLS-070** `[ ]`
The system shall derive the current NFL season year as: the current calendar year when the current month is September or later, otherwise the previous calendar year.

**DFF-SLS-071** `[ ]`
When fetching leagues for a user, the system shall use the derived season year as the `{season}` parameter in `GET /user/{user_id}/leagues/nfl/{season}`.
