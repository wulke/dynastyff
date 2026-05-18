# LLD: ETL Pipeline

## Context

Issue `#2` is the ETL tracer bullet. This slice establishes a standalone `npm run etl` entry point that scrapes KTC player values, normalizes them to the shared 0–9999 dynasty scale, and upserts them into the local SQLite `players` table. The Express server is not involved in ETL execution.

Later issues extend this pipeline with additional scrapers, pick values, cross-source matching, and partial-failure handling. Those behaviors are out of scope for this slice and remain deferred.

Drives specs: `docs/specs/etl-pipeline-specs.md`

## Interface / Data Model

### Entry point

`src/etl/index.ts`

- Executed by `npm run etl`
- Initializes the shared SQLite database connection
- Runs the KTC scraper
- Normalizes KTC player values
- Upserts players into `players`
- Exits with code `0` on success

### Scraper contract

```ts
type KtcRawPlayer = {
  name: string;
  position: 'QB' | 'RB' | 'WR' | 'TE';
  nflTeam: string;
  age: number | null;
  isRookie: boolean;
  rawValue: number;
  adp: number | null;
};
```

The KTC scraper is implemented in `src/etl/scraper/ktc.ts` and uses Playwright headless Chromium.

### Persistence target

The ETL writes to the existing `players` table:

- `dynasty_value` receives the normalized KTC value
- `value_ktc` receives the same normalized value
- `adp` receives KTC ADP when present
- `updated_at` receives the ETL timestamp
- `value_fantasycalc`, `value_dynastydaddy`, and `value_rosteraudit` remain `NULL` in this slice

## Logic Flow

1. Execute `npm run etl`, which runs `src/etl/index.ts` directly with Node and `tsx`.
2. Start headless Chromium through Playwright and scrape the KTC page.
3. Map scraped rows into the typed KTC player shape.
4. Discard any rows whose position is not `QB`, `RB`, `WR`, or `TE`.
5. Compute `min(rawValue)` and `max(rawValue)` across the filtered KTC result set.
6. Normalize each player with `round((raw - min) / (max - min) * 9999)`.
7. For each normalized player:
   - Query by `(name, position)`
   - If no row exists, insert a new UUID-backed player row with all available attributes
   - If a row exists, update `dynasty_value`, `value_ktc`, `adp`, and `updated_at`
8. Exit with status code `0`.

## Edge Case Probe

- KTC returns positions outside the supported set -> exclude those rows before normalization or upsert.
- KTC returns no supported players -> treat as ETL failure and exit non-zero.
- KTC returns exactly one supported player -> assign normalized value `9999` to avoid divide-by-zero.
- A player already exists in `players` -> update only the fields owned by this slice (`dynasty_value`, `value_ktc`, `adp`, `updated_at`).
- The Express server is not running -> ETL still succeeds because it only depends on Playwright and the shared DB layer.
- Later multi-source aggregation requirements -> deferred to follow-on ETL issues; this slice writes KTC-only values.
