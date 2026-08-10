# Research: Reuse inventory for the Live Draft section

**Ticket:** [#180 — Research: Reuse inventory for the Live Draft section](https://github.com/wulke/dynastyff/issues/180)
**Parent map:** [#174 — Map: Live Draft trade-idea assistant](https://github.com/wulke/dynastyff/issues/174)
**Method:** primary-source inspection of the actual source tree (`src/`), the live SQLite DB, `package.json`, and the LLDs. Every "reusable" claim is verified against code that exists today — not against LLDs that describe unbuilt components.

---

## TL;DR — the headline correction

The map's grounding pointers assume two reusable backend building blocks that **do not exist in code**:

1. **Season management is LLD-only.** There is **no `src/season/`** directory. `tradeScorer.ts`, `tradeRecommender.ts`, `seasonAdvisor.ts`, `context.ts`, `rosterEvaluator.ts`, `waiverScorer.ts` appear **only in `docs/`** — never in `src/`. They are a *design to follow*, not modules to import. (`grep -r tradeScorer|seasonAdvisor src` → no hits.)
2. **The Sleeper draft/league sync client does not exist.** There is no `fetchLeagueState`, no `fetchDraft`, no `/drafts` traversal. The **only** Sleeper integration built is `src/server/sleeper-config-import.ts` — a one-shot `GET /league-imports/sleeper/:leagueId` that fetches a single public league's *settings* to prefill the mock-draft config form. The `sleeper_*` tables (**`sleeper_leagues`, `sleeper_rosters`, …**) **do not exist in the DB** (`.tables` lists none). So "reuses the existing Sleeper connection" is only true of the *league-settings-fetch pattern*; draft-state ingestion is net-new.
3. **The advisor / Claude layer is unbuilt.** `package.json` has **no `@anthropic-ai/sdk`** (or any LLM SDK). `grep -r anthropic|messages.create|advisor src/server` → no hits. The only `advisor` reference is a `ADVISOR_RESET` UI action in `src/ui/context/DraftContext.tsx`. So per-idea Claude analysis is net-new (it can follow the `advisor-agent.md` + `season-management.md` LLD prompt patterns as a template).

**What is genuinely reusable:** the data model + `pick_values`/`players` value data, the ETL pipeline, the mock draft engine's **trade-valuation primitives** (`scoreBotTradeAsset` + the 12→N pick-value derivation + player-pool floor), the Express SSE/validation patterns, and a stack of **UI components** — most notably `AvailablePlayersPanel`, which **already has a `'targets'` tab and a ranked `userQueue`** (a ready-made target-board mechanism).

---

## Inventory by area

### A. Sleeper connection — *mostly net-new*

| Exists | Where | Reuse for Live Draft |
|---|---|---|
| One-shot league-settings fetch + normalizer | `src/server/sleeper-config-import.ts` (`mapSleeperLeagueSettings`), route `GET /league-imports/sleeper/:leagueId` in `src/server/app.ts` | **Pattern reusable** — same `fetchImpl`-injected, `502`-on-failure shape; `mapSleeperLeagueSettings` shows how Sleeper settings are decoded. |
| Draft-state ingestion (`fetchDraft`, `fetchDraftPicks`, `fetchTradedPicks`, `/league/{id}/drafts`) | **None** | **Net-new.** Build per the Sleeper draft-API research ([#175](https://github.com/wulke/dynastyff/issues/175)). The config-import module is the closest stylistic template. |
| `sleeper_*` persistence tables | **None in DB** | **Net-new** schema (the `sleeper_drafts` / `sleeper_draft_picks` / `sleeper_draft_traded_picks` sketch in [#181](https://github.com/wulke/dynastyff/issues/181)). The mock-draft tables (`drafts`, `draft_order`, `picks`, …) are a *different* shape (bot-driven, not Sleeper-sourced) — do not force them to overlap. |

> Note: the HLD's "Sleeper Sync" box (`docs/llds/sleeper-sync.md`) is an **LLD**, not code. Treat it as a design to follow for ingestion, same as season management.

### B. Season-management components — *design-only; nothing to import*

`docs/llds/season-management.md` fully specifies the **Trade Scorer** (five-signal model + `TradeScore` shape), **Trade Recommender** (need-grouped candidate generation), **Waiver Scorer**, and **Season Advisor** (Claude layer, `seasonAdvisor.ts`, model `claude-sonnet-4-6`, prompt-caching, `claudeUnavailable` fallback). **None of this is implemented** (no `src/season/`, no LLM SDK in `package.json`).

What transfers to the Live Draft effort is the **philosophy and shapes**, not code:

- **Algorithm-first → Claude** (mirroring the destination's own standing preference): compute a structured score object first; Claude is opt-in per idea and interprets, never invents. The Live Draft generator's candidate score object should follow the `TradeScore` discipline (explicit signals, composite, verdict band).
- **Claude fallback flag** (`claudeUnavailable: true` → render raw signals) — adopt this for per-idea analysis.
- **Prompt structure** (Role → `LeagueContext`/draft context summary → score object → response format) — the `seasonAdvisor` prompt template is a direct pattern to copy for the live-draft Claude analysis prompt (a fog item on the map).
- **Five-signal trade model** is *season-specific* (settled rosters, contender/rebuilder). The destination **explicitly drops** counterparty-acceptance modeling for the Live Draft and scores on **chart fairness only** — so do not reuse the five signals wholesale; reuse only the *value-delta* signal plus the new chart-fairness threshold (see [#176](https://github.com/wulke/dynastyff/issues/176)).

### C. Player-value + pick-value access — *reusable primitives*

The mock draft engine already solves "value any asset in one currency." The Live Draft generator should reuse these directly:

- **`scoreBotTradeAsset(asset, { playerValues, futurePickValues, startupPickValues })`** — `src/draft/bot-trade.ts`. Scores `player` / `future_pick` / `pick_slot` via the three maps. **This is the chart-fairness primitive the generator needs.**
- **`computeDerivedPickValues(state): Map<globalPick, value>`** — `src/ui/utils/draftUtils.ts:4`. The 12-team→N-team startup-chart derivation (DFF-SPKV-041). Reuse for a real N-team Sleeper startup.
- **Player-pool floor** — `min(ETL chart value, next-available-player value)` (DFF-SPKV-052). Apply to live `pick_slot` assets; "available players" becomes the Sleeper board's undrafted set.
- **Map construction** — `src/draft/bot-chain.ts:256` shows the `futurePickValues` key shape (`${year}:${round}`) and how the three maps are assembled from SQLite at session start.

All values come from `players.dynasty_value` and `pick_values` (populated by the ETL pipeline). The data-access layer is Drizzle over SQLite (`src/db/client.ts`, `src/db/schema.ts`). **No new value source is needed** (confirmed by [#176](https://github.com/wulke/dynastyff/issues/176)).

### D. UI components — *substantial reuse, especially for the target board*

`src/ui/components/`:

| Component | Reuse for Live Draft | Coupling caveat |
|---|---|---|
| **`AvailablePlayersPanel`** | **High.** Already has `AvailablePlayersTab = 'available' \| 'targets'` and consumes `draftState.userQueue` (a ranked list — see `resolveQueuedPlayers`). This is effectively a target-board panel already; [#178](https://github.com/wulke/dynastyff/issues/178) can build the target-board model + "add to targets" UX **on top of the existing `user_queue` table + `'targets'` tab** rather than from scratch. | Currently reads mock `DraftState` (`availablePlayers`, `userQueue`, `currentPickNumber`, `draftOrder`). A live draft supplies the same shape from Sleeper board state. |
| `TradeModal`, `TradeBalanceSummary`, `tradeAssetPresentation` | **High** for rendering a trade idea's assets-out/in + chart-fairness score. `tradeAssetPresentation` already handles `player` / `pick_slot` / `future_pick` rendering with `STARTUP` badges (DFF-SPKV-060). | Built for the mock trade-offer flow (accept/decline against a bot). Idea display is advisory-only (no accept), so wrap in a read-only shell. |
| `positionBadge` (`positionBadge.ts`) | **Direct** — fixed QB/RB/WR/TE/PICK badge colors across themes. | None. |
| `DraftBoard` | **Medium.** A grid board; the live draft board is the same concept. | Tightly coupled to mock `DraftState` + SSE `state_sync`. A live board needs a Sleeper-derived state of the same shape, or a parallel component. |
| `PickFeedPanel`, `TeamRosterPanel`, `DraftGradeSummaryView` | **Low–Medium.** Pick feed and roster panels conceptually map; grade summary is mock-bot-specific. | Coupled to mock context. |
| `DraftConfigScreen`, `DraftsListPage`, `HistoryView` | **Low** for the live room (config/list/history are mock-session flows). The config screen's Sleeper-import field is the only live touchpoint today. | — |

`src/ui/context/DraftContext.tsx` is the single source of UI state (React Context + `useReducer`); writes flow only via SSE events. The only `advisor` reference here is `ADVISOR_RESET` (UI scaffolding for an advisor that isn't wired server-side). A Live Draft section will likely want its own context (live board state is poll-derived, not bot-SSE-derived) but can mirror the pattern.

### E. Design system — *directly applicable*

`DESIGN.md` tokens (`text-accent`, `bg-surface`, `border-default`, …), position-badge classes (`text-pos-qb`, …), `font-condensed` + `tabular-nums` for values, and the radius/padding conventions apply as-is. `positionBadge.ts` and the value-display patterns in the trade components are the concrete expression of the system. **No design-system work is in scope** beyond reusing it.

---

## Net-new (the honest build scope)

Concretely, what does **not** exist and must be built for the Live Draft section:

1. **Sleeper draft ingestion client** — `fetchDraft` / `fetchDraftPicks` / `fetchTradedPicks`, startup-draft selection (earliest-season `/league/{id}/drafts` entry), `slot_to_roster_id` handling. ([#175](https://github.com/wulke/dynastyff/issues/175), [#181](https://github.com/wulke/dynastyff/issues/181))
2. **Polling loop + on-the-clock derivation** — cadence, `last_picked` short-circuit, `If-None-Match`/304, backoff, terminal fetch. ([#181](https://github.com/wulke/dynastyff/issues/181))
3. **Live-draft board-state SQLite tables** — no `sleeper_*` tables exist; `sleeper_drafts` / `sleeper_draft_picks` / `sleeper_draft_traded_picks` (+ optional sync-runs) are net-new schema. ([#181](https://github.com/wulke/dynastyff/issues/181))
4. **Target-board state + UX** — extends the existing `user_queue` + `'targets'` tab; the *live-draft-session-keyed* target model and "add to targets from Available Players" affordance are new. ([#178](https://github.com/wulke/dynastyff/issues/178))
5. **League-intel input model** — entirely new (no concept exists). ([#179](https://github.com/wulke/dynastyff/issues/179))
6. **Trade-idea candidate generator** — the *candidate-generation* logic is new (the mock `bot-trade.ts` only *evaluates* bot-initiated offers against simulated opponents; it does not generate a ranked candidate list from a target board + league intel + live board). The *valuation primitives* (§C) are reused. ([#177](https://github.com/wulke/dynastyff/issues/177))
7. **Claude analysis layer** — no LLM SDK, no `seasonAdvisor`. Net-new module following the `advisor-agent.md` / `season-management.md` prompt patterns. (Currently a fog item; graduates once [#177](https://github.com/wulke/dynastyff/issues/177) fixes the generator output shape.)
8. **Live Draft section UI shell + routing** — a new top-level nav section wiring the live board, target board, ranked ideas, and per-idea analysis. (Fog item; graduates after generator output shape + reuse inventory land.)

---

## Cross-ticket impacts (for the map)

- **[#177](https://github.com/wulke/dynastyff/issues/177) (generator):** its *scoring currency* sub-question is fully answered by [#176](https://github.com/wulke/dynastyff/issues/176) + §C above — reuse `scoreBotTradeAsset` + the three maps + the player-pool floor. Its *candidate generation* sub-question is net-new (item 6).
- **[#178](https://github.com/wulke/dynastyff/issues/178) (target board):** should explicitly consider building on `user_queue` + the existing `'targets'` tab rather than a fresh table/panel — this research surfaces that affordance, which the ticket didn't know about.
- **[#181](https://github.com/wulke/dynastyff/issues/181) (ingestion):** confirmed the `sleeper_*` tables do not exist and that `sleeper-config-import.ts` is the only Sleeper code to pattern off — consistent with the ticket's scope; no reuse shortcut is being missed.
- **"Claude analysis prompt" + "UI layout" fog items:** both stay fog until [#177](https://github.com/wulke/dynastyff/issues/177) lands the generator output shape; this inventory is the second prerequisite (the "reuse inventory" the fog item names) for the UI-layout graduation.

---

## Sources

- Source tree: `find src -name '*.ts' -o -name '*.tsx'` (full listing)
- `grep -rni 'tradeScorer|seasonAdvisor|season-manage' src` → **no hits** (season mgmt is LLD-only)
- `grep -rni 'fetchLeagueState|fetchDraft|/drafts|/players/nfl' src` → only `src/server/app.ts` (the config-import route), `src/ui/vite.config.ts`
- `grep -rni 'anthropic|claude|advisor|messages.create' src` → only `src/ui/context/DraftContext.tsx` (`ADVISOR_RESET`)
- `package.json` — no `@anthropic-ai/sdk` / `openai` / any LLM SDK
- Live DB `.tables`: `draft_order drafts etl_runs league_configs pick_value_snapshots pick_values picks player_value_snapshots players roster_players team_pick_assets teams trades user_queue` — **no `sleeper_*`**
- `src/server/app.ts` (Express routes — full surface), `src/server/sleeper-config-import.ts`
- `src/draft/bot-trade.ts` (`scoreBotTradeAsset`, asset types), `src/draft/bot-chain.ts:256` (value-map assembly), `src/ui/utils/draftUtils.ts:4` (`computeDerivedPickValues`)
- `src/ui/components/AvailablePlayersPanel.tsx` (`AvailablePlayersTab`, `userQueue`, `resolveQueuedPlayers`)
- `src/etl/export-snapshot.ts:89` (snapshot excludes startup slots)
- LLDs: `docs/llds/season-management.md`, `docs/llds/advisor-agent.md`, `docs/llds/sleeper-sync.md`, `docs/llds/ui.md`, `docs/high-level-design.md`
