# LLD: Scheduled ETL Refresh

## Context

Today, refreshing `data/snapshot.json` requires a human to either run `npm run etl && npm run export:snapshot` locally, or manually dispatch `.github/workflows/etl-snapshot.yml`, which commits straight to whatever branch triggered it. Neither is scheduled, and the direct-push workflow has no review step.

This LLD replaces `etl-snapshot.yml` with a weekly-cron workflow that runs the ETL, gates the result behind a sanity check, and opens a PR for human review instead of pushing directly — mirroring the sibling project `best-ball-pl`'s `scheduled-refresh.yml`, adapted for this project's stateless-in-CI scope.

Drives specs: `docs/specs/etl-scheduling-specs.md`. Builds on `docs/llds/etl-pipeline.md` (scraper/normalize/aggregate/upsert internals are unchanged) and `docs/llds/static-build.md` (`export:snapshot` unchanged).

Design decisions were resolved via a Wayfinder map ([Map: Scheduled ETL Refresh](https://github.com/wulke/dynastyff/issues/190)) before this LLD was written:

- [History persistence across scheduled CI runs](https://github.com/wulke/dynastyff/issues/191) — CI stays stateless; no `etl_runs`/`player_value_snapshots`/`pick_value_snapshots` carried across scheduled runs.
- [Operational concerns: failure alerting and missed runs](https://github.com/wulke/dynastyff/issues/192) — GitHub Actions' default failure email is the only alerting; `workflow_dispatch` is the missed-run backstop.
- [Sanity-check gate design](https://github.com/wulke/dynastyff/issues/193) — fixed count floors, no historical comparison, partial-source-failure warns rather than blocks.

## Architecture

```
.github/workflows/scheduled-refresh.yml
  on: schedule (weekly) | workflow_dispatch
    ├── npm ci, playwright install
    ├── npm run db:init         — fresh, empty sqlite (no restore/cache — stateless)
    ├── npm run etl              — src/etl/index.ts (unchanged)
    ├── npm run export:snapshot  — src/etl/export-snapshot.ts (unchanged)
    ├── npm run etl:sanity-check — src/etl/sanity-check.ts (new)
    │     reads data/snapshot.json + etl_runs.sources_succeeded
    │     exit 1 on collapsed player/pick counts (blocks the job)
    │     exit 0 + GITHUB_OUTPUT warning on partial source success
    ├── diff data/snapshot.json — no-op if unchanged
    ├── supersede stale open `refresh/snapshot-*` PRs
    └── open PR (never pushes to main directly)
          + `gh workflow run ci.yml --ref <branch>` (GITHUB_TOKEN PRs skip pull_request triggers)
```

`.github/workflows/etl-snapshot.yml` is removed — `scheduled-refresh.yml`'s `workflow_dispatch` trigger is its replacement manual-run path.

## Sanity-check gate (`src/etl/sanity-check.ts`)

Runs after `export:snapshot`, reads the freshly written `data/snapshot.json` plus the current run's `etl_runs` row (same CI-local, gitignored sqlite db — not yet torn down).

**Blocking checks (exit 1, fail the job before commit/PR):**

| Check | Floor |
|---|---|
| Total players | `>= 400` |
| QB count | `>= 50` |
| RB count | `>= 100` |
| WR count | `>= 150` |
| TE count | `>= 50` |
| Pick values | `>= 16` |

No comparison against the previously committed snapshot — a pure function of this run's output, consistent with the stateless-CI decision (#191).

**Non-blocking signal (exit 0, informational):** reads `sources_succeeded` from the most recent `etl_runs` row. If it's a strict subset of the sources the ETL attempted, writes a warning line to `GITHUB_OUTPUT` (`sources_warning`) naming the missing source(s); the workflow step interpolates that into the PR body. No aggregate `dynasty_value` degeneracy check is added — DFF-ETL-032's per-source degenerate handling already prevents a collapsed aggregate. No freshness check — no caching layer sits between scrape and export in this pipeline.

`sources_succeeded`/`sources_attempted` are stored as JSON string arrays (see `src/db/schema.ts`); the script `JSON.parse`s both and diffs them.

## Workflow steps (`scheduled-refresh.yml`)

1. `schedule: cron '0 6 * * 1'` (weekly, Monday 06:00 UTC) + `workflow_dispatch: {}`.
2. `concurrency: { group: scheduled-refresh, cancel-in-progress: false }` — a manual dispatch must not race a concurrent cron run's supersede/push/PR sequence.
3. `permissions: { contents: write, pull-requests: write, actions: write }`.
4. Steps: checkout → setup-node@22 → `npm ci` → `npx playwright install --with-deps chromium` → `npm run db:init` → `npm run etl` → `npm run export:snapshot` → `npm run etl:sanity-check`.
5. Diff `data/snapshot.json`; if unchanged, the job ends cleanly (no-op) — no commit, no PR.
6. If changed: close any open PRs whose head branch starts with `refresh/snapshot-`, each with a comment explaining they're superseded (the snapshot is full-state, so the newest refresh supersedes any older one).
7. Create branch `refresh/snapshot-<UTC date>-<run number>`, commit `data/snapshot.json` as `github-actions[bot]`, push, open a PR to `main` whose body states the sanity-check floors passed and includes the partial-source-failure warning (if any) from step 4's `GITHUB_OUTPUT`.
8. `gh workflow run ci.yml --ref <branch>` — PRs opened by `GITHUB_TOKEN` don't trigger `ci.yml`'s `pull_request` event, so it's dispatched explicitly to populate the required check on the branch's commit.

## Edge Case Probe

- All scrapers fail (`DFF-ETL-052` exits non-zero) → `npm run etl` step fails → job fails before `export:snapshot` runs → no PR, GitHub's default failure email fires.
- Sanity-check gate blocks (collapsed counts) → job fails after `export:snapshot` but before diff/PR → no PR, no commit, failure email fires.
- `data/snapshot.json` unchanged → job completes successfully with no PR — a legitimate no-op, not a failure.
- A manual `workflow_dispatch` run overlaps a cron-triggered run → `concurrency.cancel-in-progress: false` queues the second run rather than cancelling either mid-supersede.
- Partial scraper success (e.g. 1-of-3 sources) with counts still above floor → PR opens normally, with a warning section in its body naming the failed source(s); a human reviewer weighs it before merging.
