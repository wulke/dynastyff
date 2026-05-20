# LLD: Player Value History

## Context

This component extends the ETL pipeline and data model to preserve a history of raw player and pick values across ETL runs. Each ETL execution creates an `etl_runs` record and appends raw per-source values to snapshot tables. The existing `players` and `pick_values` tables are unchanged and continue to serve as the materialized latest-value hot path for drafts.

Drives specs: `docs/specs/player-value-history-specs.md`

## Interface / Data Model

### `etl_runs` (new)

| Column | Type | Notes |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| started_at | TEXT (ISO8601) | Timestamp when ETL began |
| completed_at | TEXT (ISO8601) | Timestamp when ETL finished; NULL if in progress or killed |
| sources_attempted | TEXT (JSON) | Array of source names attempted for that run, e.g. `["ktc","fantasycalc","rosteraudit"]` |
| sources_succeeded | TEXT (JSON) | Array of source names that completed all writes successfully |

### `player_value_snapshots` (new)

| Column | Type | Notes |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| run_id | TEXT | FK → etl_runs.id |
| player_id | TEXT | FK → players.id |
| source | TEXT | `ktc`, `fantasycalc`, `dynastydaddy`, or `rosteraudit` |
| raw_value | INTEGER | Source's native scale (pre-normalization) |

Unique constraint on `(run_id, player_id, source)`.

### `pick_value_snapshots` (new)

| Column | Type | Notes |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| run_id | TEXT | FK → etl_runs.id |
| year | INTEGER | e.g. 2026, 2027, 2028 |
| round | INTEGER | 1-based round |
| source | TEXT | Same values as `player_value_snapshots.source` |
| raw_value | INTEGER | Source's native scale (pre-normalization) |

Unique constraint on `(run_id, year, round, source)`.

### `drafts` (change)

Add nullable column `etl_run_id TEXT` — FK → `etl_runs.id`. Points to the ETL run whose values were current when the draft was created. NULL for drafts created before any ETL run exists.

## Logic Flow

### ETL Execution

1. Insert an `etl_run` row: `started_at = now()`, `sources_attempted = all active source names for this run`, `sources_succeeded = []`, `completed_at = NULL`.
2. Run scrapers with existing concurrency and partial failure logic (unchanged).
3. For each source that succeeds, execute within a single database transaction:
   a. Write one `player_value_snapshots` row per matched player (raw value, run_id, player_id, source).
   b. Write one `pick_value_snapshots` row per pick value entry (raw value, run_id, year, round, source).
   c. Upsert into `players` and `pick_values` (existing behavior).
   - If any write in (a), (b), or (c) fails, roll back the entire transaction for this source. Treat source as failed; log a warning. Other sources are unaffected.
4. After all sources complete, update `etl_run.sources_succeeded` and `etl_run.completed_at`.

### Draft Creation

When a draft is created, query `SELECT id FROM etl_runs WHERE completed_at IS NOT NULL ORDER BY started_at DESC LIMIT 1`. Set `drafts.etl_run_id` to the result, or NULL if no completed run exists.

### Value History Query

To reconstruct player values at a point in time: join `player_value_snapshots` on `run_id`. Apply min-max normalization at query time over that run's values. `players` is not involved in historical queries — it is the current-state table only.

## Edge Case Probe

- **No ETL run has ever completed** → `drafts.etl_run_id` is NULL; draft reads current `players` values unchanged.
- **KTC returns no supported players** → ETL exits before any source writes; the `etl_runs` row remains with `completed_at = NULL` and `sources_succeeded = []`, so draft pinning ignores the aborted run.
- **ETL process is killed mid-run** → `etl_run.completed_at` remains NULL; sources_succeeded is incomplete. Draft creation query filters `completed_at IS NOT NULL`, so this partial run is never pinned to a draft.
- **Snapshot write fails for a source** → that source's transaction is rolled back in full (no partial snapshot rows, no partial upsert). Source is excluded from this run. Other sources proceed normally.
- **Player exists in snapshot but not in `players`** → impossible by construction: snapshot and upsert are in the same transaction. If the snapshot row exists, the upsert succeeded.
- **`players` updated but no snapshot row written** → impossible by same transaction guarantee.
- **Draft created with NULL etl_run_id** → all downstream draft queries that use player values read directly from `players`. The FK is nullable; no join is attempted.

## Decisions

| Decision | Chosen | Alternatives | Rationale |
|---|---|---|---|
| Storage format | Raw values only | Normalized; both | Raw is the stable source fact. Normalization is a derived computation run at query time against any desired slice of history |
| Run as first-class entity | `etl_runs` table | Timestamp column on snapshots | Enables auditable per-run failure tracking; lets "what did the market look like on date X" be answered as a unit |
| Atomicity scope | Per source | Per run | A source failure must not block other sources; matches existing partial failure semantics |
| `players` / `pick_values` role | Unchanged hot path | Replace with snapshot-derived view | Purely additive change; existing draft consumers are unaffected |
| Draft value pinning | Nullable FK to `etl_runs` on `drafts` | Copy values into draft-specific table | Zero data duplication; single FK column enables exact historical reconstruction via join to `player_value_snapshots` |
| Sleeper integration | Pull on demand via public REST API | Cache locally in `leagues`/`rosters` tables | User needs current roster only; no historical roster tracking required at this stage |
| ETL scheduling | Manual for now | OS-level cron; app-managed scheduler | No infrastructure overhead; cron path documented below as upgrade |

## Future Scope

- **Automated scheduling:** OS-level cron (`launchd` on macOS, `crontab` on Linux) calling `npm run etl` on a weekly or daily schedule. No code changes to the ETL script are required — a single crontab entry is sufficient. Example: `0 6 * * 1 cd /path/to/dynastyff && npm run etl` (runs every Monday at 6am).
- **Platform integrations:** Sleeper is the first integration — pull current roster from Sleeper's public REST API (no auth required) for real-world trade analysis. Other platforms to track as future scope: MFL, Fleaflicker, ESPN, Yahoo.
- **Data retention:** Annual export + pruning of snapshot rows older than N months to bound database size as history accumulates.
