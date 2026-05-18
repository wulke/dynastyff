# LLD: ETL Pipeline

## Context

The ETL pipeline is a standalone script (`src/etl/index.ts`) that populates the `players` and `pick_values` tables in the local SQLite database. It is invoked manually via `npm run etl` — no scheduling, no server dependency. It shares the Drizzle ORM schema and database module with the Express server.

Drives specs: `docs/specs/etl-pipeline-specs.md`

## Architecture

```
npm run etl
    └── src/etl/index.ts
            ├── runScrapers()          — launches scrapers with concurrency limit 2
            │       ├── scraper/ktc.ts
            │       ├── scraper/fantasycalc.ts
            │       ├── scraper/dynastydaddy.ts
            │       └── scraper/rosteraudit.ts
            ├── matchPlayers()         — fuzzy name+position matching across sources
            ├── normalize()            — min-max scale each source to 0–9999
            ├── aggregate()            — average normalized values → dynasty_value
            └── upsert()               — write players + pick_values to SQLite
```

## Scrapers

Each scraper is a self-contained module that returns a typed result array. All four use Playwright (headless Chromium) to handle JS-rendered pages.

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

Scrapers throw on unrecoverable failure (site unreachable, structure changed). The orchestrator catches per-scraper errors and continues.

## Concurrency

Scrapers run two at a time using a simple promise pool. Order of execution is not guaranteed.

```
[ktc, fantasycalc, dynastydaddy, rosteraudit]
  → run ktc + fantasycalc in parallel
  → run dynastydaddy + rosteraudit in parallel
```

## Player Matching

Players must be matched across sources before normalization, since each source uses its own naming conventions.

**Algorithm:**

1. Collect all players from all successful scrapers.
2. Build a canonical player list from the union of all names. Primary source priority: KTC → FantasyCalc → DynastyDaddy → RosterAudit (used only for canonical name/metadata; all sources contribute values).
3. For each non-primary source player, attempt exact match on `(normalized_name, position)` first.
4. On exact miss, run fuzzy match using `string-similarity` (Dice coefficient) on name, filtered to same position. Accept match if score ≥ 0.85.
5. On fuzzy miss, check `player-aliases.json` for a hard-coded override.
6. On alias miss, log a loud warning and skip the source's value for that player (does not abort the run).

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

- `min` and `max` are computed from all players returned by that source in the current run.
- Normalization is applied to both player values and pick values.
- If a source returns only one player (degenerate case), that player is assigned value 9999 and a warning is logged.

## Aggregation

After normalization, each player's `dynasty_value` is the simple mean of all non-NULL normalized values across sources that successfully matched that player.

```
dynasty_value = round(mean([value_ktc, value_fantasycalc, ...].filter(v => v !== null)))
```

Pick values follow the same pattern.

## Partial Failure Behavior

- A scraper failure (throw) logs a warning: `[ETL] WARN: {source} scraper failed — {error.message}. Excluding from this run.`
- The run continues with remaining successful scrapers.
- If ≥ 1 scraper succeeds, the upsert proceeds with available data.
- If all scrapers fail, the run exits with a non-zero code and no database writes occur.
- Per-source columns (`value_ktc`, etc.) for failed sources are left as NULL in the upserted rows; existing non-NULL values from a prior run are not overwritten.

## Upsert

All writes use Drizzle ORM against the shared SQLite database.

**Players:**
- Match on `players.name + players.position` (not ID, since IDs are not shared across sources).
- On match: update `dynasty_value`, all `value_*` columns (non-NULL only), `adp` (if source provided), and `updated_at`.
- On no match: insert a new row with a generated UUID.

**Pick values:**
- Match on `(year, round)`.
- On match: update `dynasty_value` and `updated_at`.
- On no match: insert a new row.

## File Layout

```
src/etl/
  index.ts                  — orchestrator: concurrency, matching, normalize, aggregate, upsert
  normalize.ts              — min-max scaling utilities
  match.ts                  — fuzzy player matching logic
  scraper/
    ktc.ts
    fantasycalc.ts
    dynastydaddy.ts
    rosteraudit.ts
player-aliases.json         — manual name override file (project root)
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
