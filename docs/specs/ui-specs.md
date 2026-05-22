# EARS Specs: UI

Drives: `docs/llds/ui.md`

Status markers: `[x]` implemented · `[ ]` gap · `[D]` deferred

---

## View State / Navigation

**DFF-UI-001** `[x]` → #13
When the application loads and no draft is active, the system shall render the Config screen.

**DFF-UI-002** `[x]` → #15
When a draft is successfully created via POST /drafts, the system shall transition to the Drafting view.

**DFF-UI-003** `[x]` → #54
When a `draft_complete` SSE event is received, the system shall transition to the History view.

**DFF-UI-004** `[x]` → #13
When the user clicks "New Draft" from the History view, the system shall transition to the Config screen.

---

## Config Screen

**DFF-UI-010** `[x]` → #15
The Config screen shall render input fields for: config name, team count (8–16), rounds (10–30), scoring format (PPR / Half PPR / Standard), roster slots per position (QB, RB, WR, TE, FLEX, SF, BN), pick position (1–team_count), and future pick years (1–5).

**DFF-UI-011** `[ ]` → #16
When the Config screen loads, the system shall fetch saved configs from GET /configs and display them in a dropdown.

**DFF-UI-012** `[ ]` → #16
When the user selects a saved config from the dropdown, the system shall populate all form fields with that config's values.

**DFF-UI-013** `[ ]` → #16
When the user clicks "Save", the system shall POST /configs with the current form values and add the saved config to the dropdown.

**DFF-UI-014** `[x]` → #15
When the user clicks "Start Draft", the system shall POST /drafts with the current form values and, on success, transition to the Drafting view.

**DFF-UI-015** `[x]` → #15
If POST /drafts returns an error, the system shall display an error toast and remain on the Config screen.

---

## Draft Board

**DFF-UI-020** `[x]` → #17
The Draft Board shall render a grid of `round_count` columns by `team_count` rows, with round numbers in the header row and team names in the left column.

**DFF-UI-021** `[x]` → #17
The Draft Board shall display picks in snake order: odd rounds fill left-to-right; even rounds fill right-to-left.

**DFF-UI-022** `[x]` → #17
Each filled cell shall display the player name, a position badge, and the drafting team name.

**DFF-UI-023** `[x]` → #17
The user's team row shall be visually distinguished from bot rows with a distinct background.

**DFF-UI-024** `[x]` → #17
While a bot pick is in progress, the current pick slot shall display a pulsing skeleton animation.

**DFF-UI-024b** `[x]` → #17
When `currentPickNumber` corresponds to the user's own team slot, the current pick slot shall not display a skeleton animation; it shall display the same waiting state as other unfilled future slots.

**DFF-UI-025** `[x]` → #17
When a `pick_made` SSE event is received, the corresponding grid cell shall update immediately without requiring a re-fetch.

**DFF-UI-026** `[x]` → #17
The Draft Board shall scroll horizontally to accommodate rounds beyond the initial viewport.

---

## Available Players List

**DFF-UI-030** `[ ]` → #18
The Available Players list shall render all players not yet picked, sorted by `dynasty_value` descending.

**DFF-UI-031** `[ ]` → #18
The Available Players list shall include position filter buttons: ALL, QB, RB, WR, TE, and Picks. Selecting a filter shall immediately narrow the displayed list.

**DFF-UI-032** `[ ]` → #18
The Available Players list shall include a name search input. Entering text shall filter the list client-side on player name, case-insensitively.

**DFF-UI-033** `[ ]` → #18
Each player row shall display: player name, position badge, NFL team, age, and dynasty value.

**DFF-UI-034** `[ ]` → #18
When a `pick_made` SSE event is received, the picked player shall be removed from the Available Players list client-side.

**DFF-UI-035** `[ ]` → #18
When it is not the user's turn, the Available Players list shall display a "Bot is picking…" state and player rows shall not be interactive.

