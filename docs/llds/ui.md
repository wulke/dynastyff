# LLD: UI

## Context

The UI is a local-first React single-page application that runs in the browser pointed at `localhost`. It is the sole interaction surface for the user: configuring a draft, running it, querying the advisor, and reviewing history. It connects to the Express backend via HTTP and SSE. There is no auth, no routing library, and no mobile layout — this is a desktop-only tool for one user.

Drives specs: `docs/specs/ui-specs.md`, `docs/specs/ui-unification-specs.md`

## Responsibilities

- Render the Drafts List page as the app entry point when persisted drafts exist
- Render the League Config screen and persist saved configs to SQLite via the backend
- Render the Draft Board grid and keep it in sync with SSE events
- Render the Available Players list and Targets panel with shared pick-selection behavior
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
drafts-list → config → drafting → grade-summary → history
   │            │           │             ▲             ▲
   │            │           │             │             │
   │            │           └── (completion banner) ────┘
   │            │
   └────────────┘
```

Startup:
- On app load, fetch `GET /drafts`. If drafts exist → `drafts-list`. If none exist or the fetch fails → `config`.

Transitions:
- `drafts-list → config`: user clicks "New Draft"
- `drafts-list → drafting`: user clicks "Resume" on an in-progress draft; loads draft state and connects SSE
- `drafts-list → grade-summary`: user clicks "Review" on a completed draft; loads draft state directly to the grade summary view
- `drafts-list → history`: user clicks "Review" on an in-progress draft; loads draft state directly to history view
- `config → drafting`: user submits config and a draft is created (`POST /drafts`)
- `drafting (board) → drafting (completed banner)`: `draft_complete` SSE event received
- `drafting (completed banner) → grade-summary`: user clicks `View Draft Grade`
- `grade-summary → history`: user clicks `View Full History`
- `history → config`: user clicks "New Draft"

## App Scaffold

Issue `#13` establishes the initial frontend shell under `/src/ui`, issue `#15` replaces the placeholder config shell with the first real user workflow, and issue `#54` introduces the shared draft context and HTTP-backed SSE lifecycle:

- `index.html` mounts the React app through Vite
- `main.tsx` hydrates a single `<App />` entry point
- `App.tsx` exports two entry points: `DraftApp`, the shared app shell, and `App`, the HTTP entry point that wraps `DraftApp` with `HttpDraftContextProvider`
- `DraftApp` owns the top-level view shell so both the HTTP build and the static build can reuse the same config, drafting, grade-summary, and history views
- Tailwind CSS provides the shell styling and layout primitives
- A Radix UI primitive is wired into the shared shell so the initial scaffold proves the dependency path works before later feature slices add dialogs, tabs, and other interactive primitives

At this stage, the config view is functional, the drafting view now renders the live draft board, and the history view remains a light shell:

- Drafts list: fetched from `GET /drafts` on mount; shows all persisted drafts with Resume/Review CTAs
- Config screen: league settings form + `Start Draft` calls `startDraft()` on the active draft context; when `DraftContextValue.snapshot` is non-null, the form header also shows snapshot player count, pick-values count, and export date
- Draft board: renders immediately after draft creation, keeps the live SSE status badge, and hydrates the grid in place from `state_sync` / `pick_made` events
- Draft completion banner: renders over the Draft Board when `draft_complete` arrives, keeps the board visible behind the overlay, and exposes `View Draft Grade`
- Grade summary shell: becomes visible after the user opens a completed draft from the completion banner or Drafts List review flow, then exposes `View Full History` and `New Draft`
- History shell: becomes visible after the user clicks `View Full History`, then exposes `New Draft`

## Component Hierarchy

