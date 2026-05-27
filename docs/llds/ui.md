# LLD: UI

## Context

The UI is a local-first React single-page application that runs in the browser pointed at `localhost`. It is the sole interaction surface for the user: configuring a draft, running it, querying the advisor, and reviewing history. It connects to the Express backend via HTTP and SSE. There is no auth, no routing library, and no mobile layout — this is a desktop-only tool for one user.

Drives specs: `docs/specs/ui-specs.md`

## Responsibilities

- Render the Drafts List page as the app entry point when persisted drafts exist
- Render the League Config screen and persist saved configs to SQLite via the backend
- Render the Draft Board grid and keep it in sync with SSE events
- Render the Available Players list with position filter and name search
- Open and close the Advisor slide-out panel, managing advise-me and grill-me interactions
- Render the Draft History view with pick log, roster view, and trade log
- Render the Pick Feed panel with real-time pick updates alongside the draft board
- Display inline loading states and surface errors via a global toast
- Handle SSE connect, reconnect, and disconnect gracefully

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | Vite + React |
| Styling | Tailwind CSS + Radix UI primitives |
| State | React Context + useReducer |
| Routing | Conditional rendering via view-state enum |
| Location | `/src/ui` |
| Build | Shared root `package.json` and `tsconfig.json` |

## View State Machine

There is no router. A single top-level enum drives which view is rendered:

```
drafts-list → config → drafting → history
   │            │           │        ▲
   │            │           │        │
   │            │           └── (completion banner) ──┘
   │            │
   └────────────┘
```

Startup:
- On app load, fetch `GET /drafts`. If drafts exist → `drafts-list`. If none exist or the fetch fails → `config`.

Transitions:
- `drafts-list → config`: user clicks "New Draft"
- `drafts-list → drafting`: user clicks "Resume" on an in-progress draft; loads draft state and connects SSE
- `drafts-list → history`: user clicks "Review" on any draft; loads draft state directly to history view
- `config → drafting`: user submits config and a draft is created (`POST /drafts`)
- `drafting (board) → drafting (completed banner)`: `draft_complete` SSE event received
- `drafting (completed banner) → history`: user clicks `View Full History`
- `history → config`: user clicks "New Draft"

## App Scaffold

Issue `#13` establishes the initial frontend shell under `/src/ui`, issue `#15` replaces the placeholder config shell with the first real user workflow, and issue `#54` introduces the shared draft context and HTTP-backed SSE lifecycle:

- `index.html` mounts the React app through Vite
- `main.tsx` hydrates a single `<App />` entry point
- `App.tsx` renders the top-level view shell while `HttpDraftContext` owns draft network effects and live draft state
- Tailwind CSS provides the shell styling and layout primitives
- A Radix UI primitive is wired into the shared shell so the initial scaffold proves the dependency path works before later feature slices add dialogs, tabs, and other interactive primitives

At this stage, the config view is functional, the drafting view now renders the live draft board, and the history view remains a light shell:

- Drafts list: fetched from `GET /drafts` on mount; shows all persisted drafts with Resume/Review CTAs
- Config screen: league settings form + `Start Draft` calls `startDraft()` on `HttpDraftContext`
- Draft board: renders immediately after draft creation, keeps the live SSE status badge, and hydrates the grid in place from `state_sync` / `pick_made` events
- Draft completion banner: renders over the Draft Board when `draft_complete` arrives, keeps the board visible behind the overlay, and exposes `View Full History`
- History shell: becomes visible only after the user clicks `View Full History`, then exposes `New Draft`

## Component Hierarchy

```
<App>                          ← holds view shell
  <HttpDraftContextProvider>   ← owns POST/queue/pick calls, SSE, toast state
  <DraftsListPage />           ← view: drafts-list
  <ConfigScreen />             ← view: config
  <DraftView>                  ← view: drafting
    <DraftBoard />             ← grid: rounds × teams
    <DraftCompletionBanner />  ← modal-style overlay on completed drafts
    <PickFeedPanel />         ← real-time pick feed
    <PlayerList />             ← available players, filter + search
    <AdvisorPanel />           ← slide-out, advise-me + grill-me
    <TradeModal />             ← blocking modal on trade_offered SSE
  </DraftView>
  <HistoryView>                ← view: history
    <PickLog />                ← toggle tab
    <RosterView />             ← toggle tab
    <TradeLog />               ← toggle tab
  </HistoryView>
  <Toast />                    ← global error surface
```

