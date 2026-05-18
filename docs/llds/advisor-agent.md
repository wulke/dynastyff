# LLD: Advisor Agent

## Context

The advisor agent is the Claude-backed reasoning layer that helps the user make pick decisions. It is invoked on demand — never automatically. It operates in two modes: "advise me" (single-call recommendation) and "grill-me" (multi-turn conversation where the user shares their thinking and Claude challenges it). Both modes receive the same assembled draft context; only the interaction shape differs.

Drives specs: `docs/specs/advisor-agent-specs.md`

## Responsibilities

- Assemble full draft state into structured Claude context for each invocation
- Serve "advise me" requests: single Claude call → structured recommendation
- Serve "grill-me" requests: multi-turn conversation scoped to the current pick
- Support switching between modes mid-pick (user can "advise me first, then grill me")
- Serve post-draft analysis requests: roster grades and value-over-ADP review

## API Surface

| Method | Path | Description |
|---|---|---|
| POST | `/drafts/:id/advisor/advise` | Single-call pick recommendation |
| POST | `/drafts/:id/advisor/chat` | Send a message in the grill-me conversation |
| DELETE | `/drafts/:id/advisor/chat` | Reset the grill-me conversation (new pick) |
| POST | `/drafts/:id/advisor/analysis` | Post-draft full analysis |

## Context Assembly

Each advisor call assembles a context object from SQLite before invoking Claude. The context is passed as a structured block in the system prompt. A new context snapshot is assembled on every call — no conversation state is persisted between picks.

**Context structure:**

```
League Settings
- scoring format, roster slots, team count, rounds

User's Current Roster
- picked players: name, position, age, dynasty_value, round picked

All Other Teams' Rosters (by team name and archetype)
- same shape as above per team

Available Players (top 50 by adjusted dynasty value for the user's roster needs)
- name, position, age, dynasty_value, adp, positional_need_score

User's Queue
- players in the user's watchlist, in priority order

Remaining Pick Context
- current pick number, round, picks until user's next turn
- how many picks remain in the draft

Trade History
- trades executed so far: who traded what to whom, and when (round)

Future Pick Assets (all teams)
- which future picks each team currently holds
```

Context is intentionally scoped to what is useful for the current decision. The full player pool (hundreds of players) is not included — only top available players by adjusted value are sent to keep token use proportional to query complexity.

## Advise Me Mode

Single Claude call. The user clicks "Advise Me" and receives a structured recommendation.

**System prompt structure:**
1. Role definition: dynasty FF advisor, opinionated, grounded in dynasty value data, dynasty-specific (not redraft)
2. Assembled draft context (see above)
3. Instruction: recommend a pick for the user's current turn, structured as: Recommendation / Key Factors / Caveats

**Response format:**

```
**Recommendation:** [Player Name], [Position], [Team]

**Key Factors:**
- [Factor citing dynasty value, age, positional need, or board context]
- [Factor]
- ...

**Caveats:**
- [Any relevant risks or alternatives]
```

All value claims must cite the data source (e.g. "KTC dynasty value: 4800").

## Grill-Me Mode

Multi-turn conversation scoped to the current pick. The conversation resets when the user makes their pick or explicitly clears it.

**Turn 1:** User shares their thinking ("I'm considering taking this WR because..."). Claude responds by probing the reasoning — asking about trade-offs, poking at assumptions, surfacing what the user may not have considered. Claude does not give a recommendation unprompted; it asks questions and challenges the user's logic.

**Subsequent turns:** User responds to Claude's challenges or asks follow-up questions. Claude maintains the same assembled draft context throughout the conversation.

**System prompt structure:**
1. Role definition: adversarial dynasty FF coach — not there to agree, there to find holes in the user's reasoning
2. Assembled draft context
3. Instruction: do not recommend a pick; probe the user's stated reasoning; surface risks, overlooked alternatives, and faulty assumptions

**Conversation scoping:** Each grill-me conversation is held in memory on the server, keyed by `draft_id`. It resets when `DELETE /advisor/chat` is called (which the client sends when the user commits a pick or starts a new pick turn).

## Post-Draft Analysis Mode

Available after `drafts.status = 'completed'`. Single Claude call with the full completed draft as context.

**Analysis covers:**
- Per-team roster grade (dynasty value acquired vs. ADP expectation)
- User's roster: positional balance, age curve, identified strengths and vulnerabilities
- Notable trades: which trades swung the most value and in whose favor
- Counterfactuals: players available at each of the user's picks that would have been alternative choices

## Decisions

| Decision | Chosen | Alternatives | Rationale |
|---|---|---|---|
| Context lifetime | Assembled fresh per call | Persistent conversation across picks | Avoids context window bloat over a 20-round draft; full draft state injected each time means the advisor always has current information |
| Grill-me conversation persistence | In-memory on server, keyed by draft_id | Client-side message history | Server holds the conversation so the context assembly (SQLite reads) stays on the server; client just sends messages |
| Available players in context | Top 50 by adjusted value | Full player pool | Keeps token use proportional; the advisor doesn't need to know about the 500th available player to recommend a pick |
| Mode switching | User can invoke advise-me and grill-me independently on the same pick | Separate UI flows | User may want a recommendation first then want to pressure-test it; both modes share the same context assembly |
| Model | claude-sonnet-4-6 | opus, haiku | Balances reasoning quality and cost for the expected query volume |
| Prompt caching | Cache role + league settings prefix | Resend full prompt each call | League settings and role definition are static per draft session; caching reduces latency on repeated advisor calls |

## Open Questions

- [ ] Should the grill-me conversation be exportable / saved with the draft history for later review?
- [ ] When the user's queue has players ranked, should "advise me" mode prioritize queue players or override with the best available?