```
<App>                              ← HTTP entry point
  <HttpDraftContextProvider>       ← owns POST/queue/pick calls, SSE, toast state
    <DraftApp />                   ← shared shell used by HTTP + static builds
      <DraftsListPage />           ← view: drafts-list
      <ConfigScreen />             ← view: config
      <DraftView>                  ← view: drafting
        <DraftBoard />             ← grid: rounds × teams
        <DraftCompletionBanner />  ← modal-style overlay on completed drafts
        <PickFeedPanel />          ← real-time pick feed
        <AvailablePlayersPanel />  ← available players + targets queue
        <AdvisorPanel />           ← slide-out, advise-me + grill-me
        <TradeModal />             ← blocking modal on trade_offered SSE
      </DraftView>
      <DraftGradeSummaryView>      ← view: grade-summary
      <HistoryView>                ← view: history
        <PickLog />                ← toggle tab
        <RosterView />             ← toggle tab
        <TradeLog />               ← toggle tab
      </HistoryView>
      <Toast />                    ← global error surface
```

The static build does not render `App`. `src/ui-static/App.tsx` loads the snapshot, wraps `DraftApp` with `InMemoryDraftContextProvider`, and reuses the same view-state machine and draft-room shell without the HTTP transport layer.

## State Model

A single `DraftContext` (React Context + useReducer) holds all draft state. `HttpDraftContext` is the server-backed implementation used by the main app. SSE events are the only write path into the reducer during a live draft after the initial draft-creation POST succeeds.

**State shape:**

