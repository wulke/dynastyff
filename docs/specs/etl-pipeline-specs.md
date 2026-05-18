# EARS Specs: ETL Pipeline

Drives: `docs/llds/etl-pipeline.md`

Status markers: `[x]` implemented · `[ ]` active gap · `[D]` deferred

---

## Invocation

**DFF-ETL-001** `[ ]`
WHEN the user runs `npm run etl`, THE SYSTEM SHALL execute the ETL pipeline as a standalone script without requiring the Express server to be running.

---

## KTC Scraper

**DFF-ETL-010** `[ ]`
THE SYSTEM SHALL scrape player values from KeepTradeCut using Playwright headless Chromium.

**DFF-ETL-011** `[ ]`
THE SYSTEM SHALL return KTC players typed as `{ name, position, nflTeam, age, isRookie, rawValue, adp }`.

**DFF-ETL-012** `[ ]`
WHEN the KTC scraper returns player rows, THE SYSTEM SHALL restrict `position` values to `QB`, `RB`, `WR`, and `TE`.

---

## Normalization

**DFF-ETL-020** `[ ]`
WHEN the KTC scraper returns at least two supported players, THE SYSTEM SHALL normalize raw player values to the range `0–9999` using `round((raw - min) / (max - min) * 9999)`.

**DFF-ETL-021** `[ ]`
WHEN the KTC scraper returns exactly one supported player, THE SYSTEM SHALL assign that player a normalized value of `9999`.

---

## Upsert

**DFF-ETL-030** `[ ]`
WHEN a scraped player does not exist in `players` matched by `name` and `position`, THE SYSTEM SHALL insert a new row with a generated UUID and all available KTC attributes.

**DFF-ETL-031** `[ ]`
WHEN a scraped player already exists in `players` matched by `name` and `position`, THE SYSTEM SHALL update `dynasty_value`, `value_ktc`, `adp`, and `updated_at`.

**DFF-ETL-032** `[ ]`
WHEN the ETL writes KTC data in this slice, THE SYSTEM SHALL set `dynasty_value` equal to the normalized KTC value.

---

## Exit Behavior

**DFF-ETL-040** `[ ]`
WHEN the ETL run completes successfully, THE SYSTEM SHALL exit with status code `0`.

**DFF-ETL-041** `[ ]`
WHEN the KTC scraper yields no supported players, THE SYSTEM SHALL exit with a non-zero status code and perform no player upserts.

---

## Deferred Follow-on Work

**DFF-ETL-050** `[D]`
THE SYSTEM SHALL scrape player and pick values from FantasyCalc, DynastyDaddy, and RosterAudit in addition to KTC.

**DFF-ETL-051** `[D]`
THE SYSTEM SHALL run scrapers with a maximum concurrency of `2` simultaneous scrapers.

**DFF-ETL-052** `[D]`
THE SYSTEM SHALL match players across sources, aggregate non-NULL normalized source values, and upsert pick values.
