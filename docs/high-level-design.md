# High-Level Design: dynastyff

A local-first dynasty fantasy football support tool. First focus: startup mock drafts — solo practice drafts where the user drafts against simulated bots, with a Claude-backed advisor for pick guidance and strategy stress-testing.

## Problem

Dynasty fantasy football startup drafts are high-stakes and hard to practice. A startup draft sets your entire roster from scratch across 20+ rounds — every pick has compounding multi-year consequences. The mental model is far more complex than redraft: age curves, positional value trajectories, rookie premiums, and roster construction all interact.

Existing tools surface raw data but don't let you practice. You can look up dynasty trade values and ADP, but there's nowhere to run a realistic mock startup against simulated competition, get grounded advice on your picks, or stress-test a draft strategy before the real thing.

## Approach

A local web app that runs a full snake startup mock draft: the user drafts one team, bots simulate the other 11 using dynasty value data and positional need logic. A Claude-backed advisor is available on any pick — either "advise me" mode (agent gives a recommendation) or "grill-me" mode (user shares their thinking and the agent pushes back). The UI mirrors Sleeper's draft board so there's no new mental model to learn.

Data (player values, ADP, dynasty rankings) is pre-loaded from a local SQLite database populated by a separate ETL pipeline feature. The core draft loop (picks, bot simulation, trades) requires no real-time external calls and runs fully offline. The optional advisor features (advise me, grill-me, post-draft analysis) require a network connection and a valid `ANTHROPIC_API_KEY`.

## Target Users

- **Competitive dynasty managers** preparing for a real startup draft who want to practice strategy and get familiar with the player pool.
- **Solo use** — one manager, one local instance.

## Goals

1. **Realistic simulation.** Bot picks driven by dynasty value and positional need feel like real managers, not random selection.
2. **Grounded advisor.** Claude recommendations cite specific player values and roster context — no generic advice.
3. **Zero friction to start.** One config screen, one click to begin drafting. No accounts, no auth, no external dependencies at draft time.
4. **Sleeper-familiar UI.** Draft board, available players list, queue, and pick flow mirror Sleeper so the experience is immediately intuitive.
5. **Persistent history.** Completed mock drafts are saved locally for review and strategy comparison.

## Non-Goals

- **Auction drafts.** Snake only for this version.
- **Multi-user / networked drafts.** Local-first, single manager.
- **Real-time data fetching during drafts.** Data is pre-loaded; the core draft loop runs fully offline. (Advisor features require the Claude API — see Approach.)
- **Live platform integration (Sleeper, ESPN, Yahoo) for writing actions.** Read-only at most; the manager executes their real picks themselves.
- **Redraft support.** Dynasty-specific value system only.
- **Predictive statistical modeling.** The tool interprets existing dynasty rankings; it does not build its own.

## System Design

```
┌─────────────────────────────────────────────────────┐
│                    Browser (React)                   │
│                                                      │
│  Draft Board  │  Available Players  │  Advisor Chat  │
│  (Sleeper UI) │  (ranked + search)  │  (Claude Q&A)  │
└──────────────────────────┬──────────────────────────┘
                           │ HTTP + SSE
┌──────────────────────────▼──────────────────────────┐
│                  Express Server (TS)                 │
│                                                      │
│  Draft Engine  │  Bot Simulator  │  Advisor Agent    │
│  llds/draft-engine.md   llds/bot-simulator.md        │
│                          llds/advisor-agent.md       │
└──────────────────────────┬──────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────┐
│                  Local SQLite DB                     │
│                                                      │
│  players  │  pick_values  │  drafts  │  draft_order  │
│  picks    │  roster_players  │  trades  │  teams      │
│  team_pick_assets        llds/data-model.md          │
└─────────────────────────────────────────────────────┘
                           ▲
┌──────────────────────────┴──────────────────────────┐
│              ETL Pipeline (npm run etl)              │
│                                                      │
│  Scrapers: KTC │ FantasyCalc │ DynastyDaddy          │
│            RosterAudit       (Playwright)            │
│  Normalize → Aggregate → Upsert                      │
│                   llds/etl-pipeline.md               │
└─────────────────────────────────────────────────────┘
```

**Five intent components:**