```ts
type DraftState = {
  draftId: string | null;
  status: 'idle' | 'in_progress' | 'completed';
  isHydrating: boolean;
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
| `QUEUE_SYNC` | `hydrateDraftQueue` HTTP response |
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
- "Review" button on all drafts: calls `loadDraft(draftId)` on the context, then navigates to grade summary view for completed drafts or history view for in-progress drafts
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
- Traded startup slot: the cell stays anchored to its original snake-order coordinates, while a compact owner banner shows which team currently controls that pick when the current owner differs from the original slot owner

**Position badge colors:** QB=amber, RB=blue, WR=emerald, TE=purple, PICK/RDP=yellow, default=stone.

Pick position in a round is derived from the snake order: odd rounds left-to-right, even rounds right-to-left. Startup pick-slot trades must not change that placement model. The UI treats `draftOrder.teamId` as mutable ownership, but derives cell placement from the immutable `(round, pickInRound)` snake coordinates plus the original team ordering captured at draft creation.

**Edge Case Probe:**
- `pick_made` arrives before the first `state_sync` (empty catalog) -> `getDraftedPlayerSummary` falls back to the raw `playerId` as the name and `NA` as the position badge so the cell degrades without crashing
- Player exists in `picks` but is absent from all `available_players` payloads -> the same fallback path keeps the cell visible instead of hiding the pick
- Reconnect `state_sync` omits already drafted players from `available_players` -> `playerCatalog` is merged rather than replaced so prior drafted-player metadata still renders
- Team has no pick in a given round (for example after a pick-slot trade) -> the board renders an empty `<td>` for that team/round intersection without throwing
- An accepted trade swaps unresolved startup pick ownership before either slot is used -> the reducer updates `draftOrder` ownership immediately and the board reflects the new owner without waiting for a re-fetch

## Draft Completion Banner

A blocking banner rendered only after the draft reaches `status: 'completed'`. It overlays the Draft Board container instead of navigating away immediately, so the final board remains visible in the background.

**Features:**
- Triggered by the `draft_complete` SSE event after the reducer marks the draft completed
- Displays a congratulatory heading, the user's team name, and a single `View Draft Grade` CTA
- Keeps the Draft Board grid visible but non-interactive beneath a translucent overlay
- Does not expose a dismiss or close affordance; the only in-flow exit is `View Draft Grade`
- Leaves the existing history data in `draftState`, so clicking the CTA swaps the view shell to the already-hydrated grade summary view

**Edge Case Probe:**
- User team lookup fails (unexpected malformed state) -> banner falls back to `Your team`
- `draft_complete` arrives before the first `state_sync` -> banner still renders from reducer state, even if the board has sparse metadata
- Completed draft state is rehydrated after a reconnect or future refresh-restore path -> the completion banner renders again, because `View Draft Grade` is client-local UI state and is not persisted

## Draft Grade Summary View

Rendered after the user clicks `View Draft Grade` from the draft completion banner or opens a completed draft from the Drafts List `Review` flow. Uses the same `draftState` payload already hydrated via SSE or `GET /drafts/:id/state`.

**Features:**
- Prominent overall grade callout for the user's team, showing both the numeric score and the letter grade from the grade-summary rubric
- Dimension breakdown for value over expected ADP, positional balance, and roster construction, using the deterministic summaries from `calculateDraftGradeSummaries`
- Final user roster grouped by position and shown alongside the grade breakdown
- Secondary `View Full History` CTA for the existing history tabs, plus `New Draft`
- Team leaderboard cards so the user can compare their result against the rest of the room without leaving the page

**Trade Activity section:**
- Rendered below the rubric breakdown / final roster grid, only when the user participated in at least one accepted trade
- Each row: round, initiating team name → receiving team name, sent assets with values, received assets with values, net delta
- `pick_slot` dynasty values are resolved to the dynasty value of the player ultimately drafted with that pick via the `picks` log and `playerCatalog`; a pick never used by draft end yields 0
- Net delta is color-coded with the same `text-positive` / `text-negative` / `text-muted` tokens used by the trade composer balance row
- Only trades involving the user's team are shown

**Edge Case Probe:**
- Draft is not completed -> grade summary view is unavailable; in-progress drafts still open into the History view from Drafts List review
- Grade-summary rubric returns `null` because roster config is missing -> the view renders an unavailable-state message instead of crashing
- User team cannot be identified -> fall back to the first graded team while still rendering the leaderboard
- User roster contains no players for a position -> that position renders an em dash rather than collapsing the section
- User made zero accepted trades -> Trade Activity section is not rendered; no empty-state row is shown

## Pick Feed Panel

A scrolling real-time draft log panel rendered alongside the draft board, driven by `pick_made` and `trade_resolved` events processed through the `DraftContext` reducer. Every pick or resolved trade appears as a new entry at the top of the log as it happens.

**Features:**
- Hydrates from `draftState.picks` on initial load, sorted by `pickNumber` descending so the most recent pick appears at the top
- Hydrates persisted trades from `draftState.trades` on initial load so review/resume flows preserve the same trade history shown during the live draft
- On draft resume or reconnect, the client catalog must be rehydrated with metadata for already drafted players as well as remaining available players so historical feed entries still resolve to player names
- Each new `pick_made` event adds the pick to `draftState.picks` via the reducer; the feed re-renders with the new entry at the top
- Each accepted / declined / force-declined `trade_resolved` event appends a trade record with its creation timestamp; the log renders a concise summary naming the initiating team, receiving team, and exchanged assets
- Each entry renders as a dense single-line string in the form `Round.Pick - Player Name` (for example, `1.1 - Bijan Robinson`)
- Trade entries render a timestamp plus a concise sentence (for example, `2026-05-22 18:05 — Team A traded Startup 1.05 to Team B for Startup 2.03`)
- Compact list styling is preferred over card treatment: minimal padding, minimal decoration, and a simple vertical scroll region
- Within the three-column drafting layout, the panel must stretch to the full height of the Pick Feed column; the old fixed `max-h-[28rem]` workaround is removed and scrolling is handled by an inner full-height overflow region
- Shows an empty-state message ("No picks yet") when `draftState.picks` is empty
- Foundation for the Pick Log tab in the History View (#21), but with a more compressed presentation tailored to live draft review

**Edge Case Probe:**
- Player ID is absent from `playerCatalog` → entry displays the raw `playerId` as the name
- Draft has zero picks → panel shows empty state without crashing
- Same player is picked twice (impossible in valid state but handles gracefully) → duplicate entries render, since each `pick_made` produces a unique pick record
- Pick number is absent from `draftOrder` (should not happen in practice but handle defensively) → entry renders an em dash (`—`) in place of the `Round.Pick` prefix instead of showing incorrect coordinates
- A persisted `GET /drafts/:id/state` payload includes trades but no live SSE replay occurs afterward → the log still renders those trade entries from the hydrated state

## 3-Column Drafting Layout And Status Bar

The drafting room is scaffolded as a three-column workspace at `xl` breakpoints and above. The board remains the primary surface on the left, with Available Players in the center and Pick Feed on the right.

**Layout:**
- At `1280px+`, render the drafting view as three columns in a single row: Draft Board, Available Players, Pick Feed
- Use weighted track widths of `2fr / 1.5fr / 1fr`
- Below `xl`, stack the drafting surfaces vertically in their existing mobile-friendly order
- Each column header includes an expand control that targets its own panel
- The default page-load state keeps all three panels visible at their weighted widths
- Expand/collapse state remains component-local UI state and is never persisted to `localStorage`
- When a column is expanded, it becomes the single wide panel and the other two columns collapse into narrow vertical strips
- Each collapsed strip renders a panel icon plus a rotated panel label so the destination remains identifiable
- Clicking a collapsed strip expands that panel and collapses whichever panel was previously expanded
- Clicking the expand control for a panel that is already expanded is an intentional no-op; the room does not offer an in-place control to return to the default weighted layout
- Only one panel may be expanded at a time
- Width changes animate with an approximately `200ms` transition on the drafting layout container

**Status bar:**
- Render a persistent status bar above the columns while the draft is open
- Display the current pick as `Pick N of Total`
- Display turn ownership as `Your turn` when the current slot belongs to the user, otherwise show the current bot team name
- Treat the status bar as the only turn-status surface in the drafting room; remove the old header badges from Draft Board and Available Players

**Edge Case Probe:**
- `currentPickNumber` is `null` after the draft ends -> status bar falls back to the completed pick count and `Draft complete`
- Current draft slot is missing from `draftOrder` -> status bar still renders the pick progress and falls back to `Draft room active`
- Current team lookup fails for a non-user slot -> status bar falls back to `Draft room active` instead of rendering an empty label
- User refreshes while a panel is expanded -> the layout resets to the default weighted three-column arrangement
- User expands one panel and then clicks a collapsed strip -> the newly clicked strip becomes the only expanded panel
- User clicks the expand control for the panel that is already expanded -> the expanded state remains unchanged

## Available Players And Targets Panels

Rendered within the center drafting column alongside the draft board. During bot turns, both panel views stay accessible and disable player rows while the shared drafting status bar communicates whose turn it is.

**Available Players features:**
- Sorted by `dynasty_value` descending by default
- Position filter: a single compact control with options for ALL / QB / RB / WR / TE / Picks
- Name search: free-text input, filters the list client-side
- Each row: player name, position badge, NFL team, age, dynasty value
- Overall presentation should favor density and legibility over large card padding or decorative framing

**Targets panel features:**
- Accessible from a `Targets` tab within the Available Players column while the draft room is open
- Hydrates from `GET /drafts/:id/queue` after `GET /drafts/:id/state` succeeds at draft start or resume
- Displays queued players in ascending `rank` order
- Each row shows player name, position badge, and dynasty value
- Shows an empty state message: `No targets added yet`
- Presentation should stay visually minimal so the queue reads as a compact review surface rather than a second feature card

**Tabbed container behavior:**
- Render `Available` and `Targets` tab buttons at the top of the Available Players card
- Default to the `Available` tab after hydration so the position filter, search input, and player list remain the primary view
- Highlight the active tab with the amber accent treatment used elsewhere in the draft room
- Render only one tab body at a time; remove the previous inner `xl:grid` split and `minmax(...)` side-by-side queue layout

**Shared selection flow:**
- Clicking an enabled row in either panel selects that player instead of submitting immediately
- The selected row expands inline to reveal `Draft [Name]` and `Cancel` actions directly beneath the player metadata
- Clicking `Draft [Name]` in the expanded row submits `POST /drafts/:id/pick` and dispatches `ADVISOR_RESET`
- Clicking `Cancel`, selecting the same row again, or choosing a different row updates the same shared selection state no matter which panel the row came from
- If `POST /drafts/:id/pick` fails, a global toast surfaces `Pick failed — player may already be taken.`

The full available player list is loaded from `GET /drafts/:id/state` at draft start or resume. Queue ranks are hydrated from `GET /drafts/:id/queue` immediately after state hydration succeeds, using `availablePlayers` / `playerCatalog` to resolve target display metadata client-side. As `pick_made` events arrive, the reducer removes picked players from both `availablePlayers` and `userQueue` client-side — no re-fetch needed.

**Edge Case Probe:**
- `GET /drafts/:id/state` fails after `POST /drafts` succeeds -> show the global draft-load error toast and dispatch `NEW_DRAFT` so the user returns to the config screen instead of remaining stuck in skeleton state
- `GET /drafts/:id/queue` fails after draft state hydration succeeds -> keep the draft room open, surface a queue-load toast, and leave the Targets panel empty instead of blocking the rest of the room
- `pick_made` arrives before the HTTP hydration finishes -> reducer removes nothing from the empty initial list, then the follow-up hydrated state replaces `availablePlayers` with the server-truth snapshot without crashing
- A queued player is absent from the hydrated `availablePlayers` list (for example stale queue state) -> omit that target row rather than rendering broken metadata

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

Issue `#16` scope:
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