## State Model

A single `DraftContext` (React Context + useReducer) holds all draft state. `HttpDraftContext` is the server-backed implementation used by the main app. SSE events are the only write path into the reducer during a live draft after the initial draft-creation POST succeeds.

**State shape:**

```ts
type DraftState = {
  draftId: string | null;
  status: 'idle' | 'in_progress' | 'completed';
  currentPickNumber: number | null;
  teams: Team[];
  draftOrder: DraftOrderSlot[];
  playerCatalog: Record<string, AvailablePlayer>;
  picks: PickRecord[];
  rosterPlayers: RosterPlayerRecord[];
  teamPickAssets: TeamPickAsset[];
  userQueue: QueueEntry[];
  availablePlayers: AvailablePlayer[];
  trades: TradeRecord[];
  pendingTrade: PendingTrade | null;
  sseStatus: 'connecting' | 'connected' | 'disconnected';
  completedAt: string | null;
};
```

**Reducer actions:**

| Action | Triggered by |
|---|---|
| `DRAFT_CREATED` | `POST /drafts` response |
| `STATE_SYNC` | Initial SSE hydration event |
| `PICK_MADE` | `pick_made` SSE event |
| `YOUR_TURN` | `your_turn` SSE event |
| `TRADE_OFFERED` | `trade_offered` SSE event |
| `TRADE_RESOLVED` | `trade_resolved` SSE event |
| `DRAFT_COMPLETE` | `draft_complete` SSE event |
| `SSE_STATUS` | `useDraftStream` hook |

## Drafts List Page

Rendered as the app entry point when persisted drafts exist. Fetches `GET /drafts` on mount. Shows a table of all drafts with actions.

**Features:**
- Table columns: draft ID (truncated), status badge, date created, team count, rounds, scoring format
- "Resume" button on in-progress drafts: calls `loadDraft(draftId)` on the context, then navigates to drafting view
- "Review" button on all drafts: calls `loadDraft(draftId)` on the context, then navigates to history view
- "New Draft" button: clears draft state and navigates to config screen
- Loading state: skeleton rows while `GET /drafts` is in flight
- Empty state for `GET /drafts` returning `[]` → redirects to config screen
- Error state: shows error toast and falls back to config screen

**Data source:** `GET /drafts` returns `DraftHistoryEntry[]` with `id`, `created_at`, `completed_at`, `status`, `team_count`, `rounds`, `scoring_format`.

**Integration:**
- `loadDraft(draftId)` is a new method on `HttpDraftContext` that fetches `GET /drafts/:id/state` and dispatches `STATE_SYNC` to hydrate the reducer
- `showError(message)` is exposed through `DraftContextValue` so `App.tsx` can surface a global toast when the initial `GET /drafts` bootstrap request fails before any draft is active
- SSE stream starts automatically for in-progress drafts; for completed drafts, SSE sends `state_sync` + `draft_complete` which the existing hook handles

**Edge Case Probe:**
- `GET /drafts` returns 500 or rejects → show toast, fall back to config screen
- User clicks Resume on a draft that another call has already completed → state loads via `GET /drafts/:id/state`, SSE stream sends current state
- Date formatting with non-ISO timestamp → `new Date()` fallback shows `Invalid Date` only if the raw value is truly unparseable

## Draft Board Grid

The grid is fixed at draft creation (`round_count × team_count` cells). Cells fill in as `pick_made` events arrive, using a persistent in-memory player catalog so the board can keep rendering drafted player metadata after each player is removed from `availablePlayers`.

**Layout modes** (toggled via an icon-only button in the draft board header; preference persisted to localStorage; default: row mode):

- **Row mode** — rounds are columns, teams are rows. The header row shows round numbers; the left column shows team names and remains sticky during horizontal scroll. The user's row is visually highlighted.
- **Column mode** — teams are columns, rounds are rows. The header row shows team names and remains sticky during vertical scroll; the left column shows round numbers. The user's team column header is visually distinguished with an amber tint.

**Cell states:**
- Empty (future pick): faint border, waiting state copy
- Filled pick: player name, position badge, drafting team name, and NFL team when available
- Current pick (bot in progress): pulsing skeleton
- Current pick (user turn): same waiting state copy as other unfilled future slots; no skeleton

