# LLD: Static Build (GitHub Pages)

## Context

The static build is a second deployable target of the same codebase. It produces a self-contained browser-only application with no Express server, no SQLite, and no persistent storage. Player and pick-value data is loaded from a static JSON snapshot committed to the repository and regenerated on demand via a GitHub Actions workflow. The app is deployed to `https://wulke.github.io/dynastyff/` from the `main` branch on every push.

The advisor agent is intentionally excluded from this build — it requires a live server-side API key and Claude API calls that are not appropriate for a public static site.

Drives specs: `docs/specs/static-build-specs.md`

The static build actively guards this boundary at build time. The Vite config rejects forbidden server-only imports (`express`, `better-sqlite3`, `drizzle-orm`, `node:*`) and advisor-only references (`@anthropic-ai/sdk`, `ANTHROPIC_API_KEY`, advisor API endpoint strings) anywhere in the static entry graph. CI also scans the emitted JS bundle to ensure those strings never ship in `dist/static/`.

## Architecture

```
                GitHub Actions
                ┌──────────────────────────────────────┐
  workflow_dispatch → ETL (Playwright) → export-snapshot → commit data/snapshot.json
                └──────────────────────────────────────┘
                                  ↓ (on push to main)
                ┌──────────────────────────────────────┐
                │  Vite build (src/ui-static/)          │
                │  base: '/dynastyff/'                  │
                └──────────────────────────────────────┘
                                  ↓
                ┌──────────────────────────────────────┐
                │  GitHub Pages                         │
                │  https://wulke.github.io/dynastyff/  │
                └──────────────────────────────────────┘

Browser runtime (no server):
┌───────────────────────────────────────────────────┐
│  src/ui-static/App.tsx                            │
│    snapshot fetch + stale warning + full-screen   │
│    loading/error surfaces                         │
│         ↓                                         │
│  InMemoryDraftContextProvider                     │
│    src/draft/engine.ts  ←→  src/draft/bot.ts     │
│         ↓                                         │
│  Shared DraftApp shell (src/ui/App.tsx)           │
│    Config │ Drafting │ Grade Summary │ History    │
│    status bar │ completion banner │ history flow  │
└───────────────────────────────────────────────────┘
```

## In-Memory Draft Engine

The in-memory draft engine (`src/draft/engine.ts`) is an isomorphic TypeScript module — no Node APIs, no SQLite, no Drizzle. It exposes pure functions that take and return plain state objects. `randomUUID` uses the Web Crypto API (`globalThis.crypto.randomUUID()`), which is available in both browsers and Node ≥ 19.

### State shape

```ts
type InMemoryDraftState = {
  draftId: string;
  status: 'in_progress' | 'completed';
  config: DraftConfig;
  teams: Team[];
  draftOrder: DraftSlot[];   // full snake order, length = teams × rounds
  picks: Pick[];             // append-only; index = pick_number - 1
  rosterPlayers: RosterEntry[];
  teamPickAssets: TeamPickAsset[];
  userQueue: QueueEntry[];
};

type DraftConfig = {
  teamCount: number;
  rounds: number;
  scoringFormat: ScoringFormat;
  userPickPosition: number;
  futurePickYears: number;
  rosterConfig: RosterConfig;
};

type DraftSlot = {
  pickNumber: number;
  round: number;
  pickInRound: number;
  teamId: string;
};
```

### Engine functions

```ts
// Initialize a new draft from config and loaded snapshot data
createDraft(config: DraftConfig, players: Player[], pickValues: PickValue[]): InMemoryDraftState

// Record a pick (user or bot); returns updated state or throws on invalid pick
submitPick(state: InMemoryDraftState, playerId: string): InMemoryDraftState

// Derive the next team that must pick; null when draft is complete
currentTeam(state: InMemoryDraftState): Team | null

// Derive available (undrafted) players sorted by dynastyValue desc
availablePlayers(state: InMemoryDraftState, allPlayers: Player[]): Player[]
```

