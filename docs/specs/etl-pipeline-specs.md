# EARS Specs: ETL Pipeline

Drives: `docs/llds/etl-pipeline.md`

Status markers: `[x]` implemented · `[ ]` gap · `[D]` deferred

---

## Invocation

**DFF-ETL-001** `[x]`
The system shall expose an `npm run etl` command that executes the ETL pipeline as a standalone script without requiring the Express server to be running.

---

## Scrapers

**DFF-ETL-010** `[x]` → #3
The system shall scrape player values and pick values from KTC, FantasyCalc, DynastyDaddy, and RosterAudit using Playwright headless Chromium.

**DFF-ETL-011** `[x]` → #3
The system shall run scrapers with a maximum concurrency of 2 simultaneous scrapers.

**DFF-ETL-012** `[x]` → #3
Each scraper shall return players typed as `{ name, position, nflTeam, age, isRookie, rawValue, adp }` and pick values typed as `{ year, round, rawValue }`.

**DFF-ETL-013** `[x]` → #3
The system shall restrict `position` values returned by scrapers to: QB, RB, WR, TE.

---

## Player Matching

**DFF-ETL-020** `[ ]` → #4
The system shall match players across sources by first attempting an exact match on normalized name and position.

**DFF-ETL-021** `[ ]` → #4
When an exact name match fails, the system shall attempt a fuzzy match using Dice coefficient on player name, restricted to players at the same position, and accept the match only if the score is ≥ 0.85.

**DFF-ETL-022** `[ ]` → #4
When a fuzzy match fails, the system shall consult `player-aliases.json` for a hard-coded canonical-to-variant override before declaring a match failure.

**DFF-ETL-023** `[ ]` → #4
When a player from a non-primary source cannot be matched to any canonical player after fuzzy match and alias lookup, the system shall log a warning and exclude that source's value for that player; the ETL run shall continue.

**DFF-ETL-024** `[ ]` → #4
The system shall use the following source priority order for canonical player name and metadata: KTC → FantasyCalc → DynastyDaddy → RosterAudit.

---

## Normalization

**DFF-ETL-030** `[ ]` → #5
The system shall normalize each source's raw player values independently to the range 0–9999 using min-max scaling: `round((raw - min) / (max - min) * 9999)`.

**DFF-ETL-031** `[ ]` → #5
The system shall normalize each source's raw pick values independently using the same min-max formula.

**DFF-ETL-032** `[ ]` → #5
When a source returns only one player or pick value (degenerate case), the system shall assign that entry a normalized value of 9999 and log a warning.

---

## Aggregation

**DFF-ETL-040** `[ ]` → #4
The system shall compute `dynasty_value` for each player as the rounded mean of all non-NULL normalized per-source values for that player.

**DFF-ETL-041** `[ ]` → #5
The system shall compute `dynasty_value` for each pick value `(year, round)` as the rounded mean of all non-NULL normalized per-source values for that entry.

---

## Partial Failure

**DFF-ETL-050** `[ ]` → #6
When a scraper throws an unrecoverable error, the system shall log a warning in the format: `[ETL] WARN: {source} scraper failed — {message}. Excluding from this run.` and continue with remaining scrapers.

**DFF-ETL-051** `[ ]` → #6
When at least one scraper succeeds, the system shall proceed with normalization, aggregation, and upsert using the available data.

**DFF-ETL-052** `[ ]` → #6
When all scrapers fail, the system shall exit with a non-zero exit code and perform no database writes.

**DFF-ETL-053** `[ ]` → #6
When upserting a player whose per-source column would come from a failed scraper, the system shall leave that column's existing value unchanged (not overwrite with NULL).

---

## Upsert — Players

**DFF-ETL-060** `[ ]` → #4
When a player already exists in `players` (matched by name and position), the system shall update `dynasty_value`, all non-NULL per-source value columns (`value_ktc`, `value_fantasycalc`, `value_dynastydaddy`, `value_rosteraudit`), `adp` (if provided by any source), and `updated_at`.

**DFF-ETL-061** `[ ]` → #4
When a player does not exist in `players`, the system shall insert a new row with a generated UUID and all available attributes.

**DFF-ETL-062** `[ ]` → #4
The system shall set `value_ktc`, `value_fantasycalc`, `value_dynastydaddy`, and `value_rosteraudit` to NULL for any source that did not provide a value for a given player (either due to scraper failure or failed player matching).

---

## Upsert — Pick Values

**DFF-ETL-070** `[ ]` → #5
When a `(year, round)` entry already exists in `pick_values`, the system shall update `dynasty_value` and `updated_at`.

**DFF-ETL-071** `[ ]` → #5
When a `(year, round)` entry does not exist in `pick_values`, the system shall insert a new row with a generated UUID.

---

## Aliases

**DFF-ETL-080** `[ ]` → #4
The system shall load `player-aliases.json` from the project root at ETL startup and apply it during player matching.

**DFF-ETL-081** `[ ]` → #4
The `player-aliases.json` file shall support entries of the form `{ canonical: string, variants: string[] }` where any variant name is treated as equivalent to the canonical name during matching.
