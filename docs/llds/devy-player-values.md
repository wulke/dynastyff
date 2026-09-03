# LLD: Devy Player Values

## Context

Devy players (college prospects not yet NFL-draft-eligible) are a distinct player population from the existing NFL `players` table, valued from KeepTradeCut's devy board (`https://keeptradecut.com/devy-rankings`) rather than its dynasty board. Today there is no schema, ETL ingestion, or UI surface for them — only personal scratch scripts (`scripts/devy-available.mjs`, `scripts/devy-pr-analysis.mjs`, `scripts/probe-ktc-devy.mjs`) that the user runs outside the app.

This LLD covers: a `devyPlayers` table, a devy-board scraper feeding its own ETL pass, and a browsable/rankable "Devy" view in the UI. It does **not** cover the devy-to-NFL reconciliation script — that is tracked separately as [Build devy-to-NFL reconciliation script (#200)](https://github.com/wulke/dynastyff/issues/200), since it runs manually/on-demand rather than as part of this ingestion path.

Builds on `docs/llds/etl-pipeline.md` (scraper → normalize → aggregate → upsert shape, reused here for a second, independent player population) and `docs/llds/data-model.md`. Drives specs: `docs/specs/devy-player-values-specs.md`.

Design decisions were resolved via a Wayfinder map ([Map: Devy Player Values](https://github.com/wulke/dynastyff/issues/194)) before this LLD was written:

- [Schema shape for devy players (#195)](https://github.com/wulke/dynastyff/issues/195) — separate `devyPlayers` table, not a `players` discriminator column.
- [Devy-to-NFL lifecycle and identity reconciliation (#196)](https://github.com/wulke/dynastyff/issues/196) — match by `(name, position)`; reconciliation is manual/on-demand, out of this LLD's scope (tracked at #200).
- [UI surface for browsing devy values (#197)](https://github.com/wulke/dynastyff/issues/197) — global "Devy" link in `AppHeader`, its own top-level view, position + draft-year pill filters + school free-text search, ranked table sorted by `valueSuperflex` with a toggle to `valueOneQb`, visually distinct via a banner + "DEVY" row badge using existing tokens.

## Data Model

New table `devyPlayers` in `src/db/schema.ts`, sibling to `players` (not a shared table — separate normalization pool per the map's framing):

```ts
export const devyPlayers = sqliteTable(
  'devy_players',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    position: text('position').notNull(),
    school: text('school'),
    schoolCode: text('school_code'),
    draftYear: integer('draft_year').notNull(),
    valueSuperflex: integer('value_superflex').notNull(),
    valueOneQb: integer('value_one_qb'),
    ktcPlayerId: text('ktc_player_id'),
    mflId: text('mfl_id'),
    isReturningToSchool: integer('is_returning_to_school', { mode: 'boolean' }).notNull().default(false),
    isYearDecrement: integer('is_year_decrement', { mode: 'boolean' }).notNull().default(false),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('devy_players_name_position_unique').on(table.name, table.position),
    index('devy_players_draft_year_idx').on(table.draftYear),
    check(
      'devy_players_position_check',
      sql`${table.position} in (${sql.raw(quotedList(playerPositions))})`,
    ),
  ],
);
```

Notes:
- No `age` and no `dynastyValueTep`/`tepp`/`teppp` columns — per #195, KTC's devy payload never populates age and carries no TEP tiers.
- `ktcPlayerId`/`mflId` are captured now (cheap to carry from the scrape) but unused until reconciliation needs them (#196 deferred ID-based matching to "if name+position collisions turn out to be a real problem").
- `valueSuperflex`/`valueOneQb` are min-max-normalized against the devy board's own player universe only — never mixed into `players.dynastyValue`'s normalization pool.

## Logic Flow

**Scraper** — `src/etl/scraper/ktc-devy.ts`, modeled on `src/etl/scraper/ktc.ts` but pointed at `/devy-rankings` and reading `playersArray`'s devy-specific fields (`playerName`, `team`/`teamLongName` → `school`/`schoolCode`, `draftYear`, `superflexValues.value`, `oneQbValues.value` if present, `playerID`/`mflid`, and any "returning to school" / class-year-decrement flags KTC exposes — confirm exact field names against `scripts/probe-ktc-devy.mjs`'s captured payload before implementation).

**Normalize** — reuse `normalizePlayers`/`normalizeRawValue` from `src/etl/normalize.ts` against the devy scrape's raw values only (its own `minRawValue`/`maxRawValue` context, independent of the NFL players ETL run).

**Ingest path** — a standalone `runDevyEtl` in a new `src/etl/devy-index.ts`, mirroring `src/etl/index.ts`'s scrape → normalize → upsert shape but kept separate from it: scrapes → normalizes → upserts into `devyPlayers` keyed on `(name, position)`. No cross-source aggregation (`player-matching.ts`'s alias/candidate matching is NFL-multi-source-specific and does not apply — single source, per the map's framing).

**Export** — extend `src/etl/export-snapshot.ts` to include a `devyPlayers` array in `data/snapshot.json`, alongside the existing `players`/`picks` arrays, so the static UI build can read it the same way.

**Scheduling** — `runDevyEtl` runs as an additional step in the existing scheduled-refresh workflow (`docs/llds/etl-scheduling.md`, `.github/workflows/scheduled-refresh.yml`), alongside `npm run etl`, on the same weekly cadence — no separate cron. Its output feeds the same `export:snapshot`/sanity-check/PR-landing path already in place.

## UI

- `AppHeader` (`src/ui/App.tsx:109`) gains a "Devy" link/button next to the existing theme switcher, always visible (global, not draft-scoped).
- New top-level view `DevyView` (new file, e.g. `src/ui/DevyView.tsx`), reached via a top-level view-state branch in `App.tsx` alongside the existing draft-setup/draft-board states — not part of the `DRAFT_TABS`/draft-room state machine, since it's a standalone reference view independent of any in-progress draft.
- Filters: position pills (QB/RB/WR/TE, reusing existing pill components/`positionBadge.ts` conventions from `DESIGN.md`), draft-year pills (populated from distinct `draftYear` values present in the loaded data), school free-text search (client-side substring filter).
- Table: ranked, sorted by `valueSuperflex` descending by default; a toggle switches sort/display to `valueOneQb`. Each row carries a "DEVY" badge (new token-based badge, not a `pos-*` badge — those are reserved for position) to prevent confusion with NFL dynasty-value tables mid-draft, plus a banner at the top of the view stating this is devy/college data.
- Follows `DESIGN.md`: semantic tokens only, `font-condensed`/`tabular-nums` for values, `rounded` for rows, `px-2 py-1` row padding.

## Edge Case Probe

- KTC devy board returns a position outside `QB|RB|WR|TE` (e.g. a devy-only positions like "ATH") -> scraper drops/warns on the unrecognized row rather than violating the `devy_players_position_check` constraint (mirrors how `src/etl/scraper/ktc.ts` handles the dynasty board today — confirm exact precedent there).
- A devy player's `(name, position)` collides with an existing `devyPlayers` row from a prior run (e.g. name changed slightly, or two same-named prospects at the same position) -> upsert keyed on `(name, position)` overwrites; a true same-name collision is a known limitation carried over from #196's deferred ID-based matching, not solved here.
- Devy board temporarily returns zero or one player (site hiccup) -> reuse `normalize.ts`'s existing degenerate-input handling (single-entry → 9999, warn) rather than special-casing devy.
- A player already reconciled into `players` (via #200's script) still appears in a fresh devy scrape (KTC hasn't removed them from the devy board yet) -> out of scope for this LLD; #200's reconciliation script is the mechanism that removes stale `devyPlayers` rows, and it runs independently/manually.
- `data/snapshot.json`'s `devyPlayers` array is missing or empty in an older cached snapshot (pre-this-feature) -> `DevyView` renders an empty state, not an error.
