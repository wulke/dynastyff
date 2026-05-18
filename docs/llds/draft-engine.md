# LLD: Draft Engine

## Context

The draft engine is the server-side orchestrator of a mock draft session. It owns draft state, enforces pick order, triggers the bot simulator, handles trade resolution, persists every state change to SQLite, and broadcasts events to the browser via SSE. It is the single source of truth for what has happened and what happens next in a draft.

Drives specs: `docs/specs/draft-engine-specs.md`

## Responsibilities

- Create and initialize a draft session (teams, snake order, pick assets)
- Accept user pick submissions and validate them
- Chain bot turns automatically after each user pick
- Pause the bot chain when a trade offer is pending and resume after resolution
- Apply pick slot swaps and future pick asset transfers when trades execute
- Emit SSE events for every state change (pick made, trade offered, trade resolved, draft complete)
- Persist every pick and trade to SQLite immediately
- Mark the draft complete and record `completed_at` when all picks are exhausted

## Draft Lifecycle

```
create → in_progress → [pick loop] → completed
                           │
                    ┌──────▼──────┐
                    │ user's turn │ ← wait for POST /pick
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  bot chain  │ ← server loops automatically
                    │  (3–5s ea)  │
                    └──────┬──────┘
                           │
                    trade offered?
                    ├── yes → emit SSE, pause, wait for POST /trade-response
                    └── no  → continue chain
```

## API Surface (Express routes)

| Method | Path | Description |
|---|---|---|
| POST | `/drafts` | Create a new draft session with config |
| GET | `/drafts/:id/stream` | SSE stream for real-time events |
| GET | `/drafts/:id/state` | Full current draft state snapshot |
| POST | `/drafts/:id/pick` | Submit user pick (player_id) |
| POST | `/drafts/:id/trade-response` | Accept, decline, or force-decline a pending trade |
| GET | `/drafts` | List completed draft sessions |
| GET | `/drafts/:id/summary` | Post-draft summary for history view |

## SSE Event Types

| Event | Payload | When emitted |
|---|---|---|
| `pick_made` | `{ pick_number, team_id, player_id, is_bot }` | Every pick, user or bot |
| `trade_offered` | `{ trade_id, initiating_team_id, receiving_team_id, assets_sent, assets_received, is_bot_to_bot }` | When a bot proposes a trade |
| `trade_resolved` | `{ trade_id, status, assets_sent, assets_received }` | After user responds to trade modal |
| `your_turn` | `{ pick_number, round, pick_in_round }` | When it's the user's turn to pick |
| `draft_complete` | `{ draft_id, completed_at }` | When all picks are exhausted |

## Snake Order Generation

At draft creation, the full pick order (e.g. 240 rows for 12×20) is computed and written to `draft_order`:
- Odd rounds: teams pick in position order (1 → 12)
- Even rounds: teams pick in reverse (12 → 1)
- User's `pick_position` places them in the correct slot; remaining positions filled randomly for bots

## Draft Creation Bootstrap

Draft creation is a single transactional bootstrap that writes the base `drafts` row and all derived state together:

1. Insert the `drafts` row with status `in_progress`
2. Insert exactly `team_count` `teams` rows
3. Mark the team at `user_pick_position` as `is_user = 1`
4. Assign every bot team a predefined generic name and one valid archetype
5. Generate `draft_order` rows for every round in snake order
6. Generate `team_pick_assets` rows for every team across the configured future `(year, round)` matrix
7. Commit only if all derived rows were written successfully

If any team, draft-order, or pick-asset write fails, the transaction is rolled back so no partial draft remains in SQLite.

## Draft Completion

When the draft engine transitions a draft from `in_progress` to `completed`, it updates `drafts.status` and sets `drafts.completed_at` to the current timestamp in the same write. Non-terminal updates must not populate `completed_at`.

## Trade Resolution

All trade modals — including bot-to-bot trades — are blocking and require explicit user acknowledgment before the draft continues. This is intentional: the draft is untimed and solo, so the user should have full visibility into every trade that reshapes the board. For bot-to-bot trades the buttons are "OK" (acknowledge, trade stands) and "Force Decline" (user vetoes the trade). For user-targeted trades the buttons are "Accept" and "Decline."

When a bot initiates a trade (see bot-simulator LLD for initiation logic):

1. Draft engine pauses the bot chain
2. Emits `trade_offered` SSE event with `is_bot_to_bot` flag
3. Waits for `POST /trade-response`
4. On `accepted`: transfers assets (mutates `draft_order` rows, transfers `team_pick_assets` rows, moves drafted players between teams if applicable), writes `trades` record with status `accepted`
5. On `declined` or `force_declined`: writes `trades` record with appropriate status, resumes bot chain
6. Resumes the bot chain after any resolution

## Decisions

| Decision | Chosen | Alternatives | Rationale |
|---|---|---|---|
| Real-time transport | SSE | WebSockets, client polling | Draft board is server→client push; SSE is simpler than WebSockets and sufficient for a single local client |
| Bot chain execution | Server-side loop with setTimeout delays | Client-triggered per-bot-pick | Keeps orchestration on the server; client is passive and can reconnect to the SSE stream without losing state |
| Trade pause mechanism | In-memory flag on draft session object | DB-based lock | Trade resolution is synchronous per session; in-memory flag is sufficient for a single-user local app |
| State snapshot endpoint | `GET /drafts/:id/state` returns full state | Rebuild from events client-side | Allows browser to reconnect and recover full state without replaying the event stream |
| Pick validation | Server validates player is available and not already picked | Trust client | Prevents bugs where the UI and server state diverge |

## Open Questions

- [ ] If the SSE connection drops mid-draft, how does the client recover — reconnect to `/stream` and replay missed events, or call `/state` and re-sync?
- [ ] Should bot-to-bot trades that are force-declined by the user result in any penalty or just silently abort?
