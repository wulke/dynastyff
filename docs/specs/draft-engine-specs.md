# EARS Specs: Draft Engine

Drives: `docs/llds/draft-engine.md`

Status markers: `[x]` implemented · `[ ]` gap · `[D]` deferred

---

## Draft Creation

**DFF-ENGINE-001** `[x]`
When a POST /drafts request is received with valid configuration, the system shall create a draft, generate teams, generate the full snake pick order, initialize team pick assets, and return the draft id.

**DFF-ENGINE-002** `[x]`
When a draft is created, the system shall set `drafts.status` to `in_progress`.

**DFF-ENGINE-003** `[x]` → #25
If a POST /drafts request is received with missing or invalid configuration fields, the system shall return a 400 error with a descriptive message and shall not create any database records.

**DFF-ENGINE-004** `[x]`
When a draft is created, the system shall insert exactly `team_count` `teams` rows, exactly `team_count × rounds` `draft_order` rows in snake order, and one `team_pick_assets` row per team per configured future `(year, round)` combination inside a single transaction.

**DFF-ENGINE-005** `[x]`
If any derived draft-creation write fails after the draft row is inserted, the system shall roll back the entire draft creation transaction so no partial draft state remains.

---

## SSE Stream

**DFF-ENGINE-010** `[x]` → #26
When a client connects to GET /drafts/:id/stream, the system shall establish an SSE connection and immediately emit the current draft state as a `state_sync` event with the following payload: draft_id, status, current_pick_number, teams (id, name, is_user, archetype), draft_order (pick_number, round, pick_in_round, team_id), picks (pick_number, team_id, player_id, picked_at), roster_players (team_id, player_id)[], team_pick_assets (team_id, year, round)[], user_queue (player_id, rank)[], and available_players (id, name, position, nfl_team, age, is_rookie, dynasty_value, adp)[].

**DFF-ENGINE-011** `[x]` → #26
While a draft is in_progress, the system shall emit a `pick_made` event on every pick containing: pick_number, team_id, player_id, and is_bot.

**DFF-ENGINE-012** `[x]` → #26
When it becomes the user's turn to pick, the system shall emit a `your_turn` event containing: pick_number, round, and pick_in_round.

**DFF-ENGINE-013** `[x]` → #26
When a trade is initiated, the system shall emit a `trade_offered` event containing: trade_id, initiating_team_id, receiving_team_id, assets_sent, assets_received, and is_bot_to_bot.

**DFF-ENGINE-014** `[x]` → #26
When a trade is resolved, the system shall emit a `trade_resolved` event containing: trade_id, status, assets_sent, and assets_received.

**DFF-ENGINE-015** `[x]` → #26
When all picks are exhausted, the system shall emit a `draft_complete` event and set `drafts.status` to `completed`.

**DFF-ENGINE-016** `[x]`
When a draft transitions to `completed`, the system shall set `drafts.completed_at` to the current timestamp as part of that status update.

---

## Pick Submission

**DFF-ENGINE-020** `[x]` → #27
When a POST /drafts/:id/pick request is received, the system shall validate that it is currently the user's turn, that the player exists, and that the player has not already been picked.

**DFF-ENGINE-021** `[x]` → #27
If a pick submission fails validation, the system shall return a 400 error and shall not modify draft state.

**DFF-ENGINE-022** `[x]` → #9
When a valid user pick is submitted, the system shall write the pick to `picks`, write ownership to `roster_players`, remove the player from `user_queue`, emit a `pick_made` SSE event, and trigger the bot chain.

**DFF-ENGINE-023** `[x]` → #9
When a pick is recorded for any team, the system shall write `picks`, write `roster_players`, and remove any matching `user_queue` row inside a single transaction.

**DFF-ENGINE-024** `[x]`
When a pick is recorded directly by the draft engine service, the system shall reject requests for completed drafts, non-current pick slots, or already-drafted players and shall not modify draft state.
---

## Bot Chain

**DFF-ENGINE-030** `[x]` → #28
When the bot chain is triggered, the system shall automatically process all consecutive bot turns until the user's turn is reached or the draft is complete.

**DFF-ENGINE-031** `[x]` → #28
The system shall wait 3–5 seconds (random within that range) before processing each bot pick.

**DFF-ENGINE-032** `[x]` → #28
When a bot pick is made, the system shall write the pick to `picks`, write ownership to `roster_players`, and emit a `pick_made` SSE event before processing the next bot turn.

**DFF-ENGINE-033** `[x]` → #28
When the bot simulator initiates a trade during the bot chain, the system shall pause the chain, emit a `trade_offered` SSE event, and wait for POST /drafts/:id/trade-response before resuming.

---

## Bot-to-Bot Trade Visibility

**DFF-ENGINE-039** `[x]` → #28
When a bot-to-bot trade is initiated, the system shall pause the bot chain, emit a `trade_offered` SSE event with `is_bot_to_bot: true`, and require explicit user acknowledgment before resuming. This is intentional: the draft is untimed and solo, and the user must maintain full visibility of all board changes including bot-to-bot deals.

**DFF-ENGINE-039b** `[x]` → #28
For bot-to-bot trade modals, the system shall present two options: "OK" (user acknowledges; trade stands) and "Force Decline" (user vetoes the trade).

**DFF-ENGINE-039c** `[ ]` → #10
If the user chooses "Force Decline" for a bot-to-bot trade, the system shall write the trade to `trades` with status `force_declined` and perform no asset transfer.

---

## Trade Resolution

**DFF-ENGINE-040** `[ ]` → #10
When a POST /drafts/:id/trade-response is received with status `accepted`, the system shall transfer all assets as specified, write the trade to `trades`, emit a `trade_resolved` event, and resume the bot chain.

**DFF-ENGINE-041** `[ ]` → #10
When a POST /drafts/:id/trade-response is received with status `declined`, the system shall write the trade to `trades` with status `declined`, emit a `trade_resolved` event, and resume the bot chain without transferring any assets.

**DFF-ENGINE-042** `[ ]` → #10
When a POST /drafts/:id/trade-response is received with status `force_declined`, the system shall write the trade to `trades` with status `force_declined`, emit a `trade_resolved` event, and resume the bot chain without transferring any assets.

**DFF-ENGINE-043** `[x]` → #10
If a POST /drafts/:id/trade-response is received when no trade is pending, the system shall return a 409 error and shall not modify draft state.

---

## Pick Slot Swap

**DFF-ENGINE-050** `[ ]` → #10
When a trade containing pick slot assets is accepted, the system shall update `draft_order.team_id` for each swapped pick slot to reflect the new owner.

**DFF-ENGINE-051** `[ ]` → #10
The system shall only allow swapping pick slots that have not yet been used (i.e. picks whose pick_number is greater than the current pick_number).

---

## State & History

**DFF-ENGINE-060** `[x]` → #29
When a GET /drafts/:id/state request is received, the system shall return the same payload shape as the `state_sync` SSE event (see DFF-ENGINE-010), plus trades (id, round, initiating_team_id, receiving_team_id, assets_sent, assets_received, status)[].

**DFF-ENGINE-061** `[x]` → #29
The system shall persist all state changes to SQLite immediately as they occur; no state shall exist only in memory at the conclusion of a pick or trade.

**DFF-ENGINE-062** `[x]` → #29
When a GET /drafts request is received, the system shall return a list of all drafts with: id, created_at, completed_at, status, team_count, and rounds.

**DFF-ENGINE-063** `[x]` → #29
If an unexpected error occurs while processing a GET /drafts/:id/state or GET /drafts request, the system shall return a 500 error and shall not leave the HTTP response hanging.