`createDraft` generates teams (one flagged `isUser = true` at `userPickPosition`), assigns each bot team a random archetype from the six defined archetypes, and builds the full snake `draftOrder` array in memory. It also generates `teamPickAssets` for each team across the configured future `(year, round)` matrix. No side effects.

`submitPick` validates the player is available, records the pick, and advances state. It does not trigger bot turns — the caller (React context) is responsible for the bot loop.

### Bot loop

The bot loop lives in the static build's React context (`src/ui-static/InMemoryDraftContext.tsx`). After each pick it checks whether the next slot belongs to a bot and, if so, calls `selectBotPick` with a 1.5–3s async delay before calling `submitPick` again. The loop halts when `currentTeam` returns `null` (draft complete) or when the current slot is the user's turn.

If `selectBotPick` or `submitPick` throws an `InvariantError` during the bot loop, the context stops the chain immediately and surfaces a toast indicating the draft cannot continue.

```ts
async function runBotChain(state: InMemoryDraftState, players: Player[]): Promise<InMemoryDraftState>
```

## Bot Simulator

`src/draft/bot.ts` is a pure, isomorphic module — no server dependency. It is also imported by the existing server-side bot simulator, replacing any duplicated logic there over time.

```ts
selectBotPick(
  available: Player[],
  team: Team,              // carries archetype
  roster: RosterEntry[],
  noise: number            // 0–1, configurable per archetype
): string                  // player_id
```

Archetype scoring weights (unchanged from the server-side design):

| Archetype | Value weight | Need multiplier | Noise |
|---|---|---|---|
| `bpa` | 1.0 | 0.5 | 0.05 |
| `balanced` | 0.8 | 0.8 | 0.10 |
| `win_now` | 0.6 | 1.2 | 0.08 |
| `punt` | 0.9 | 0.3 | 0.12 |
| `rb_heavy` | 0.7 | 1.5× RB else 0.6 | 0.10 |
| `qb_early` | 0.5 | 1.8× QB r1–3 else 0.7 | 0.08 |

Score formula per player: `dynastyValue × valueWeight × needMultiplier + noise × random()`

## Static Data Snapshot

### Format

```ts
type Snapshot = {
  exportedAt: string;       // ISO-8601 UTC
  players: SnapshotPlayer[];
  pickValues: SnapshotPickValue[];
};

type SnapshotPlayer = {
  id: string;
  name: string;
  position: 'QB' | 'RB' | 'WR' | 'TE';
  nflTeam: string | null;
  age: number | null;
  isRookie: boolean;
  dynastyValue: number;
  adp: number | null;
};

type SnapshotPickValue = {
  year: number;
  round: number;
  dynastyValue: number;
};
```

Source-specific value columns (`value_ktc`, `value_fantasycalc`, etc.) are omitted — they are ETL internals.

### Export script

`src/etl/export-snapshot.ts` reads from the local SQLite database and writes `data/snapshot.json`. It is invoked after `npm run etl` completes and is exposed as `npm run export:snapshot`. The two can be chained as `npm run etl && npm run export:snapshot` for local use.

### Loading in the static app

`src/ui-static/App.tsx` issues a single `fetch` call to `./data/snapshot.json` (relative to the page base) at app mount, before any draft config is displayed. The static Vite build copies the repository snapshot file into `dist/static/data/snapshot.json`, so the browser fetch resolves without a server. `src/ui-static/App.tsx` stops at loading the snapshot into React state, showing the stale-data warning, and rendering the full-screen loading/error surfaces. Once the snapshot is ready, it passes the snapshot into `InMemoryDraftContextProvider` and renders the shared `DraftApp` shell from `src/ui/App.tsx`. If the fetch fails, a full-screen error is shown and the app is unusable — there is no draft without data.

## GitHub Actions Workflows

### Scheduled ETL refresh workflow (`scheduled-refresh.yml`)

