# Research: Startup pick-value chart coverage for trade scoring

**Ticket:** [#176 — Research: Startup pick-value chart coverage for trade scoring](https://github.com/wulke/dynastyff/issues/176)
**Parent map:** [#174 — Map: Live Draft trade-idea assistant](https://github.com/wulke/dynastyff/issues/174)
**Method:** primary-source inspection of the live SQLite DB (`data/dynastyff.sqlite`), `src/db/schema.ts`, the ETL pipeline (`src/etl/`), the draft engine's pick-value derivation/use, and the governing EARS specs. All claims cite their source.

---

## TL;DR

The existing `pick_values` table is **sufficient** for the Live Draft trade-idea generator's **chart-fairness** scoring. Players, startup pick slots, and future picks are already valued in one common 0–9999 currency, and the draft engine already has a reusable valuation primitive (`scoreBotTradeAsset`) plus a conservative player-pool floor. **No new data source is required.** Two characteristics to document (not gaps): startup slot coverage runs only 4 rounds deep (later rounds clamp), and future picks are round-level only (no exact slot — by design).

---

## 1. What's in `pick_values` today

**Schema** (`src/db/schema.ts:321`, confirmed in `docs/llds/data-model.md`):

| Column | Type | Notes |
|---|---|---|
| `year` | INTEGER | Startup picks use the current calendar year (2026 in this DB); future picks use 2027–2029 |
| `round` | INTEGER | 1-based round |
| `pick_in_round` | INTEGER | `0` = round-level sentinel (future picks); `1..N` = exact startup slot in a **12-team canonical frame** |
| `dynasty_value` | INTEGER | Rounded mean of non-NULL per-source normalized values (0–9999) |
| `updated_at` | TEXT | last ETL refresh |

Unique constraint: `(year, round, pick_in_round)` (`docs/specs/startup-pick-values-specs.md` DFF-SPKV-003).

**Actual coverage in the live DB** (`SELECT year, round, COUNT(*), MIN(pick_in_round), MAX(pick_in_round) … GROUP BY year, round`):

| Year | Rounds | Per-round rows | `pick_in_round` range | Meaning |
|---|---|---|---|---|
| **2026** (startup / current calendar year) | 1–4 | 13 each (1 sentinel + 12 slots) | 0, then 1–12 | Full **12-team snake-startup chart**, rounds 1–4 |
| 2027 | 1–4 | 1 each | 0 | Round-level future picks only |
| 2028 | 1–4 | 1 each | 0 | Round-level future picks only |
| 2029 | 1–4 | 1 each | 0 | Round-level future picks only |

Totals: **64 rows**, 4 years, 4 rounds each.

Sample 2026 startup curve (round 1): `1.01=9999, 1.02=7333, 1.03=6363, … 1.12=2350`. Round 2 starts at `2.01=2036`. Values decay steeply, as expected for a dynasty startup chart.

**Population source** (`src/etl/index.ts`, `src/etl/scraper/{ktc,fantasycalc,rosteraudit}.ts`): three scrapers feed `RawPickValue` rows; KTC parses `"Startup R.PP"` (DFF-SPKV-010), FantasyCalc + RosterAudit parse `"2026 Pick R.PP"` (DFF-SPKV-011). All pick rows — startup *and* future — are normalized together with player values **in a single 0–9999 pass per source** (DFF-SPKV-020), then aggregated as the rounded mean across sources per `(year, round, pick_in_round)` (DFF-SPKV-021). The current calendar year is stamped on startup rows at ETL time (DFF-SPKV-012).

**Important — startup rows are NOT in the static build's snapshot.** `src/etl/export-snapshot.ts:89` exports `WHERE pick_in_round = 0` (DFF-SPKV-015), so the GitHub-Pages static build carries only round-level future values. The full startup chart lives only in the local SQLite DB. The Live Draft section needs the local app anyway (Express + real Sleeper drafts), so this is consistent — but the generator must read from SQLite, not the snapshot.

---

## 2. Mid-round & future-pick coverage

**Startup mid/late rounds (the headline characteristic).** The startup chart publishes slots for **rounds 1–4 only**, because that is what KTC / FantasyCalc / RosterAudit publish. A configurable-20-round startup therefore has **no per-slot chart value for rounds 5–20**. The draft engine handles this by **clamping to the last published slot** (DFF-SPKV-042: "When a draft's global pick number exceeds the last published slot … clamp … and use its dynasty value"). In practice this is acceptable for trade scoring because:

- Dynasty startup trade activity concentrates in rounds 1–4 (where the value is); rounds 5+ are bench/lottery with near-flat value.
- The bot trade evaluator additionally floors each pick slot at the **next-available-player value** (see §4), which drags clamped late-round slots down toward reality as the pool thins.

So: rounds 1–4 are precisely charted; rounds 5–20 rely on clamp + player-pool floor. Document this; do not treat it as a blocker.

**Future-year picks are round-level only (no exact slot).** Years 2027–2029 carry one value per round (`pick_in_round = 0`). This is inherent — the exact slot of a future pick is unknown until that draft's order is set — and matches how the mock draft models `team_pick_assets` (keyed `(year, round)`, no slot; `docs/llds/data-model.md`). The generator scores a future pick by looking up `${year}:${round}` in the round-level map (see `src/draft/bot-chain.ts:256` `futurePickValues.set(`${year}:${round}`, …)`).

**Could future-year *startup* slot values come from elsewhere?** Not needed for this effort. If exact future-slot values were ever wanted, the only candidate sources are the same three scrapers (which don't publish them) or a derived mapping; none exists today and none is required for chart-fairness scoring. KTC publishes only the current-year startup slots.

---

## 3. Traded-pick value during an in-progress startup

**Yes — all asset types are scored in the same currency, so the generator can evaluate "user's current startup pick vs. another team's future pick" directly.** The three value maps the engine already builds are all on the 0–9999 per-source-normalized scale (DFF-SPKV-020):

- `playerValues: Map<player_id, number>` ← `players.dynasty_value`
- `futurePickValues: Map<"year:round", number>` ← `pick_values` where `pick_in_round = 0`
- `startupPickValues: Map<globalPick, number>` ← `pick_values` where `pick_in_round ≥ 1`, derived into the draft's team-count frame (see §4)

The reusable valuation function is **`scoreBotTradeAsset(asset, { playerValues, futurePickValues, startupPickValues })`** (`src/draft/bot-trade.ts`):

```ts
if (asset.type === 'player')     return playerValues.get(player_id) ?? 0;
if (asset.type === 'future_pick') return futurePickValues.get(`${year}:${round}`) ?? 0;
// pick_slot
return startupPickValues.get(pick_number) ?? 0;
```

A pick that changes hands mid-draft keeps its slot value (it's a slot, not a rostered player), so a trade proposal mixing the user's current `pick_slot` with an opponent's `future_pick` is a straight sum-of-values comparison — exactly the chart-fairness check the destination calls for.

---

## 4. The two reusable mechanisms the generator should adopt

**a) 12-team → N-team derivation** (`docs/specs/startup-pick-values-specs.md` DFF-SPKV-041, implemented in `src/ui/utils/draftUtils.ts:4 computeDerivedPickValues`). The stored chart is 12-team canonical; at draft-creation the engine derives `startupPickValues: Map<globalPick, value>` for the actual team count N:

```
sourceGlobal   = (round - 1) * N + pick_in_round     // actual slot → global pick
ktc_pick_in_round = ((sourceGlobal - 1) % 12) + 1
ktc_round         = ceil(sourceGlobal / 12)           // → lookup in 12-team frame
```

A real Sleeper startup with N≠12 teams uses the same derivation. **The Live Draft generator should reuse `computeDerivedPickValues`** (or its server-side equivalent) rather than re-derive.

**b) Player-pool floor on pick slots** (DFF-SPKV-052). To stop pick slots being overvalued as the pool thins, the bot evaluator uses:

```
effectiveSlotValue = min(ETL chart value, availablePlayers[G - currentPickNumber - 1]?.dynastyValue ?? 0)
```

i.e. a slot is never valued above the best player still on the board at that point. For a **live** draft, `availablePlayers` is derived from Sleeper board state (undrafted players), so this floor transfers directly. **The generator should apply the same floor** to keep chart-fairness honest as the draft progresses.

---

## 5. Gap assessment

| Question | Answer |
|---|---|
| Is `pick_values` sufficient for the generator's chart-fairness scoring? | **Yes.** Players, startup slots, and future picks are all in one normalized currency, with a ready-made `scoreBotTradeAsset` primitive and a player-pool floor. |
| Is a new/additional data source needed? | **No.** No new scraper, no KTC-pick-extension, no future-slot derivation is required for chart fairness. |
| Are there characteristics to document (not gaps)? | (1) Startup slots cover rounds 1–4 only → rounds 5–20 clamp to the last published value (mitigated by the player-pool floor). (2) Future picks are round-level only (by design — slot unknown). (3) Startup rows are absent from the static-build snapshot; the generator reads SQLite. |
| Team-count support? | Handled via the 12→N derivation (DFF-SPKV-041) + clamp. A real N-team Sleeper startup reuses it unchanged. |
| Anything blocked? | Nothing. The "scoring currency" sub-question of the generator ticket ([#177](https://github.com/wulke/dynastyff/issues/177)) is fully unblocked: score = sum of `scoreBotTradeAsset` values across assets, with pick slots floored by the live player pool, thresholded for "relatively equal." |

### Recommendation to the generator ticket (#177)

Adopt this scoring currency verbatim:

- Build the three value maps at live-draft-session start (players from `players.dynasty_value`; future picks + startup slots from `pick_values`; startup map derived via the 12→N formula).
- Score any candidate trade by summing `scoreBotTradeAsset` over assets-out vs assets-in, applying the `min(ETL, player-pool-floor)` rule to `pick_slot` assets.
- Define "relatively equal" (chart fairness threshold) as a tunable band on the resulting delta — the data imposes no constraint on where that band sits.
- Do **not** model counterparty acceptance (out of scope per the destination) — the chart alone is the score.

---

## Sources

- Live DB: `data/dynastyff.sqlite` (queried 2026-08-10)
- `src/db/schema.ts` (`pick_values` at L321, `pick_value_snapshots` at L177)
- `src/etl/index.ts` (population, normalization, aggregation)
- `src/etl/export-snapshot.ts:89` (static-snapshot excludes `pick_in_round ≥ 1`)
- `src/draft/bot-trade.ts` (`scoreBotTradeAsset`, `TradeValueContext`, asset types)
- `src/draft/bot-chain.ts:256` (`futurePickValues` key shape)
- `src/ui/utils/draftUtils.ts:4` (`computeDerivedPickValues` — 12→N derivation)
- `docs/llds/data-model.md` (`pick_values`, `team_pick_assets`)
- `docs/specs/startup-pick-values-specs.md` (DFF-SPKV-001…061 — the governing requirements)