## Trade Modal

Rendered in the drafting view whenever `draftState.pendingTrade` is non-null or the user opens a local propose flow from the draft board. The modal is a blocking Radix Dialog controlled by a combination of reducer-fed SSE trade state and local compose state.

**Behavior:**
- Entry points:
  - `TRADE_OFFERED` sets `draftState.pendingTrade`, which opens the dialog immediately for incoming bot-originated offers
  - Clicking a non-user team column header on the draft board opens the dialog in propose mode targeting that team
- Blocking scope: the overlay covers the full drafting workspace (status bar + all three columns) and disables pointer interaction beneath it until the user responds
- Copy: the modal identifies the initiating team, receiving team, and renders both `assetsSent` and `assetsReceived` in separate sections so the user can inspect the full trade
- Team selection: propose mode renders a target-team dropdown seeded from the clicked board column; changing the dropdown swaps the opposing roster/pick inventory without closing the dialog
- Propose mode:
  - Split the asset builder into "You offer" and "<Target> offers"
  - Each side shows player rows plus a flat picks section
  - The picks section merges two distinct inventories for that team:
    - unresolved startup pick slots derived from `draftState.draftOrder`
    - true future picks derived from `draftState.teamPickAssets`
  - Startup pick slots remain `pick_slot` trade assets and future picks remain `future_pick` trade assets; the compose UI shall not coerce startup slots into future-pick labels
  - Player rows support pill filters `ALL`, `QB`, `RB`, `WR`, `TE`
  - Picks remain visible regardless of the active position pill
  - Before submit, propose mode includes a local dismiss action that closes the composer without sending a trade request
  - Submit calls `POST /drafts/:id/trade-offer` with `{ targetTeamId, offeredAssets, requestedAssets }`
  - After submit, the modal stays open in an awaiting-bot-response state until the corresponding `trade_resolved` SSE arrives
