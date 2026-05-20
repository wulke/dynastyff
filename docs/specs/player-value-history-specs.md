# EARS Specs: Player Value History

Drives: `docs/llds/player-value-history.md`

Status markers: `[x]` implemented · `[ ]` gap · `[D]` deferred

---

## Schema — `etl_runs`

**DFF-HIST-001** `[x]` → #31
The system shall store each ETL execution in an `etl_runs` table with the following columns: id, started_at, completed_at, sources_attempted (JSON array), sources_succeeded (JSON array).

**DFF-HIST-002** `[x]` → #32
The system shall set `etl_runs.completed_at` to NULL when the run is created and update it to the current timestamp only after all source writes have finished.

---

## Schema — `player_value_snapshots`

**DFF-HIST-010** `[x]` → #31
The system shall store raw player values from each source in a `player_value_snapshots` table with the following columns: id, run_id (FK → etl_runs.id), player_id (FK → players.id), source, raw_value.

**DFF-HIST-011** `[x]` → #31
The system shall restrict `player_value_snapshots.source` to the values: `ktc`, `fantasycalc`, `dynastydaddy`, `rosteraudit`.

**DFF-HIST-012** `[x]` → #31
The system shall enforce a unique constraint on `(run_id, player_id, source)` in `player_value_snapshots`.

---

## Schema — `pick_value_snapshots`

**DFF-HIST-020** `[x]` → #31
The system shall store raw pick values from each source in a `pick_value_snapshots` table with the following columns: id, run_id (FK → etl_runs.id), year, round, source, raw_value.

**DFF-HIST-021** `[x]` → #31
The system shall restrict `pick_value_snapshots.source` to the same values as `player_value_snapshots.source`.

**DFF-HIST-022** `[x]` → #31
The system shall enforce a unique constraint on `(run_id, year, round, source)` in `pick_value_snapshots`.

---

## Schema — `drafts`

**DFF-HIST-030** `[x]` → #31
The system shall add a nullable `etl_run_id` column to `drafts` as a foreign key referencing `etl_runs.id`.

---

## ETL Run Lifecycle

**DFF-HIST-040** `[x]` → #32
When ETL begins, the system shall insert a row into `etl_runs` with `started_at` set to the current timestamp, `sources_attempted` set to the list of active ETL source names for that run, `sources_succeeded` set to an empty array, and `completed_at` set to NULL.

**DFF-HIST-041** `[x]` → #32
When all source writes are complete, the system shall update the `etl_run` row with `completed_at` set to the current timestamp and `sources_succeeded` set to the list of sources that completed successfully.

**DFF-HIST-042** `[x]` → #32
When ETL exits early because KTC yields no supported players, the system shall leave `etl_runs.completed_at` as NULL and `etl_runs.sources_succeeded` as an empty array.

---

## Per-Source Atomicity

**DFF-HIST-050** `[x]` → #32
For each source that succeeds, the system shall write `player_value_snapshots` rows, `pick_value_snapshots` rows, and upsert into `players` and `pick_values` within a single database transaction.

**DFF-HIST-051** `[x]` → #32
When any write within a source's transaction fails, the system shall roll back the entire transaction for that source, exclude the source from `sources_succeeded`, and continue processing remaining sources.

**DFF-HIST-052** `[x]` → #32
The system shall store only the source's raw (pre-normalization) value in `player_value_snapshots.raw_value` and `pick_value_snapshots.raw_value`.

---

## Draft Value Pinning

**DFF-HIST-060** `[x]` → #33
When a draft is created, the system shall set `drafts.etl_run_id` to the id of the most recently completed ETL run (the `etl_runs` row with the latest `started_at` where `completed_at IS NOT NULL`).

**DFF-HIST-061** `[x]` → #33
When no completed ETL run exists at draft creation time, the system shall set `drafts.etl_run_id` to NULL.

**DFF-HIST-062** `[ ]` → #33
When `drafts.etl_run_id` is NULL, the system shall fall back to reading current player values directly from `players` for all draft operations.
Status note: current draft operations still use `players` because snapshot-based draft value reads have not been implemented yet; explicit fallback branching remains future work.
