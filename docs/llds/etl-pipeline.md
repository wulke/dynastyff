# LLD: ETL Pipeline

## Context

The ETL pipeline is a standalone script (`src/etl/index.ts`) that populates the local SQLite database. It is invoked manually via `npm run etl` — no scheduling, no server dependency. It shares the Drizzle ORM schema and database module with the Express server.

Drives specs: `docs/specs/etl-pipeline-specs.md`

## Architecture

```
npm run etl
    └── src/etl/index.ts
            ├── runScrapers()          — launches scrapers with concurrency limit 2
            │       ├── scraper/ktc.ts
            │       ├── scraper/fantasycalc.ts
            │       └── scraper/rosteraudit.ts
            ├── normalize()            — current slice normalizes KTC player values to 0–9999
            └── upsert()               — current slice writes players to SQLite
```

Cross-source player matching, multi-source aggregation, and pick value persistence are introduced in follow-on issues (#4, #5, #6). Issue #3 establishes the shared scraper contract and orchestration boundary those later slices build on.

## Scrapers

Each scraper is a self-contained module that returns the shared typed result object. All four use Playwright (headless Chromium) to handle JS-rendered pages.

### Scraper contract

```ts
type ScraperResult = {
  source: 'ktc' | 'fantasycalc' | 'dynastydaddy' | 'rosteraudit';
  players: RawPlayer[];
  pickValues: RawPickValue[];
};

type RawPlayer = {
  name: string;
  position: 'QB' | 'RB' | 'WR' | 'TE';
  nflTeam: string;
  age: number | null;
  isRookie: boolean;
  rawValue: number;   // source's native scale
  adp: number | null;
};

type RawPickValue = {
  year: number;
  round: number;
  rawValue: number;
};
```

Scrapers throw on unrecoverable failure (site unreachable, structure changed). Partial-failure handling is added in issue #6.
DynastyDaddy remains implemented as a scraper module, but it is temporarily excluded from the live `npm run etl` source list due to scraper instability.

## Concurrency

Scrapers run two at a time using a simple promise pool. Order of execution is not guaranteed.

```
[ktc, fantasycalc, rosteraudit]
  → run ktc + fantasycalc in parallel
  → run rosteraudit
```

## Current Write Path

The current ETL write path is source-aware and history-aware.
DynastyDaddy remains implemented as a scraper module, but it is temporarily excluded from the live `npm run etl` job due to scraper instability.

1. `runScrapers()` launches KTC, FantasyCalc, and RosterAudit with a maximum concurrency of 2.
2. `runEtl()` inserts an `etl_runs` row at the start of execution with the active attempted sources (`ktc`, `fantasycalc`, `rosteraudit`) and `completed_at = NULL`.
3. Each successful source is processed in its own database transaction:
   - normalize that source's player and pick values
   - write raw `player_value_snapshots` and `pick_value_snapshots`
   - update the current-state `players` and `pick_values` tables
4. If any write fails inside a source transaction, the full source transaction is rolled back and excluded from `sources_succeeded`.
5. After all source transactions finish, `runEtl()` updates the `etl_runs` row with `completed_at` and the final `sources_succeeded` list.

## Player Matching

Cross-source player matching is implemented during ETL startup before non-KTC source values are written into the hot `players` table.

1. Load `player-aliases.json` from the project root once at ETL startup.
2. Normalize each source's player values independently with the existing min-max path.
3. Write KTC players first so KTC establishes the canonical player rows and metadata for the run.
4. For each non-KTC player, attempt to match an existing canonical row at the same position in this order:
   - exact match on normalized name
   - highest Dice-coefficient fuzzy match on normalized name, accepted only if score is `>= 0.85`
   - alias lookup using `player-aliases.json`
5. When a non-KTC player matches, update only that source's value column, recompute `dynasty_value` as the rounded mean of all non-NULL per-source values, and keep the canonical name / metadata from the highest-priority matched source.
6. When a non-KTC player does not match, log a warning and exclude that player from the hot `players` table for the run.

**`player-aliases.json` format:**

```json
{
  "aliases": [
    {
      "canonical": "Odell Beckham Jr.",
      "variants": ["Odell Beckham", "OBJ"]
    }
  ]
}
```

## Normalization

Each source is normalized independently using min-max scaling:

```
normalized = round((raw - min) / (max - min) * 9999)
```

- In the current implementation, normalization is applied only to the KTC player payload before upsert.
- Follow-on issue #5 extends normalization to pick values and additional sources.
- If a source returns only one player (degenerate case), that player is assigned value 9999 and a warning is logged.

## Aggregation

Player aggregation is implemented as the rounded mean of the non-NULL normalized source columns:

`round(mean(value_ktc, value_fantasycalc, value_dynastydaddy, value_rosteraudit))`

Only source columns that successfully matched the canonical player row participate in the mean.

## Partial Failure Behavior

Partial-failure handling is specified for issue #6 and has not been implemented in this slice.

## Edge Case Probe

- Missing `etl_runs` table -> print a `npm run db:init` guidance error and exit with code 1 before attempting any ETL writes
- Playwright page never reaches `networkidle` -> warn and continue scraping the currently loaded DOM
- KTC returns no supported players -> exit before any source writes; leave the `etl_runs` row incomplete so draft pinning ignores it
- DynastyDaddy runtime instability -> keep the scraper module in the codebase, but exclude it from the live `npm run etl` source list until re-enabled

## Upsert

All writes use Drizzle ORM against the shared SQLite database.

**Players:**
- Canonical rows are established by the highest-priority matched source: `KTC -> FantasyCalc -> DynastyDaddy -> RosterAudit`.
- Existing row matching uses normalized-name exact match first, then same-position Dice fuzzy match, then alias override.
- On KTC match: update canonical name, metadata, `value_ktc`, `dynasty_value`, `adp`, and `updated_at`.
- On non-KTC match: update the corresponding `value_*` column, recompute `dynasty_value`, and update `updated_at`.
- On unmatched KTC row: insert a new row with a generated UUID and `NULL` for all missing source columns.
- On unmatched non-KTC row: log a warning and exclude that player's value from the hot `players` table for the run.

**Pick values:**
- Pick value persistence is specified for issue #5 and has not been implemented in this slice.

## File Layout

```
src/etl/
  index.ts                  — orchestrator: concurrency, current KTC normalization, players upsert
  normalize.ts              — min-max scaling utilities
  scraper/
    shared.ts
    ktc.ts
    fantasycalc.ts
    dynastydaddy.ts
    rosteraudit.ts
```

## Decisions

| Decision | Chosen | Alternatives | Rationale |
|---|---|---|---|
| Scraping tool | Playwright (headless Chromium) | Cheerio, Puppeteer | Handles JS-rendered pages; all four sources may require it; single tool across all scrapers |
| Concurrency limit | 2 parallel scrapers | 1 (sequential), 4 (all parallel) | Reduces total runtime without risk of rate-limiting any single domain |
| Player match key | name + position fuzzy match + alias override | Shared external ID (e.g. Sleeper ID) | No shared ID exists across all four sources; fuzzy match handles 95% of cases |
| Fuzzy match threshold | 0.85 Dice coefficient | 0.8 (more permissive), 0.9 (stricter) | Empirically safe for name variants without false positives on similar names at same position |
| Normalization scope | Per-source min-max in current run | Global historical min-max | Current-run normalization is self-contained and reproducible; historical tracking adds complexity with no clear benefit |
| Partial failure | Commit available data, warn per source | Abort on any failure | Losing one source's data is acceptable; aborting discards all successfully scraped data |
| Upsert match key | name + position | players.id | IDs are not portable across sources; name+position is the stable cross-source key |
