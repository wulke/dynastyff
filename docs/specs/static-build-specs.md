# EARS Specs: Static Build (GitHub Pages)

Drives: `docs/llds/static-build.md`

Status markers: `[x]` implemented · `[ ]` gap · `[D]` deferred

---

## Build Target

**DFF-STATIC-001** `[ ]`
The system shall expose an `npm run build:static` command that runs `vite build --config src/ui-static/vite.config.ts` and outputs the compiled assets to `dist/static/`.

**DFF-STATIC-002** `[ ]`
The static Vite config shall set `base` to `/dynastyff/` so all asset URLs resolve correctly under the GitHub Pages subpath.

**DFF-STATIC-003** `[ ]`
The static build shall include no server-side imports (`express`, `better-sqlite3`, `drizzle-orm`, `node:crypto`) and shall fail the build if any are present.

**DFF-STATIC-004** `[ ]`
The static build shall exclude the advisor agent — no Anthropic SDK imports, no advisor UI components, and no API key configuration.

---

## Static Data Snapshot

**DFF-STATIC-010** `[x]`
The system shall expose an `npm run export:snapshot` command that reads the `players` and `pick_values` tables from the local SQLite database and writes a JSON file to `data/snapshot.json`.

**DFF-STATIC-011** `[x]`
The exported `snapshot.json` shall conform to the following shape: `{ exportedAt: string, players: SnapshotPlayer[], pickValues: SnapshotPickValue[] }` where `SnapshotPlayer` carries `id, name, position, nflTeam, age, isRookie, dynastyValue, adp` and `SnapshotPickValue` carries `year, round, dynastyValue`.

**DFF-STATIC-012** `[x]`
When the export script is run against an empty or missing `players` table, or when the local SQLite database file is absent, the system shall exit with code 1 and print an error instructing the user to run `npm run etl` first.

**DFF-STATIC-013** `[ ]`
When the static application loads, it shall fetch `./data/snapshot.json` before rendering any draft configuration UI.

**DFF-STATIC-014** `[ ]`
If the `snapshot.json` fetch fails or returns a non-OK HTTP status, the system shall display a full-screen error message and prevent draft creation.

**DFF-STATIC-015** `[ ]`
If `snapshot.json` parses successfully but contains zero players, the system shall display a full-screen error message and prevent draft creation.

**DFF-STATIC-016** `[ ]`
If `snapshot.json` was exported more than 30 days before the current date (as determined by `exportedAt`), the system shall display a dismissible banner warning the user that player data may be stale.

---

## In-Memory Draft Engine

**DFF-STATIC-020** `[ ]`
The system shall implement `src/draft/engine.ts` as an isomorphic module with no imports from Node-only modules (`node:*`, `better-sqlite3`, `drizzle-orm`).

**DFF-STATIC-021** `[ ]`
`createDraft(config, players, pickValues)` shall return a complete `InMemoryDraftState` with: a generated `draftId`, status `in_progress`, `teams` array (one flagged `isUser = true` at `userPickPosition`), a full snake `draftOrder` array, empty `picks`, `rosterPlayers`, `userQueue`, and `teamPickAssets` covering all teams across the configured future `(year, round)` matrix.

**DFF-STATIC-022** `[ ]`
Bot teams created by `createDraft` shall each be assigned a random archetype drawn uniformly from: `win_now`, `punt`, `rb_heavy`, `qb_early`, `bpa`, `balanced`.

**DFF-STATIC-023** `[ ]`
`submitPick(state, playerId)` shall validate that the player has not already been picked in the current draft; if the player is already picked, it shall throw an error and not mutate state.

**DFF-STATIC-024** `[ ]`
`submitPick` shall record the pick as an append-only entry in `state.picks` and add a corresponding `rosterPlayers` entry assigning ownership to the picking team.

**DFF-STATIC-025** `[ ]`
`submitPick` shall remove any matching `userQueue` entry for the picked player.

**DFF-STATIC-026** `[ ]`
When `submitPick` is called on the final pick slot, the returned state shall have `status` set to `completed`.

**DFF-STATIC-027** `[ ]`
`currentTeam(state)` shall return `null` when `state.status` is `completed` or when no open `draftOrder` slot remains.

**DFF-STATIC-028** `[ ]`
`availablePlayers(state, allPlayers)` shall return all players whose `id` does not appear in `state.picks`, sorted by `dynastyValue` descending.

---

## Bot Simulator

