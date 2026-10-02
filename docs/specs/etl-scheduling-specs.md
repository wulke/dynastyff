# Specs: Scheduled ETL Refresh

| ID | Requirement | Status |
|---|---|---|

*Status: `[ ]` Active, `[x]` Implemented, `[D]` Deferred.*

## Workflow trigger and shape

**DFF-SCHED-001** `[x]` → #198
The system shall provide a GitHub Actions workflow file at `.github/workflows/scheduled-refresh.yml` triggered by a weekly `schedule` cron and by `workflow_dispatch`.

**DFF-SCHED-002** `[x]` → #198
The scheduled-refresh workflow shall run with `concurrency: { group: scheduled-refresh, cancel-in-progress: false }`, so an overlapping manual dispatch queues rather than races or cancels an in-progress run.

**DFF-SCHED-003** `[x]` → #198
The scheduled-refresh workflow shall: install Node 22, run `npm ci`, install Playwright Chromium, run `npm run db:init` to start from an empty database, run `npm run etl`, run `npm run export:snapshot`, then run `npm run etl:sanity-check`.

**DFF-SCHED-004** `[x]` → #198
The scheduled-refresh workflow shall not restore, cache, or persist `data/dynastyff.sqlite` (or the `etl_runs`/`player_value_snapshots`/`pick_value_snapshots` tables it contains) across runs; each run starts from an empty database via `npm run db:init`, matching local/manual `npm run etl` behavior.

## Sanity-check gate

**DFF-SCHED-010** `[x]` → #198
The system shall provide a sanity-check script at `src/etl/sanity-check.ts`, runnable via `npm run etl:sanity-check`, that reads the freshly exported `data/snapshot.json` and the current run's `etl_runs` row.

**DFF-SCHED-011** `[x]` → #198
The sanity-check script shall exit with a non-zero code, blocking the workflow before any commit or PR step, when `data/snapshot.json` has fewer than 400 total players, fewer than 50 QBs, fewer than 100 RBs, fewer than 150 WRs, fewer than 50 TEs, or fewer than 16 pick values.

**DFF-SCHED-012** `[x]` → #198
The sanity-check script's count checks shall be evaluated only against the current run's output — no comparison against a previously committed `data/snapshot.json` or other historical data.

**DFF-SCHED-013** `[x]` → #198
When the current run's `etl_runs.sources_succeeded` is a strict subset of `etl_runs.sources_attempted`, the sanity-check script shall exit 0 and write a warning naming the missing source(s) to `GITHUB_OUTPUT`, rather than blocking the workflow.

## PR-based landing

**DFF-SCHED-020** `[x]` → #198
After the sanity-check step passes, the scheduled-refresh workflow shall diff `data/snapshot.json` against the committed version; if unchanged, the workflow shall complete successfully with no commit and no PR.

**DFF-SCHED-021** `[x]` → #198
When `data/snapshot.json` has changed, the scheduled-refresh workflow shall close any open pull requests whose head branch name starts with `refresh/snapshot-`, each with a comment stating it is superseded by the new refresh, before opening a new PR.

**DFF-SCHED-022** `[x]` → #198
When `data/snapshot.json` has changed, the scheduled-refresh workflow shall create a branch named `refresh/snapshot-<UTC date>-<run number>`, commit `data/snapshot.json` to it as `github-actions[bot]`, push it, and open a pull request against `main` — the workflow shall never push `data/snapshot.json` to `main` directly.

**DFF-SCHED-023** `[x]` → #198
The opened pull request's body shall state that the sanity-check floors passed and, when DFF-SCHED-013 produced a warning, include that source-failure warning.

**DFF-SCHED-024** `[x]` → #198
After opening the pull request, the scheduled-refresh workflow shall dispatch `ci.yml` against the new branch via `gh workflow run ci.yml --ref <branch>`, since pull requests opened by `GITHUB_TOKEN` do not trigger `ci.yml`'s `pull_request` event.

## Operational concerns

**DFF-SCHED-030** `[x]` → #198
The system shall not implement custom failure alerting (e.g. auto-filed issues) for the scheduled-refresh workflow; GitHub Actions' default failure-notification email is the sole alerting mechanism.

**DFF-SCHED-031** `[x]` → #198
The system shall not implement active staleness detection for missed or skipped scheduled runs; `workflow_dispatch` on `scheduled-refresh.yml` is the manual backstop for triggering a refresh out of cadence.

## Retirement of the direct-push workflow

**DFF-SCHED-040** `[x]` → #198
The system shall remove `.github/workflows/etl-snapshot.yml`; `scheduled-refresh.yml`'s `workflow_dispatch` trigger replaces it as the manual, on-demand run path.
