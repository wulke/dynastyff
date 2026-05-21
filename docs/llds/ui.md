# LLD: UI

## Context

The UI is a local-first React single-page application that runs in the browser pointed at `localhost`. It is the sole interaction surface for the user: configuring a draft, running it, querying the advisor, and reviewing history. It connects to the Express backend via HTTP and SSE. There is no auth, no routing library, and no mobile layout — this is a desktop-only tool for one user.

Drives specs: `docs/specs/ui-specs.md`

## Responsibilities

- Render the League Config screen and persist saved configs to SQLite via the backend
- Render the Draft Board grid and keep it in sync with SSE events
- Render the Available Players list with position filter and name search
- Open and close the Advisor slide-out panel, managing advise-me and grill-me interactions
- Render the Draft History view with pick log, roster view, and trade log
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
config → drafting → history
           │
           └── (advisor panel overlays drafting view)
```

Transitions:
- `config → drafting`: user submits config and a draft is created (`POST /drafts`)
- `drafting → history`: `draft_complete` SSE event received
- `history → config`: user clicks "New Draft"

## App Scaffold

Issue `#13` establishes the initial frontend shell under `/src/ui`, issue `#15` replaces the placeholder config shell with the first real user workflow, and issue `#54` introduces the shared draft context and HTTP-backed SSE lifecycle:

- `index.html` mounts the React app through Vite
- `main.tsx` hydrates a single `<App />` entry point
- `App.tsx` renders the top-level view shell while `HttpDraftContext` owns draft network effects and live draft state
- Tailwind CSS provides the shell styling and layout primitives
- A Radix UI primitive is wired into the shared shell so the initial scaffold proves the dependency path works before later feature slices add dialogs, tabs, and other interactive primitives

At this stage, each view is intentionally an empty shell with a single transition control:

- Config screen: league settings form + `Start Draft` POSTs `/drafts` and drives `config → drafting`
- Draft shell: `Complete Draft` drives `drafting → history`
- History shell: `New Draft` drives `history → config`

The drafting and history shells remain intentionally light until subsequent issues replace them with the full board, player list, advisor, and history views, but draft creation and completion transitions are driven through the shared context and SSE stream.

## Component Hierarchy

```
<App>                          ← holds view shell
  <HttpDraftContextProvider>   ← owns POST/queue/pick calls, SSE, toast state
  <ConfigScreen />             ← view: config
  <DraftView>                  ← view: drafting
    <DraftBoard />             ← grid: rounds × teams
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
  config: LeagueConfig | null;
  picks: Pick[];           // all picks made so far
  teams: Team[];           // all teams with current rosters
  availablePlayers: Player[];
  currentPickNumber: number;
  isUserTurn: boolean;
  pendingTrade: TradeOffer | null;
  sseStatus: 'connecting' | 'connected' | 'disconnected';
  advisorOpen: boolean;
  advisorMode: 'advise' | 'grill';
  advisorMessages: Message[];
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
| `ADVISOR_OPEN` | User clicks advisor button |
| `ADVISOR_MESSAGE` | Advisor API response |
| `ADVISOR_RESET` | User commits pick |

## Draft Board Grid

Rounds are columns; teams are rows. The grid is fixed at draft creation (`round_count × team_count` cells). Cells fill in as `pick_made` events arrive.

**Cell states:**
- Empty (future pick): faint border, no content
- Bot pick: player name, position badge, team name, positional color
- User pick: same as bot pick, highlighted border
- Current pick (bot in progress): pulsing skeleton

The grid scrolls horizontally for rounds beyond the viewport. The user's row is pinned visually (distinct background) so it stays scannable across all rounds.

Pick position in a round is derived from the snake order: odd rounds left-to-right, even rounds right-to-left. The header row shows round numbers; the left column shows team names.

## Available Players List

Rendered alongside the draft board during the user's turn. Hidden during bot turns (replaced by a "Bot is picking…" state).

**Features:**
- Sorted by `dynasty_value` descending by default
- Position filter: ALL / QB / RB / WR / TE / Picks (pill buttons)
- Name search: free-text input, filters the list client-side
- Each row: player name, position badge, NFL team, age, dynasty value
- Clicking a player row submits `POST /drafts/:id/pick` and dispatches `ADVISOR_RESET`

The full available player list is loaded once from `GET /drafts/:id/state` at draft start. As `pick_made` events arrive, the reducer removes picked players from `availablePlayers` client-side — no re-fetch needed.

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

Rendered after `draft_complete`. Reachable by navigating back from the config screen via `GET /drafts` (list) → select a draft.

Three tabs toggled by pill buttons at the top:

**Pick Log tab:**
- Chronological list of all picks: round, pick number, team name, player name, position, dynasty value at draft time

**Roster View tab:**
- One card per team, positions grouped (QB, RB, WR, TE)
- Each player row: name, round drafted, dynasty value
- User's team card is highlighted

**Trade Log tab:**
- Chronological list of trades: round, initiating team, receiving team, assets sent, assets received, outcome (accepted / declined / force_declined)

## SSE Integration: `useDraftStream`

A custom hook that owns the SSE lifecycle and dispatches into the `DraftContext` reducer.

```ts
function useDraftStream(draftId: string | null, dispatch: Dispatch<DraftAction>): void
```

**Behavior:**
- Opens `EventSource` to `GET /drafts/:id/stream` when `draftId` is set
- On each SSE message: parses event type and payload, dispatches the corresponding action, and marks the stream `connected` on the first successfully parsed event
- On `error`: dispatches `SSE_STATUS: 'disconnected'`, schedules reconnect with exponential backoff (1s, 2s, 4s, 8s, 16s, cap 30s)
- On `draft_complete`: closes the `EventSource` cleanly
- Cleanup: closes `EventSource` on unmount or `draftId` change

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
