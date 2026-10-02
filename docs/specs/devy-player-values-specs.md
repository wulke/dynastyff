# Specs: Devy Player Values

| ID | Requirement | Status |
|---|---|---|

*Status: `[ ]` Active, `[x]` Implemented, `[D]` Deferred.*

## Data model

**DFF-DEVY-001** `[x]` → #201
The system shall provide a `devy_players` table, separate from `players`, with columns: `id`, `name`, `position`, `school`, `school_code`, `draft_year`, `value_superflex`, `value_one_qb`, `ktc_player_id`, `mfl_id`, `is_returning_to_school`, `is_year_decrement`, `updated_at`.

**DFF-DEVY-002** `[x]` → #201
The `devy_players` table shall enforce a unique index on `(name, position)`, independent of `players`' own `(name, position)` uniqueness.

**DFF-DEVY-003** `[x]` → #201
The `devy_players.position` column shall be constrained to the same position vocabulary as `players.position` (QB/RB/WR/TE).

**DFF-DEVY-004** `[x]` → #201
The `devy_players` table shall not include `age` or TEP-tier value columns (`dynasty_value_tep`/`tepp`/`teppp` equivalents) — KTC's devy board does not populate either.

## Scraping

**DFF-DEVY-010** `[x]` → #201
The system shall provide a scraper, `src/etl/scraper/ktc-devy.ts`, that reads KeepTradeCut's devy board (`https://keeptradecut.com/devy-rankings`) and returns raw devy player rows: name, position, school, school code, draft year, superflex value, one-QB value (if present), KTC player id, MFL id (if present), returning-to-school flag, year-decrement flag.

**DFF-DEVY-011** `[x]` → #201
The devy scraper shall drop and warn on any row whose position falls outside QB/RB/WR/TE, rather than passing it downstream to violate the `devy_players` position check constraint.

## Normalization and ingestion

**DFF-DEVY-020** `[x]` → #201
The system shall normalize devy players' superflex and one-QB raw values using the existing min-max normalization logic (`src/etl/normalize.ts`), computed against the devy scrape's own value range only — never combined with the NFL `players` ETL run's normalization pool.

**DFF-DEVY-021** `[x]` → #201
The system shall provide a standalone devy ingestion entrypoint, `runDevyEtl` in `src/etl/devy-index.ts`, that scrapes, normalizes, and upserts devy players into `devy_players` keyed on `(name, position)`, independent of `src/etl/index.ts`'s NFL multi-source scrape/match/aggregate pipeline.

**DFF-DEVY-022** `[x]` → #201
Devy ingestion shall not perform cross-source aggregation or alias matching (`src/etl/player-matching.ts`) — the devy board is a single source.

## Export and scheduling

**DFF-DEVY-030** `[x]` → #201
`src/etl/export-snapshot.ts` shall include a `devyPlayers` array in `data/snapshot.json`, populated from the `devy_players` table.

**DFF-DEVY-031** `[x]` → #201
`.github/workflows/scheduled-refresh.yml` shall run `runDevyEtl` alongside the existing NFL `npm run etl` step, on the same weekly schedule, feeding the same `export:snapshot` → sanity-check → PR-landing path.

**DFF-DEVY-032** `[D]`
Devy player value history/trend tracking across runs is deferred — out of scope for this pass, per the wayfinder map's framing.

## UI

**DFF-DEVY-040** `[x]` → #201
`AppHeader` shall show a global "Devy" link/button, visible regardless of draft state, that navigates to a standalone `DevyView`.

**DFF-DEVY-041** `[x]` → #201
`DevyView` shall be a top-level view reached outside the draft-room state machine (not one of `DRAFT_TABS`), so it is reachable with or without an active draft.

**DFF-DEVY-042** `[x]` → #201
`DevyView` shall provide position-pill filters (QB/RB/WR/TE), draft-year-pill filters (populated from distinct `draftYear` values in the loaded devy data), and a free-text school search, all client-side.

**DFF-DEVY-043** `[x]` → #201
`DevyView`'s player table shall sort by `valueSuperflex` descending by default, with a toggle to sort/display by `valueOneQb` instead.

**DFF-DEVY-044** `[x]` → #201
`DevyView` shall render a banner and a "DEVY" row badge (using `DESIGN.md`'s semantic token classes, not a `pos-*` position badge) to visually distinguish devy rows from NFL dynasty-value views.

**DFF-DEVY-045** `[x]` → #201
`DevyView` shall render an empty state, not an error, when `data/snapshot.json`'s `devyPlayers` array is missing or empty.

## Reconciliation (tracked separately)

**DFF-DEVY-050** `[D]`
Devy-to-NFL reconciliation (matching `devy_players` rows into `players` by `(name, position)` and deleting the matched `devy_players` row) is out of scope for this spec set — tracked as its own implementation issue, [Build devy-to-NFL reconciliation script (#200)](https://github.com/wulke/dynastyff/issues/200), run manually/on-demand rather than as part of scheduled ingestion.