Triggered weekly by `schedule` and on-demand by `workflow_dispatch`; see `llds/etl-scheduling.md` for the full design. Runs the ETL and `export:snapshot` from a fresh (non-persisted) database, gates the result behind `npm run etl:sanity-check`, and — only if the snapshot changed — opens a PR against `main` rather than pushing directly. Replaces the earlier direct-push `etl-snapshot.yml`.

The SQLite file is not committed — only `snapshot.json`.

### Pages deploy workflow (`pages.yml`)

Triggered on every push to `main`. Steps:
1. Checkout repo
2. Set up Node 22, `npm ci`
3. Build static app: `npm run build:static` (runs `vite build --config src/ui-static/vite.config.ts`)
4. Upload artifact via `actions/upload-pages-artifact` (source: `dist/static/`)
5. Deploy via `actions/deploy-pages`

The build job declares `pages: write` so `actions/upload-pages-artifact` can publish the static artifact even in repositories with a read-only default `GITHUB_TOKEN`. The deploy job declares `pages: write` and `id-token: write` and uses the `github-pages` environment.

The `pages.yml` workflow requires the repository's Pages source to be set to "GitHub Actions" in the repo settings.

## Static Build Guardrails

`src/ui-static/vite.config.ts` owns two build-time enforcement checks:

1. A source-graph guard plugin scans every static-build module and throws immediately when a forbidden server-side or advisor-only import/reference appears.
2. A snapshot copy plugin verifies `data/snapshot.json` exists before copying it into `dist/static/data/snapshot.json` and throws a descriptive error telling the user to run `npm run export:snapshot` first when it is missing.

## Shared Components and Component Decoupling

Existing components under `src/ui/components/` are refactored to accept data and action callbacks via props or a React context interface rather than calling `fetch` directly. The context interface is:

```ts
interface DraftContextValue {
  snapshot: Snapshot | null;
  draftState: DraftState | null;
  sessionHistory: CompletedDraft[];
  startDraft(config: DraftConfig): void;
  submitPick(playerId: string): void;
  updateQueue(queue: QueueEntry[]): void;
  newDraft(): void;
}
```

The main app wires an `HttpDraftContext` implementation (calls Express endpoints, listens to SSE).
The static app wires an `InMemoryDraftContext` implementation (manages in-memory engine state, runs the bot loop locally).

Components reference `useDraftContext()` and are unaware of which implementation is active.

`src/ui-static/App.tsx` is intentionally thin. It owns only snapshot loading, stale-snapshot warning state, and the full-screen loading/error surfaces. It does not own the view-state machine, draft-room layout, completion banner, or history transition logic. Once the snapshot is ready, it wraps `InMemoryDraftContextProvider` around the shared `DraftApp` export from `src/ui/App.tsx`.

All view-state decisions (`config`, `drafting`, `grade-summary`, `history`), the drafting status bar, the three-column drafting layout, the completion banner, and the `View Full History` transition are owned by `DraftApp`. This makes the static build and HTTP build render the same draft-room UX from a single source of truth.

**Dev mode:** Running `npm run dev:static` starts Vite's dev server with the static build's config. The `createSnapshotCopyPlugin` serves `data/snapshot.json` at runtime via a `configureServer` middleware so the snapshot fetch succeeds. The `base: '/dynastyff/'` path is handled correctly in both dev and production builds.

## Session History

In the static build, draft history is in-memory only — it does not survive a page refresh. `InMemoryDraftContext` maintains a `sessionHistory: CompletedDraft[]` array. When `currentTeam` returns `null` (all picks exhausted), the engine transitions the draft to `completed` and the context appends a `CompletedDraft` snapshot to `sessionHistory`.

```ts
type CompletedDraft = {
  draftId: string;
  completedAt: string;
  draftOrder: DraftSlot[];
  picks: Pick[];
  teams: Team[];
  rosterPlayers: RosterEntry[];
  teamPickAssets: TeamPickAsset[];
  trades: TradeRecord[];
};
```