**DFF-UI-036** `[ ]` → #18
When the user clicks a player row during their turn, the system shall POST /drafts/:id/pick with that player's id and dispatch ADVISOR_RESET.

---

## Advisor Panel

**DFF-UI-040** `[ ]` → #20
The Advisor panel shall be toggled open and closed by an "Advisor" button in the draft header.

**DFF-UI-041** `[ ]` → #20
The Advisor panel shall slide in from the right at approximately 380px width and shall not block interaction with the Draft Board beneath it.

**DFF-UI-042** `[ ]` → #20
The Advisor panel shall contain two tabs: "Advise Me" and "Grill Me". The user may switch between them at any time.

**DFF-UI-043** `[ ]` → #20
When the user clicks "Advise Me", the system shall POST /drafts/:id/advisor/advise and display an inline loading spinner while waiting for a response.

**DFF-UI-044** `[ ]` → #20
When an "Advise Me" response is received, the system shall render the structured recommendation with three sections: Recommendation, Key Factors, and Caveats.

**DFF-UI-045** `[ ]` → #20
When a `YOUR_TURN` action is dispatched, any stale "Advise Me" recommendation shall be cleared.

**DFF-UI-046** `[ ]` → #20
The "Grill Me" tab shall render a scrollable message history and a text input fixed at the bottom of the panel.

**DFF-UI-047** `[ ]` → #20
When the user submits a message in the "Grill Me" tab, the system shall POST /drafts/:id/advisor/chat and display a typing indicator (animated dots) while waiting for a response.

**DFF-UI-048** `[ ]` → #20
When the user commits a pick (ADVISOR_RESET dispatched), the system shall DELETE /drafts/:id/advisor/chat and clear the "Grill Me" message history.

---

## Trade Modal

**DFF-UI-050** `[ ]` → #19
When a `trade_offered` SSE event is received, the system shall open a blocking modal that prevents interaction with the Draft Board until the user responds.

**DFF-UI-051** `[ ]` → #19
For user-targeted trades (`is_bot_to_bot: false`), the trade modal shall display assets offered and assets requested, with "Accept" and "Decline" buttons.

**DFF-UI-052** `[ ]` → #19
For bot-to-bot trades (`is_bot_to_bot: true`), the trade modal shall display the trade details with "OK" (acknowledge; trade stands) and "Force Decline" (user vetoes) buttons.

**DFF-UI-053** `[ ]` → #19
When the user responds to the trade modal, the system shall POST /drafts/:id/trade-response with the appropriate status and close the modal.

---

## Draft History View

**DFF-UI-060** `[x]` → #21
The History view shall display three tabs toggled by pill buttons: Pick Log, Roster View, and Trade Log.

**DFF-UI-061** `[x]` → #21
The Pick Log tab shall list all picks in chronological order, showing: round, pick number, team name, player name, position badge, and dynasty value at draft time.

**DFF-UI-062** `[x]` → #21
The Roster View tab shall render one card per team with players grouped by position (QB, RB, WR, TE), showing each player's name, round drafted, and dynasty value.

**DFF-UI-063** `[x]` → #21
The user's team card in the Roster View shall be visually highlighted.

**DFF-UI-064** `[x]` → #21
The Trade Log tab shall list all trades in chronological order, showing: round, initiating team, receiving team, assets exchanged, and outcome (accepted / declined / force_declined). `player` type assets shall display the player's name resolved from the catalog (not the raw ID), consistent with the Pick Log column.

**DFF-UI-065** `[x]` → #21
The History view shall include a "New Draft" button that transitions the app to the Config screen.

---

## SSE Integration

**DFF-UI-070** `[x]` → #54
The `useDraftStream` hook shall open an `EventSource` to GET /drafts/:id/stream when `draftId` is set, and close it when `draftId` is cleared or the component unmounts.

**DFF-UI-071** `[x]` → #54
The hook shall dispatch `SSE_STATUS: 'connecting'` when opening the connection and `SSE_STATUS: 'connected'` on the first message received.