- User-targeted incoming trade (`isBotToBot: false` and initiating team is a bot): render `Accept`, `Decline`, and `Counter`
- Counter action: transition into propose mode targeting the same bot with the original offer reversed, so the user edits from the mirrored starting point instead of rebuilding from scratch
- Bot-to-bot trade (`isBotToBot: true`): render `OK` and `Force Decline`
- User-initiated pending trade (`isBotToBot: false` and initiating team is the user): render a waiting state, not response buttons
- Response mapping:
  - `Accept` -> `accepted`
  - `Decline` -> `declined`
  - `OK` -> `accepted`
  - `Force Decline` -> `force_declined`
- Submission: each action calls `POST /drafts/:id/trade-response` with `{ status }`
- Close behavior: the dialog remains open until the response POST succeeds or a `trade_resolved` SSE event clears `draftState.pendingTrade`
- Failure handling: if the response POST fails, keep the dialog open and surface a toast so the user can retry without losing context

**Trade asset presentation:**
- `player` assets resolve against `playerCatalog` and show player name plus position badge when metadata exists
- `pick_slot` assets render with a distinct `STARTUP` badge plus the label `Startup R.PP`, where `PP` is zero-padded from `draftOrder.pickInRound`; the UI derives the inline dynasty value from `startupPickValues` when the payload omits it; during an in-progress draft, the derived in-draft value overrides the ETL value (see "In-Draft Derived Pick Value" below)
- `future_pick` assets render with a `PICK` badge plus the label `<year> Round <round>`
- Trade history reuses the same startup-pick label contract so modal and post-draft trade views stay visually aligned
- Unknown or malformed assets degrade to a compact raw-label fallback instead of crashing the dialog

