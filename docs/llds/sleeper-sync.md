# LLD: Sleeper Sync

## Context

Sleeper Sync is an ETL sub-module that fetches league state from the Sleeper public API (read-only, no auth required) for all leagues the user has connected. It runs as the final step of `npm run etl` and can also be triggered independently via `npm run sync:sleeper`. Results are persisted to the `sleeper_*` SQLite tables and are reused by the Season Manager on every season management request.

On app load and on manual refresh (My Team section), the Express server triggers a lightweight Sleeper-only sync (equivalent to `npm run sync:sleeper`) without re-running the full Playwright scraper pipeline.

Drives specs: `docs/specs/sleeper-sync-specs.md`

## Responsibilities

- Resolve a Sleeper username to a user ID via the Sleeper API
- List all dynasty leagues for a given Sleeper user ID and season year
- Accept a league ID directly as an alternative to username resolution
- Fetch full league state for each connected league: settings, rosters, users, transactions (trade offers)
- Map Sleeper player IDs to canonical `players` table rows (by name + position fuzzy match)
- Persist synced state to `sleeper_leagues`, `sleeper_rosters`, `sleeper_players`, `sleeper_teams`, and `sleeper_trade_offers`
- Record each sync in `sleeper_sync_runs` with timestamp and outcome

## Architecture

```
npm run etl  (or npm run sync:sleeper)
    └── src/etl/sleeper/index.ts        — orchestrator
            ├── resolveUser()           — GET /user/{username}
            ├── fetchLeagues()          — GET /user/{id}/leagues/nfl/{season}
            ├── fetchLeagueState()      — per league:
            │       ├── GET /league/{id}
            │       ├── GET /league/{id}/rosters
            │       ├── GET /league/{id}/users
            │       └── GET /league/{id}/transactions/{week}
            ├── matchPlayers()          — map Sleeper player IDs → players.id
            └── upsert()                — write sleeper_* tables
```

The Sleeper sync step is skipped silently (with a log message) if no leagues are configured in `sleeper_connections`. It does not block ETL completion or prevent player value writes from proceeding.

## Sleeper API Endpoints Used

All endpoints are read-only and require no authentication.

| Endpoint | Purpose |
|---|---|
| `GET https://api.sleeper.app/v1/user/{username}` | Resolve username → user ID |
| `GET https://api.sleeper.app/v1/user/{user_id}/leagues/nfl/{season}` | List user's leagues for a season |
| `GET https://api.sleeper.app/v1/league/{league_id}` | League settings and metadata |
| `GET https://api.sleeper.app/v1/league/{league_id}/rosters` | All team rosters (player IDs) |
| `GET https://api.sleeper.app/v1/league/{league_id}/users` | Team owner names and display names |
| `GET https://api.sleeper.app/v1/league/{league_id}/transactions/{week}` | Trade offers (pending and recent) |
| `GET https://api.sleeper.app/v1/players/nfl` | Full NFL player registry (bulk, cached) |

The Sleeper player registry (`/players/nfl`) is a large payload (~5 MB). It is fetched once per sync run and cached to disk at `data/sleeper-players-cache.json`. The cache is refreshed if it is older than 24 hours or missing. The cache is not committed to the repository.

## League Connection

Connected leagues are stored in the `sleeper_connections` SQLite table (one row per connected league). A league is added when the user completes the connection flow in the My Team section (username lookup → league picker, or direct league ID entry).

```ts
type SleeperConnection = {
  id: string;           // UUID
  league_id: string;    // Sleeper league ID
  league_name: string;
  season: string;       // e.g. "2026"
  user_id: string;      // Sleeper user ID of the local user
  roster_id: number;    // local user's roster ID within this league
  connected_at: string;
  last_synced_at: string | null;
};
```

## Player Matching

Sleeper rosters are expressed as arrays of Sleeper player IDs. Mapping them to the canonical `players` table uses a two-step approach:

1. **Sleeper player cache lookup:** The cached `/players/nfl` payload provides `full_name` and `position` for each Sleeper ID.
2. **Canonical match:** The same name + position fuzzy match used by the ETL pipeline (Dice ≥ 0.85, then `player-aliases.json`) maps the Sleeper name to a `players.id`.

Matched mappings are stored in `sleeper_player_map` (`sleeper_id → players.id`) and reused across sync runs. Unmatched players are recorded with `players_id = NULL` — they appear on the roster but without dynasty value data. A warning is logged per unmatched player.

## Data Model

New tables added to the SQLite schema:

### `sleeper_connections`
One row per connected league. Managed by the My Team connection flow.

### `sleeper_sync_runs`
One row per sync execution. Records `started_at`, `completed_at`, `league_ids_attempted`, `league_ids_succeeded`, and `error` (nullable).