**DFF-UI-072** `[x]` → #54
On SSE error, the hook shall dispatch `SSE_STATUS: 'disconnected'` and attempt to reconnect with exponential backoff: 1s, 2s, 4s, 8s, 16s, then 30s; if the 30s attempt also fails, reconnect is exhausted.

**DFF-UI-073** `[x]` → #54
On `draft_complete` event, the hook shall close the `EventSource` cleanly and dispatch `DRAFT_COMPLETE`.

**DFF-UI-074** `[x]` → #54
For each SSE event type (`pick_made`, `your_turn`, `trade_offered`, `trade_resolved`, `draft_complete`), the hook shall parse the payload and dispatch the corresponding reducer action.

---

## Error and Loading States

**DFF-UI-080** `[ ]` → #18
While GET /drafts/:id/state is in flight at draft start, the Available Players list shall render skeleton rows in place of player data.

**DFF-UI-081** `[ ]` → #20
While an advisor response is pending, the Advisor panel shall render an inline spinner; the rest of the UI shall remain interactive.

**DFF-UI-082** `[x]` → #54
The draft header shall display an SSE connection status badge showing "Connecting…" while `sseStatus` is `connecting`.

**DFF-UI-083** `[x]` → #54
If SSE reconnect attempts are exhausted (backoff cap reached with no reconnect), the system shall display an error toast: "Lost connection to draft server. Refresh to reconnect."

**DFF-UI-084** `[ ]` → #18
If POST /drafts/:id/pick returns an error, the system shall display a toast: "Pick failed — player may already be taken."

**DFF-UI-085** `[ ]` → #20
If an advisor API call returns an error, the system shall display a toast: "Advisor unavailable. Try again."

**DFF-UI-086** `[x]` → #15
Only one toast shall be visible at a time; a new error toast shall replace the currently displayed toast.

**DFF-UI-087** `[x]` → #15
Toasts shall auto-dismiss after 6 seconds unless replaced by a new error.

---

## Draft Board Layout Toggle

**DFF-UI-088** `[x]` → #78
The Draft Board header shall render an icon-only toggle button that switches the board between row mode (teams as rows, rounds as columns) and column mode (rounds as rows, teams as columns).

**DFF-UI-089** `[x]` → #78
The layout toggle shall default to row mode on first load. The user's selected mode shall be persisted to localStorage and restored on subsequent loads.

**DFF-UI-090** `[x]` → #78
In column mode the Draft Board shall render `round_count` rows and `team_count` columns, with team names in the header row and round numbers in the left column.

**DFF-UI-091** `[x]` → #78
In column mode the team name header row shall remain sticky at the top of the scroll container during vertical scroll.

**DFF-UI-093** `[x]` → #78
In column mode the user's team column header shall be visually distinguished with an amber tint.

---

## Position Badge Color Coding

**DFF-UI-092** `[x]` → #78
Every position badge on the Draft Board shall be color-coded by position: QB=amber, RB=blue, WR=emerald, TE=purple, PICK/RDP=yellow, all other values=stone.

---

## Pick Feed Panel

**DFF-UI-100** `[x]` → #82
The Pick Feed panel shall be rendered alongside the Draft Board during the drafting view. It shall have a fixed maximum height and scroll independently of the Draft Board.

**DFF-UI-101** `[x]` → #82
On initial load, the Pick Feed panel shall hydrate from the picks already present in `draftState.picks`, sorted in reverse-chronological order (most recent pick at the top).

**DFF-UI-102** `[x]` → #82
When a `pick_made` SSE event is processed by the reducer, the newly added pick shall appear as an entry prepended to the top of the Pick Feed panel in real time, without a page reload or re-fetch.

**DFF-UI-103** `[x]` → #82
Each Pick Feed entry shall display: player name, a color-coded position badge, the drafting team name, the round number, and the pick-in-round formatted as `"Rd N, Pick M"`.

**DFF-UI-104** `[x]` → #82
When `draftState.picks` is empty, the Pick Feed panel shall render an empty-state message saying "No picks yet" without crashing.