- **Draft Engine** (`llds/draft-engine.md`) — manages draft state: pick order, snake rotation, round progression, SSE event emission, pick submission, and draft history persistence.
- **Bot Simulator** (`llds/bot-simulator.md`) — drives automated picks for all non-user teams. Uses dynasty value + positional need multiplier + configurable noise. Emits picks on a 3–5s simulated delay via the Draft Engine.
- **Advisor Agent** (`llds/advisor-agent.md`) — Claude-backed conversational advisor. Receives full draft state as context. Supports two modes: "advise me" (agent recommends a pick with reasoning) and "grill-me" (user shares their thinking, agent challenges it). Multi-turn Q&A scoped to the current pick.
- **Data Model** (`llds/data-model.md`) — SQLite schema for players, future pick values, draft sessions, pick history, roster ownership, and trade history. Players carry: name, position, team, age, rookie status, dynasty value, ADP, and per-source raw values. Future pick values (keyed by year and round) are sourced from the ETL pipeline alongside player values.
- **ETL Pipeline** (`llds/etl-pipeline.md`) — standalone `npm run etl` script that scrapes KTC, FantasyCalc, DynastyDaddy, and RosterAudit via Playwright. Normalizes each source's values to 0–9999 via min-max scaling, averages them into a single `dynasty_value`, and upserts results into the SQLite database. Runs two scrapers concurrently; commits partial results on failure with loud per-source warnings.

## Key Design Decisions

| Decision | Chosen | Alternatives | Rationale |
|---|---|---|---|
| Stack | TypeScript throughout; Express + React + Playwright ETL | Python/FastAPI + React; Next.js + tRPC | Single language across frontend, backend, and ETL; Express keeps the server layer simple with no framework overhead |
| Real-time updates | Server-Sent Events (SSE) | WebSockets | Draft board is server→client push only; SSE is sufficient and simpler than WebSockets for a local single-user app |
| Bot pick logic | Dynasty value × positional need multiplier + weighted noise | Pure ADP; archetype-based personalities | Captures real manager behavior (value-aware + positionally strategic) without requiring hand-coded team archetypes |
| UI reference | Mirrors Sleeper draft board | Custom design | Familiar to target users; no design decisions needed; no copyright risk as a local-only tool |
| Advisor interaction | Ranked list always visible; Claude on-demand ("advise me" or "grill-me") | Always-on Claude; CLI Q&A | Ranked list is instant and low-cost; Claude is opt-in per pick to control latency and token spend |
| Pick commitment | Click on draft board | Confirm in chat | Separates reasoning (chat) from action (board); consistent pick flow regardless of advisor use |
| Data at draft time | Pre-loaded local SQLite from ETL pipeline | Real-time scraping | Zero external dependencies during draft; fast and reliable |
| Draft persistence | SQLite via Drizzle ORM | JSON files | Queryable history; same database as player data; Drizzle keeps TS types in sync |
| Auth / API keys | `ANTHROPIC_API_KEY` via `.env` | UI config screen | Standard local dev pattern; no UI work required |
| Draft format | Snake, 20 rounds (configurable) | Auction; fixed rounds | Snake is the dominant startup format; 20 rounds covers a full dynasty roster |
| Player pool | Open pool — any player searchable, ranked by adjusted dynasty value | Pre-ranked finite list | Matches Sleeper UX; handles edge cases (obscure players) without requiring exhaustive pre-population |
| Future pick assets | 3 years, configurable rounds per year | Fixed format | Startup leagues trade future picks; configurable rounds match real league settings |

## Default League Configuration

| Setting | Default | Configurable |
|---|---|---|
| Teams | 12 | Yes |
| Draft rounds | 20 | Yes |
| Scoring | PPR | Yes |
| User pick position | Random | Yes |
| Future pick years | 3 | Yes |
| Future pick rounds per year | Configurable | Yes |
| Roster: QB | 1 | Yes |
| Roster: RB | 2 | Yes |
| Roster: WR | 3 | Yes |
| Roster: TE | 1 | Yes |
| Roster: FLEX | 1 | Yes |
| Roster: Superflex | 1 | Yes |
| Roster: Bench | 6 | Yes |

## Success Metrics

- Bot pick realism: in a blind review of 10 completed mock draft boards, picks are indistinguishable from plausible human decisions at each position.
- Advisor grounding: ≥ 90% of pick recommendations in "advise me" mode cite a specific dynasty value or roster-need factor.
- History persistence: all completed mock drafts are queryable from the draft history view with full pick-by-pick detail.

## References

- `docs/llds/draft-engine.md`
- `docs/llds/bot-simulator.md`
- `docs/llds/advisor-agent.md`
- `docs/llds/data-model.md`
- `docs/specs/`