The shared `DraftApp` keeps the user in the drafting shell when the draft completes so the completion banner can render over the Draft Board. If the user clicks `View Draft Grade`, `DraftApp` transitions to the shared grade summary screen; if the user then clicks `View Full History`, `DraftApp` transitions to the shared `HistoryView` component with the same Pick Log, Roster View, and Trade Log tabs used by the server-backed build. The `buildDraftState` function populates `playerCatalog` from all snapshot players so drafted players are renderable with their metadata.

`newDraft()` clears only the active draft state. Snapshot data and `sessionHistory` remain in memory so the user can run another mock in the same tab session, though the static build still does not expose persisted `GET /drafts` review flows because there is no Express server in that context.

## File Layout

```
src/
  draft/
    engine.ts            — NEW: isomorphic in-memory state machine
    bot.ts               — NEW: isomorphic bot pick selection
    service.ts           — existing SQLite-backed service (unchanged)
    stream.ts            — existing SSE stream (unchanged)
  ui/
    components/          — shared React components (refactored to use context)
    context/
      DraftContext.tsx   — NEW: context interface + HttpDraftContext impl
    App.tsx              — refactored: uses DraftContext
  ui-static/
    index.html
    main.tsx
    App.tsx              — static entry; wires InMemoryDraftContext
    InMemoryDraftContext.tsx  — InMemoryDraftContext impl + bot loop
    vite.config.ts       — base: '/dynastyff/', outDir: '../../dist/static'
  etl/
    index.ts             — existing
    export-snapshot.ts   — NEW: reads SQLite, writes data/snapshot.json

data/
  snapshot.json          — committed; regenerated by ETL workflow
  dynastyff.sqlite       — gitignored (local only)

.github/
  workflows/
    ci.yml               — existing
    scheduled-refresh.yml — see llds/etl-scheduling.md
    pages.yml            — NEW
```

## Edge Case Probe

- `snapshot.json` fetch returns non-OK status → show full-screen error: "Player data unavailable. Try refreshing."
- `snapshot.json` parses but contains zero players → show full-screen error; block draft creation.
- `snapshot.json` is present but `exportedAt` is >30 days old → show dismissible banner: "Player data is over 30 days old."
- User refreshes the browser mid-draft → all in-memory state is lost; app returns to config screen with snapshot already loaded.
- Bot loop encounters a state where no available player exists (impossible under correct logic, but defensible) → throw `InvariantError` and surface as a toast; draft is unrecoverable.
- `workflow_dispatch` ETL run: scrapers fail partially → `export-snapshot.ts` runs on whatever is in SQLite; if SQLite is empty, the script exits with code 1 and no commit is made.
- GitHub Actions Pages deploy on a commit that only touches non-UI files → build still runs and redeploys (acceptable; deploy is fast).
- `actions/deploy-pages` requires `id-token: write` and `pages: write` permissions → must be declared on the `pages.yml` job.

## Decisions

| Decision | Chosen | Alternatives | Rationale |
|---|---|---|---|
| Advisor excluded | Yes | Include with user-provided key | Exposing API key in browser requests is a security risk for a public site; draft-only experience is complete without it |
| Static data location | `data/snapshot.json` committed to repo | Release asset; CDN | GitHub Pages serves repo files directly; zero infra required |
| ETL trigger | `workflow_dispatch` | Scheduled weekly cron | Dynasty values are stable; user controls freshness without burning CI minutes on automatic runs |
| Pages deploy trigger | Push to `main` | Manual | Site stays in sync with code automatically; no manual step to forget |
| In-memory engine | New `src/draft/engine.ts` | Reuse `service.ts` | `service.ts` is tightly coupled to SQLite; a clean isomorphic module is the right abstraction regardless of the static build |
| Component decoupling | Context interface | Direct prop drilling | Context avoids threading callbacks through multiple component layers; consistent with existing React patterns in the app |
| Session history | In-memory array | localStorage | localStorage adds serialization complexity and size limits; session-scoped history is sufficient for a practice tool |
| Vite base path | `/dynastyff/` | `/` | Required for asset resolution under the GitHub Pages subpath; must be changed if a custom domain is added |