### `sleeper_leagues`
Upserted on each sync. Stores league metadata: `league_id`, `name`, `season`, `scoring_settings` (JSON), `roster_positions` (JSON), `total_rosters`, `status`, `synced_at`.

### `sleeper_teams`
One row per team (roster) per league. Fields: `league_id`, `roster_id`, `owner_id`, `display_name`, `team_name` (nullable), `wins`, `losses`, `ties`, `points_for`, `points_against`.

### `sleeper_rosters`
One row per player slot per team per league. Fields: `league_id`, `roster_id`, `sleeper_player_id`, `players_id` (FK → `players.id`, nullable), `slot_type` (`starter` | `bench` | `ir` | `taxi`), `synced_at`.

### `sleeper_player_map`
Persistent mapping from Sleeper player IDs to canonical `players.id`. Fields: `sleeper_player_id`, `players_id` (nullable), `sleeper_name`, `sleeper_position`, `matched_at`.

### `sleeper_trade_offers`
One row per pending or recently resolved trade offer. Fields: `league_id`, `transaction_id`, `status` (`pending` | `complete` | `failed`), `proposer_roster_id`, `responder_roster_ids` (JSON array), `adds` (JSON), `drops` (JSON), `draft_picks` (JSON array of pick objects), `created_at`, `updated_at`.

## API Surface (Express)

The Express server exposes endpoints for the My Team connection flow and on-demand sync.

| Method | Path | Description |
|---|---|---|
| GET | `/sleeper/user/:username` | Resolve username → user ID + league list |
| GET | `/sleeper/league/:league_id` | Preview a specific league before connecting |
| POST | `/sleeper/connections` | Add a league connection |
| DELETE | `/sleeper/connections/:id` | Remove a league connection |
| GET | `/sleeper/connections` | List all connected leagues |
| POST | `/sleeper/sync` | Trigger a Sleeper-only sync (on-demand) |
| GET | `/sleeper/sync/status` | Last sync run result per league |

## Sync Behavior

**Full ETL run (`npm run etl`):** Sleeper sync runs as the final step after all player value scrapers complete. Failure of the Sleeper sync step does not fail the ETL run; it is logged as a warning with the per-league error detail.

**On app load:** Express calls the sync logic on startup if at least one league is connected and the last sync is older than 15 minutes. This is a background operation — it does not block the server from accepting requests.

**Manual refresh:** `POST /sleeper/sync` triggers an immediate sync for all connected leagues. The response returns after the sync completes (synchronous from the client's perspective).

**Season year:** The sync always targets the current NFL season year (derived from the current calendar date: year N before September, year N during and after September). The connected `sleeper_connections` row stores the season at connection time.

## Partial Failure Behavior

- If one league sync fails (network error, unexpected API shape), that league is skipped and the error is recorded in `sleeper_sync_runs`. Other leagues in the same run proceed normally.
- If `/players/nfl` fetch fails and the cache is absent or expired, the sync is aborted for all leagues and a clear error is logged. If a valid cache exists, the sync proceeds using the stale cache with a warning.
- If the Sleeper API returns an unexpected shape for a roster or transaction, that payload is skipped and logged. The sync does not fail the entire league.

## Decisions

| Decision | Chosen | Alternatives | Rationale |
|---|---|---|---|
| Auth | None — Sleeper public API | OAuth / API key | Sleeper's read endpoints are fully public; no auth reduces friction to zero |
| Player registry cache | Disk cache at `data/sleeper-players-cache.json`, TTL 24h | Fetch per sync; DB cache | ~5 MB payload; disk cache avoids re-fetching on every sync while staying out of the DB schema |
| Player matching strategy | Dice fuzzy match on Sleeper name → canonical `players.id` | Sleeper ID as foreign key | `players` table is keyed by the ETL sources (KTC/FantasyCalc), not by Sleeper IDs; name match reuses the existing cross-source matching infrastructure |
| Unmatched players | Store with `players_id = NULL`, warn | Exclude from roster | Unmatched players still appear on the roster (correct) and the Season Manager degrades gracefully for players without dynasty values |
| Season year logic | Derive from calendar date (≥ September → current year) | User-configured | Automatic derivation eliminates a config option with an obvious default |
| Sync step position in ETL | Final step after scrapers | Parallel with scrapers | Sleeper sync depends on the `players` table being current so player matching uses the freshest canonical rows |
| On-load sync threshold | 15 minutes | Always sync; never auto-sync | Dynasty rosters change infrequently; 15 minutes prevents redundant API calls on quick page refreshes |

## Open Questions

- [ ] Should the user be able to connect multiple leagues simultaneously, or is single-league the initial scope?
- [ ] How should the sync handle mid-season Sleeper roster changes that don't match any ETL player (e.g., a newly signed practice squad player)?
- [ ] Should `sleeper_trade_offers` fetch all weeks from week 1 of the season, or only recent transactions (last N weeks)?