**DFF-STATIC-030** `[ ]`
The system shall implement `src/draft/bot.ts` as an isomorphic module exporting `selectBotPick(available, team, roster, noise): string`.

**DFF-STATIC-031** `[ ]`
`selectBotPick` shall score each available player as `dynastyValue × valueWeight × needMultiplier + noise × Math.random()` where `valueWeight` and `needMultiplier` are determined by the team's archetype per the weights defined in the LLD.

**DFF-STATIC-032** `[ ]`
`selectBotPick` shall return the `id` of the highest-scoring available player.

**DFF-STATIC-033** `[ ]`
`selectBotPick` shall throw an `InvariantError` if `available` is empty.

**DFF-STATIC-034** `[ ]`
The static build's bot loop shall delay 1.5–3 seconds (randomly sampled) between successive bot picks to simulate realistic draft pacing.

**DFF-STATIC-035** `[ ]`
The static build's bot loop shall halt and yield control to the user when `currentTeam(state)` returns a team flagged `isUser = true`.

---

## GitHub Actions: ETL Snapshot Workflow

**DFF-STATIC-040** `[ ]`
The system shall provide a GitHub Actions workflow file at `.github/workflows/etl-snapshot.yml` triggered exclusively by `workflow_dispatch`.

**DFF-STATIC-041** `[ ]`
The ETL snapshot workflow shall: install Node 22, run `npm ci`, install Playwright Chromium (`npx playwright install --with-deps chromium`), run `npm run etl`, and run `npm run export:snapshot`.

**DFF-STATIC-042** `[ ]`
After `export:snapshot` completes, the ETL snapshot workflow shall commit and push `data/snapshot.json` to the branch that triggered the workflow using the `github-actions[bot]` identity.

**DFF-STATIC-043** `[ ]`
If `data/snapshot.json` is unchanged after the export (no diff), the ETL snapshot workflow shall skip the commit step and exit cleanly without error.

**DFF-STATIC-044** `[ ]`
If `npm run export:snapshot` exits with a non-zero code, the ETL snapshot workflow shall fail the job and not attempt a commit.

---

## GitHub Actions: Pages Deploy Workflow

**DFF-STATIC-050** `[ ]`
The system shall provide a GitHub Actions workflow file at `.github/workflows/pages.yml` triggered on every push to `main`.

**DFF-STATIC-051** `[ ]`
The Pages deploy workflow shall declare `permissions: pages: write, id-token: write` on the deploy job.

**DFF-STATIC-052** `[ ]`
The Pages deploy workflow shall: install Node 22, run `npm ci`, run `npm run build:static`, upload the `dist/static/` directory via `actions/upload-pages-artifact`, and deploy via `actions/deploy-pages`.

**DFF-STATIC-053** `[ ]`
The Pages deploy workflow shall use the `github-pages` environment so deployments are gated and visible in the GitHub Deployments UI.

---

## Component Decoupling

**DFF-STATIC-060** `[x]` → #54
The system shall define a `DraftContextValue` interface in `src/ui/context/DraftContext.tsx` exposing: `snapshot`, `draftState`, `sessionHistory`, `startDraft`, `submitPick`, `updateQueue`, and `newDraft`.

**DFF-STATIC-061** `[x]` → #54
Existing `src/ui/` components shall reference `useDraftContext()` for all draft data and action calls and shall not directly call `fetch` against Express endpoints.

**DFF-STATIC-062** `[x]` → #54
The main app (`src/ui/App.tsx`) shall wire an `HttpDraftContext` implementation of `DraftContextValue` that calls Express HTTP endpoints and subscribes to the SSE stream.

**DFF-STATIC-063** `[ ]`
The static app (`src/ui-static/App.tsx`) shall wire an `InMemoryDraftContext` implementation of `DraftContextValue` that operates entirely in browser memory using the in-memory draft engine.

---

## Session History

**DFF-STATIC-070** `[ ]`
The static app's `InMemoryDraftContext` shall maintain a `sessionHistory` array that accumulates one `CompletedDraft` entry per finished draft session.

**DFF-STATIC-071** `[ ]`
When a draft transitions to `completed`, the context shall append a `CompletedDraft` snapshot to `sessionHistory` before transitioning the view state to `history`.

**DFF-STATIC-072** `[ ]`
The history view in the static app shall render the `sessionHistory` array in reverse chronological order.

**DFF-STATIC-073** `[ ]`
Session history shall not be persisted to `localStorage` or any browser storage API — it is intentionally lost on page refresh.