**Balance summary row:**
- Rendered below both asset panels in the trade composer and below both asset lists in the incoming bot offer modal
- Shows three values: user's total sent dynasty value, user's total received dynasty value, and net delta (received − sent)
- Net delta color: `text-positive` when positive, `text-negative` when negative, `text-muted` when zero
- Pick slot values use in-draft derived values when the draft is in progress; ETL `startupPickValues` otherwise
- Implemented as a shared presentational component driven by two `asset[]` arrays and `DraftState`

**Edge Case Probe:**
- A second `trade_offered` arrives before the first trade resolves -> the reducer replaces `pendingTrade` with the latest server truth, and the dialog re-renders from that payload
- The user switches the target team after selecting offer assets -> the compose state resets the opposing-team selections so stale requested assets from the previous bot cannot leak into the next proposal
- The user filters to a position with zero matching players -> the player list shows an empty-state message while the picks section remains visible
- The user opens propose mode but decides not to make an offer -> the local dismiss action closes the composer immediately without mutating draft state or posting a trade request
- A team has no unresolved startup pick slots because all remaining `draftOrder` entries for that team are already resolved -> the picks section omits startup slots and continues rendering any future picks without showing a false empty state
- `draftState.teamPickAssets` is empty or missing entries for the selected team -> the picks section continues rendering unresolved startup pick slots without crashing
- A `draftOrder` slot belongs to the selected team but its pick has already been made -> exclude that `pick_slot` from the compose inventory because only unresolved startup slots are tradeable
- A user-initiated offer is submitted while the modal is already showing a pending user-offer SSE payload -> the submit control stays disabled until the server resolves the current pending proposal
- The user refreshes or resumes a draft while a trade is pending -> `GET /drafts/:id/state` preserves `pendingTrade` so the dialog reopens on hydration
- `POST /drafts/:id/trade-response` returns `409` because the trade already resolved elsewhere in the bot chain -> keep the modal open until the corresponding `trade_resolved` SSE arrives, avoiding premature local closure
- Team or player metadata is missing from local state -> the dialog falls back to raw ids so the trade remains reviewable
- User presses Escape or clicks outside the dialog -> those dismiss paths are disabled because trade acknowledgment is mandatory before the draft continues

## In-Draft Derived Pick Value

A pure client-side utility that computes real-time dynasty values for unfilled startup pick slots based on the current available player pool.

**Formula:** for an unfilled slot at global pick number G:
```
derivedValue = availablePlayers[G - currentPickNumber - 1]?.dynastyValue ?? 0
```
`availablePlayers` is sorted by `dynastyValue` descending. The rank `G - currentPickNumber - 1` estimates which player will still be available when pick G is made by counting how many players will be taken between now and then.

**Implementation:** a single exported function `computeDerivedPickValues(state: DraftState): Map<number, number>` in `draftUtils.ts` that accepts `DraftState` and returns a `Map<globalPickNumber, derivedDynastyValue>` for all unfilled slots. It is computed on demand (when the trade composer opens or a bot trade offer arrives) and is not stored in reducer state.

Issue `#131` scope: implement and export the pure utility first. UI consumers and bot-evaluation integration can land separately while reusing the same function contract.

**Usage:**
- Trade composer and incoming offer modal: call `computeDerivedPickValues` and pass the result alongside `startupPickValues`; the derived value supersedes the ETL value for any key present in both maps during an in-progress draft
- Bot trade evaluation: `min(ETL startupPickValue, derivedValue)` per DFF-SPKV-052

**Edge Case Probe:**
- `G - currentPickNumber - 1 < 0` (slot is at or before the current pick): should not occur for unfilled slots, but clamp rank to 0 defensively
- `availablePlayers` is empty (all players taken): yields 0 for all remaining slots
- Draft is not in progress (`status !== 'in_progress'`): callers fall back to ETL `startupPickValues`

## Draft History View

Rendered after the user clicks `View Full History` from the grade summary view or opens an in-progress draft from the Drafts List review flow. Uses the `draftState` data accumulated during the draft via SSE events (picks, trades, rosters).

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
