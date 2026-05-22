# EARS Specs: Startup Pick Values

Drives: `docs/llds/data-model.md`, `docs/llds/etl-pipeline.md`, `docs/llds/draft-engine.md`

Status markers: `[x]` implemented · `[ ]` gap · `[D]` deferred

---

## Data Model

**DFF-SPKV-001** `[x]` → #69
The system shall add a `pick_in_round` INTEGER column to the `pick_values` table to identify exact startup draft pick slots.

**DFF-SPKV-002** `[x]` → #69
The system shall use `pick_in_round = 0` as a sentinel value meaning "round-level value, no specific slot assigned." All existing future pick rows shall be stored with `pick_in_round = 0`. Startup pick rows shall have `pick_in_round >= 1`.

**DFF-SPKV-003** `[x]` → #69
The system shall enforce a unique constraint on `(year, round, pick_in_round)` in the `pick_values` table, replacing the existing `(year, round)` constraint.

**DFF-SPKV-004** `[x]` → #69
The system shall add a `pick_in_round` INTEGER column to the `pick_value_snapshots` table, using the same sentinel-0 convention. The unique constraint on `pick_value_snapshots` shall be updated to `(run_id, year, round, pick_in_round, source)`.

---

## ETL — Scraping

**DFF-SPKV-010** `[ ]`
The KTC and RosterAudit scrapers shall parse startup pick asset names matching the pattern `"Startup R.PP"` (e.g. `"Startup 1.04"`, `"Startup 3.11"`) and extract `round` (left of the dot) and `pick_in_round` (right of the dot, zero-padded or plain integer). The regex shall be case-insensitive on the `Startup` prefix.

**DFF-SPKV-011** `[ ]`
The FantasyCalc scraper shall parse startup pick values if the source publishes them. The format shall be determined at implementation time by inspecting the live source; the parsed result shall produce the same `{ round, pickInRound }` shape regardless of source naming convention.

**DFF-SPKV-012** `[ ]`
The ETL pipeline shall assign the current calendar year (at the time of the ETL run) as the `year` field for all parsed startup pick values.

**DFF-SPKV-013** `[ ]`
When a scraper encounters a pick asset name beginning with `"Startup"` that does not match the `R.PP` pattern, the system shall log a warning and exclude that row from `pickValues`; it shall not be treated as a player row.

**DFF-SPKV-014** `[x]` → #69
The scraper contract `RawPickValue` type shall be extended to include an optional `pickInRound` field: `{ year: number; round: number; rawValue: number; pickInRound?: number }`. When `pickInRound` is absent or zero, the row is treated as a round-level future pick. When `pickInRound >= 1`, the row is treated as an exact startup pick slot.

**DFF-SPKV-015** `[x]` → #69
The static snapshot export shall include only `pick_values` rows where `pick_in_round = 0`; startup pick slot rows with `pick_in_round >= 1` shall be excluded from the exported `pickValues` array.

---

## ETL — Normalization & Aggregation

**DFF-SPKV-020** `[ ]`
The system shall normalize startup pick values in the same per-source min-max pool as future pick values. All pick rows — future and startup — for a given source shall be scaled together on the 0–9999 range in a single normalization pass.

**DFF-SPKV-021** `[ ]`
The system shall aggregate `dynasty_value` for each `(year, round, pick_in_round)` entry as the rounded mean of all non-NULL normalized per-source values for that exact key, consistent with the existing future pick aggregation logic.

---

## ETL — Upsert

**DFF-SPKV-030** `[ ]`
When upserting startup pick values, the system shall use `(year, round, pick_in_round)` as the match key. An existing row matching all three fields shall be updated; a non-matching key shall result in a new insert.

**DFF-SPKV-031** `[x]` → #69
When upserting future pick values (round-level), the system shall continue to use `(year, round, pick_in_round = 0)` as the match key, preserving backward compatibility with existing ETL behavior.

**DFF-SPKV-032** `[x]` → #69
When writing to `pick_value_snapshots`, the system shall populate `pick_in_round` from the source row: `>= 1` for startup picks, `0` for round-level future picks.

---

## Draft Engine — Snapshot Loading

**DFF-SPKV-040** `[ ]`
When a draft is created, the system shall load all `pick_values` rows for the current calendar year with `pick_in_round >= 1` from the latest pinned ETL snapshot as the startup pick reference dataset.

**DFF-SPKV-041** `[ ]`
At draft creation time, the system shall derive a `startupPickValues` map of type `Map<number, number>` (global pick number → dynasty value) by converting each loaded startup pick row from its stored 12-team reference frame to the actual draft's global pick number using the formula:

```
globalPick = (round - 1) * 12 + pick_in_round       // 12-team source slot → global
```

For a draft with `N` teams, the engine looks up the value for the actual slot's equivalent global pick in the 12-team frame:

```
sourceGlobal = (round - 1) * N + pick_in_round       // actual slot → global pick
ktc_pick_in_round = ((sourceGlobal - 1) % 12) + 1
ktc_round         = Math.ceil(sourceGlobal / 12)
```

**DFF-SPKV-042** `[ ]`
When a draft's global pick number exceeds the last published slot in the startup pick reference dataset, the system shall clamp the lookup to the last available slot and use its dynasty value.

**DFF-SPKV-043** `[ ]`
The system shall store the derived `startupPickValues` map in `InMemoryDraftState` as part of the static snapshot loaded at draft creation. It shall not be recomputed during the draft.

**DFF-SPKV-044** `[ ]`
When no startup pick values are present in the ETL snapshot for the current year, the system shall log a warning and continue draft creation with an empty `startupPickValues` map; bot trade evaluation shall treat startup pick slots as having `dynasty_value = 0` until ETL is re-run.

---

## Bot — Trade Evaluation

**DFF-SPKV-050** `[ ]`
The bot simulator shall treat any unfilled startup pick slot owned by a bot team as a tradeable asset, subject to the same value-threshold trade evaluation logic applied to future picks and players.

**DFF-SPKV-051** `[ ]`
When scoring a `pick_slot` asset during bot trade evaluation, the system shall compute its dynasty value by looking up the slot's global pick number in the `startupPickValues` map from `InMemoryDraftState`. A missing key shall yield `dynasty_value = 0`.

---

## UI — Display

**DFF-SPKV-060** `[ ]`
The system shall display startup pick slot assets in trade UIs with a `STARTUP` badge label and the pick identifier formatted as `"Startup R.PP"` (e.g. `"Startup 1.04"`, `"Startup 3.11"`), where `R` is the round and `PP` is the zero-padded pick-in-round.

**DFF-SPKV-061** `[ ]`
The dynasty value of a startup pick slot shall be displayed inline alongside its label in the trade offer UI, consistent with how player and future pick values are shown.
