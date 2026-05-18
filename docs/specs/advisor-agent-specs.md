# EARS Specs: Advisor Agent

Drives: `docs/llds/advisor-agent.md`

Status markers: `[x]` implemented · `[ ]` gap · `[D]` deferred

---

## Context Assembly

**DFF-ADVISOR-001** `[ ]`
When an advisor request is received, the system shall assemble a context snapshot from SQLite containing: league settings, the user's current roster, all other teams' current rosters (from `roster_players`), the top 50 available players by roster-adjusted dynasty value, the user's queue in priority order, current pick number and rounds remaining, all executed trades, and all teams' current future pick asset inventories.

**DFF-ADVISOR-002** `[ ]`
The system shall assemble a fresh context snapshot for every advisor request; no context state shall persist between picks.

**DFF-ADVISOR-003** `[ ]`
The system shall include each player's name, position, nfl_team, age, dynasty_value, and adp in the context snapshot.

---

## Advise Me Mode

**DFF-ADVISOR-010** `[ ]`
When a POST /drafts/:id/advisor/advise request is received, the system shall send a single Claude API call with the assembled context and return a structured recommendation.

**DFF-ADVISOR-011** `[ ]`
The system shall structure the recommendation response as: Recommendation (player name, position, team), Key Factors (bulleted list), and Caveats (bulleted list).

**DFF-ADVISOR-012** `[ ]`
Each Key Factor in the recommendation shall cite a specific data point from the assembled context (e.g. dynasty value, age, positional need score, or board context).

**DFF-ADVISOR-013** `[ ]`
If the Claude API call fails, the system shall return a 502 error with a message indicating the advisor is unavailable; draft state shall not be affected.

---

## Grill-Me Mode

**DFF-ADVISOR-020** `[ ]`
When a POST /drafts/:id/advisor/chat request is received with a user message, the system shall append the message to the in-memory conversation for that draft and send the full conversation history plus assembled context to the Claude API.

**DFF-ADVISOR-021** `[ ]`
The system shall instruct the Claude model in grill-me mode to challenge the user's reasoning, surface risks and overlooked alternatives, and ask probing questions rather than offering unprompted recommendations.

**DFF-ADVISOR-022** `[ ]`
The system shall maintain the grill-me conversation in memory on the server, keyed by draft_id, for the duration of the current pick.

**DFF-ADVISOR-023** `[ ]`
When a DELETE /drafts/:id/advisor/chat request is received, the system shall clear the in-memory conversation for that draft.

**DFF-ADVISOR-024** `[ ]`
When the user commits a pick, the system shall clear the in-memory grill-me conversation for that draft so the next pick begins with a fresh conversation.

---

## Mode Switching

**DFF-ADVISOR-030** `[ ]`
The system shall allow the user to invoke both advise-me and grill-me modes on the same pick in any order; each advise-me call is independent, while grill-me maintains conversation history.

---

## Post-Draft Analysis

**DFF-ADVISOR-040** `[ ]`
When a POST /drafts/:id/advisor/analysis request is received and the draft status is `completed`, the system shall send the full draft history to the Claude API and return a structured post-draft analysis.

**DFF-ADVISOR-041** `[ ]`
The post-draft analysis shall include: a dynasty value grade per team (value acquired vs. ADP expectation), the user's roster positional balance and age curve assessment, notable trades with value impact summary, and at least three counterfactual picks for the user's selections.

**DFF-ADVISOR-042** `[ ]`
If a POST /drafts/:id/advisor/analysis request is received and the draft status is not `completed`, the system shall return a 400 error.

---

## API Key

**DFF-ADVISOR-050** `[ ]`
The system shall read the Claude API key from the `ANTHROPIC_API_KEY` environment variable at startup.

**DFF-ADVISOR-051** `[ ]`
If `ANTHROPIC_API_KEY` is not set, the system shall start successfully but return a 503 error on any advisor request with a message indicating the API key is missing.