**Position badge colors:** QB=amber, RB=blue, WR=emerald, TE=purple, PICK/RDP=yellow, default=stone.

Pick position in a round is derived from the snake order: odd rounds left-to-right, even rounds right-to-left.

**Edge Case Probe:**
- `pick_made` arrives before the first `state_sync` (empty catalog) -> `getDraftedPlayerSummary` falls back to the raw `playerId` as the name and `NA` as the position badge so the cell degrades without crashing
- Player exists in `picks` but is absent from all `available_players` payloads -> the same fallback path keeps the cell visible instead of hiding the pick
- Reconnect `state_sync` omits already drafted players from `available_players` -> `playerCatalog` is merged rather than replaced so prior drafted-player metadata still renders
- Team has no pick in a given round (for example after a pick-slot trade) -> the board renders an empty `<td>` for that team/round intersection without throwing

## Draft Completion Banner

A blocking banner rendered only after the draft reaches `status: 'completed'`. It overlays the Draft Board container instead of navigating away immediately, so the final board remains visible in the background.

**Features:**
- Triggered by the `draft_complete` SSE event after the reducer marks the draft completed
- Displays a congratulatory heading, the user's team name, and a single `View Full History` CTA
- Keeps the Draft Board grid visible but non-interactive beneath a translucent overlay
- Does not expose a dismiss or close affordance; the only in-flow exit is `View Full History`
- Leaves the existing history data in `draftState`, so clicking the CTA swaps the view shell to the already-hydrated `HistoryView`

**Edge Case Probe:**
- User team lookup fails (unexpected malformed state) -> banner falls back to `Your team`
- `draft_complete` arrives before the first `state_sync` -> banner still renders from reducer state, even if the board has sparse metadata
- Completed draft state is rehydrated after a reconnect or future refresh-restore path -> the completion banner renders again, because `View Full History` is client-local UI state and is not persisted

## Pick Feed Panel

A scrolling real-time feed panel rendered alongside the draft board, driven by `pick_made` SSE events processed through the `DraftContext` reducer. Every pick — bot or user — appears as a new entry at the top of the feed as it happens.

**Features:**
- Hydrates from `draftState.picks` on initial load, sorted by `pickNumber` descending so the most recent pick appears at the top
- Each new `pick_made` event adds the pick to `draftState.picks` via the reducer; the feed re-renders with the new entry at the top
- Each entry displays: player name, position badge (color-coded via `getPositionBadgeClass`), drafting team name, round, and pick-in-round (e.g. "Rd 3, Pick 5")
- Fixed-height panel with independent vertical scroll (overflow-y-auto)
- Shows an empty-state message ("No picks yet") when `draftState.picks` is empty
- Foundation for the Pick Log tab in the History View (#21) — shares the same rendering patterns

**Decisions:**
- `getPositionBadgeClass` is intentionally duplicated inline rather than extracted to a shared module. The function is small (~20 lines of Tailwind class strings) and its behavior is identical across DraftBoard, PickFeedPanel, and HistoryView. A future color change affecting all three surfaces should update all three call sites. If the function grows additional behavior (e.g., tooltips, icons), extract to `src/ui/components/positionBadge.ts`.

**Edge Case Probe:**
- Player ID is absent from `playerCatalog` → entry displays the raw `playerId` as the name and `NA` as the position badge
- Draft has zero picks → panel shows empty state without crashing
- Same player is picked twice (impossible in valid state but handles gracefully) → duplicate entries render, since each `pick_made` produces a unique pick record
- Pick number is absent from `draftOrder` (should not happen in practice but handle defensively) → entry renders an em dash (`—`) in place of "Rd N, Pick M" instead of showing "Rd 0, Pick 0"

## Available Players List

Rendered alongside the draft board during the user's turn. Hidden during bot turns (replaced by a "Bot is picking…" state).

**Features:**
- Sorted by `dynasty_value` descending by default
- Position filter: ALL / QB / RB / WR / TE / Picks (pill buttons)
- Name search: free-text input, filters the list client-side
- Each row: player name, position badge, NFL team, age, dynasty value
- Clicking a player row submits `POST /drafts/:id/pick` and dispatches `ADVISOR_RESET`
- While `GET /drafts/:id/state` is hydrating the draft room, the panel renders skeleton rows instead of player data
- During bot turns, rows are disabled and a "Bot is picking…" message replaces the interactive list
- If `POST /drafts/:id/pick` fails, a global toast surfaces "Pick failed — player may already be taken."

The full available player list is loaded once from `GET /drafts/:id/state` at draft start or resume. Draft creation transitions into the draft room immediately, then an HTTP hydration request fills in the initial board/list state while SSE stays connected in parallel. As `pick_made` events arrive, the reducer removes picked players from `availablePlayers` client-side — no re-fetch needed.

## Advisor Slide-Out Panel

A panel that slides in from the right, overlaying the draft board. Toggled by an "Advisor" button in the draft header. Width: ~380px. Does not block interaction with the draft board beneath it.

**Advise Me tab:**
- Button: "Advise Me" → `POST /drafts/:id/advisor/advise`
- Shows a loading spinner inline while waiting
- Renders the structured recommendation (Recommendation / Key Factors / Caveats)
- Recommendation refreshes on each new user turn (stale response cleared on `YOUR_TURN` action)

**Grill Me tab:**
- Chat interface: scrollable message history, text input at bottom
- User types their reasoning; each message sends `POST /drafts/:id/advisor/chat`
- Shows a typing indicator (animated dots) while waiting for Claude
- Conversation resets on `ADVISOR_RESET` (pick committed or turn changed)

Both tabs are available simultaneously; user switches between them with tab headers inside the panel.

## Config Screen

A single-page form rendered before any draft starts. Fields:

| Field | Type | Default |
|---|---|---|
| Config name | text | — |
| Team count | number (8–16) | 12 |
| Rounds | number (10–30) | 20 |
| Scoring format | select: PPR / Half PPR / Standard | PPR |
| Roster slots | number inputs per position (QB, RB, WR, TE, FLEX, SF, BN) | defaults from HLD |
| Pick position | number (1–team_count) | 6 |
| Future pick years | number (1–5) | 3 |

Issue `#15` scope:
- Render the full form with the defaults above
- Submit `POST /drafts` with camelCase JSON translated from the UI form state into the backend draft-create contract when the user clicks `Start Draft`
- Transition to the drafting view on success
- Show a global error toast and remain on the config screen if draft creation fails

`POST /drafts` request contract for the UI slice:

```ts
type DraftCreateRequestBody = {
  configName: string;
  teamCount: number;
  rounds: number;
  scoringFormat: 'ppr' | 'half_ppr' | 'standard';
  pickPosition: number;
  futurePickYears: number;
  rosterSlots: {
    QB: number;
    RB: number;
    WR: number;
    TE: number;
    FLEX: number;
    SF: number;
    BN: number;
  };
};
```

The browser form keeps local state in a UI-friendly `ConfigFormState` shape, then clamps numeric values and translates that state into the HTTP request body above before submit.

Deferred to issue `#16`:
- Saved-config dropdown loaded from `GET /configs`
- Selecting a saved config to repopulate the form
- `Save` button backed by `POST /configs`

**Schema amendment required:** A `league_configs` table is needed in the data model. Columns: `id` (text, PK), `name` (text, not null), `team_count`, `rounds`, `scoring_format`, `roster_slots` (JSON text), `pick_position`, `future_pick_years`, `created_at`.

## Edge Case Probe

- Team count changes can invalidate `userPickPosition` -> clamp the dependent pick position immediately on change and clamp again at submit time before translating to `pickPosition` in `POST /drafts`.
- Empty config name is allowed client-side -> submit proceeds and any stricter validation is deferred to the server response path.
- Server returns non-JSON success payload or omits `draftId` -> remain on the config screen and show the generic draft-creation failure toast because the success contract is incomplete.
- User attempts to submit twice -> `isSubmittingDraft` short-circuits duplicate requests until the first request settles.
- Fetch rejects entirely or the server returns a 5xx error -> remain on the config screen and show the generic draft-creation failure toast.

## Draft History View

Rendered after the user clicks `View Full History` from the draft completion banner. Uses the `draftState` data accumulated during the draft via SSE events (picks, trades, rosters).

Three tabs toggled by pill buttons at the top, implemented in `src/ui/components/HistoryView.tsx`:

**Pick Log tab:**
- Chronological list of all picks: round, pick number, team name, player name, position, dynasty value at draft time

**Roster View tab:**
- One card per team, positions grouped (QB, RB, WR, TE)
- Each player row: name, round drafted, dynasty value
- User's team card is highlighted

**Trade Log tab:**
- Chronological list of trades: round, initiating team, receiving team, assets sent, assets received, outcome (accepted / declined / force_declined)

**Edge Case Probe:**
- Player has a non-standard position (e.g., FLEX, K, DEF) -> position group not in `POSITION_ORDER` (`QB`, `RB`, `WR`, `TE`); the player is silently excluded from the Roster View tab. This is acceptable because the player pool is filtered to QB/RB/WR/TE at ETL time.
- All three tabs have an empty draft with no picks, roster players, or trades -> each tab renders a descriptive empty-state message instead of an empty table or crash.
- Trade asset is `player` type with a `player_id` absent from `playerCatalog` -> `getPlayerName` falls back to the raw `playerId`, keeping the Trade Log cell visible instead of showing an empty string.
- Trade has zero assets in either direction -> `formatAssets` returns `—` (em dash) for that column.
- User's team card has no roster players -> the card renders with all position groups showing `—` and the `You` badge is still visible.

## SSE Integration: `useDraftStream`

A custom hook that owns the SSE lifecycle and dispatches into the `DraftContext` reducer.

```ts
function useDraftStream(
  draftId: string | null,
  dispatch: Dispatch<DraftAction>,
  onDisconnectExhausted: () => void,
): void
```

**Behavior:**
- Opens `EventSource` to `GET /drafts/:id/stream` when `draftId` is set
- On each SSE message: parses event type and payload, dispatches the corresponding action, and marks the stream `connected` on the first successfully parsed event
- On `error`: dispatches `SSE_STATUS: 'disconnected'`, schedules reconnect with exponential backoff (1s, 2s, 4s, 8s, 16s, cap 30s)
- On `draft_complete`: closes the `EventSource` cleanly
- Cleanup: closes `EventSource` on unmount or `draftId` change
- Malformed SSE payload: close the current stream, mark the connection `disconnected`, and run the same reconnect schedule used for network errors

If the reconnect schedule reaches the capped 30-second attempt and that attempt also fails, the context surfaces a single global toast: `Lost connection to draft server. Refresh to reconnect.` The existing toast host remains single-instance and auto-dismisses after 6 seconds.

The hook does not return anything — it is side-effect only.

## Error and Loading States

**Loading:**
- Player list: skeleton rows while `GET /drafts/:id/state` is in flight
- Advisor response: inline spinner inside the panel (not a full-screen overlay)
- Bot picking: pulsing skeleton cell in the current pick slot on the board
- SSE connecting: "Connecting…" badge in the draft header

**Errors (global toast):**
- SSE disconnect after reconnect attempts exhausted: "Lost connection to draft server. Refresh to reconnect."
- `POST /pick` failure: "Pick failed — player may already be taken."
- Advisor API failure: "Advisor unavailable. Try again."

Toast auto-dismisses after 6 seconds. Only one toast visible at a time; new errors replace the previous one.

## Decisions

| Decision | Chosen | Alternatives | Rationale |
|---|---|---|---|
| Routing | View-state enum + conditional render | React Router | Only 3 views with linear transitions; no deep linking needed for a local tool |
| State management | React Context + useReducer | Zustand, Jotai | Zero dependencies; reducer maps cleanly to the draft state machine |
| SSE handling | Dedicated `useDraftStream` hook | Inline in component | Isolates connect/reconnect/cleanup logic from render; keeps dispatch flow explicit |
| Available players update | Client-side removal on `pick_made` | Re-fetch from server | Avoids a round-trip per pick; server is source of truth on reconnect via `/state` |
| Advisor panel | Slide-out overlay | Persistent split-screen | Draft board needs full horizontal width for 20 rounds; advisor is on-demand |
| Trade modal | Blocking Radix Dialog | Inline banner | Trade resolution is required before draft continues; blocking modal enforces that |
| Mobile support | Desktop-only | Responsive | 20-round grid is unusable on mobile; local tool has no mobile use case |
| Saved configs | SQLite via backend API | localStorage | Consistent with the project's SQLite-first persistence model |

## Open Questions

- [ ] Should the player list remain visible (read-only) during bot turns, or hidden entirely?
- [ ] Should the grill-me conversation history be saved with the draft record for post-draft review?
- [ ] What happens if the user refreshes mid-draft — does `GET /drafts/:id/state` fully restore the board, or does the user need to reconnect to SSE manually?
