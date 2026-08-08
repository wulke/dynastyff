# High-Level Design: dynastyff

A local-first dynasty fantasy football support tool with two focus areas: **startup mock drafts** — solo practice drafts where the user drafts against simulated bots, with a Claude-backed advisor for pick guidance and strategy stress-testing — and **post-draft season management** — roster evaluation, trade analysis, proactive trade recommendations, and waiver wire guidance powered by live Sleeper league data and dynasty values.

## Problem

Dynasty fantasy football startup drafts are high-stakes and hard to practice. A startup draft sets your entire roster from scratch across 20+ rounds — every pick has compounding multi-year consequences. The mental model is far more complex than redraft: age curves, positional value trajectories, rookie premiums, and roster construction all interact.

Once the draft is over, the challenges compound. Dynasty managers face a continuous stream of trade offers, waiver decisions, and roster management calls — often with no systematic way to evaluate them. Existing tools surface raw dynasty values but don't interpret them in the context of your specific roster, your league, and your team's competitive window. A trade offer that looks balanced by value alone may be wrong for a rebuilding team. A waiver add only makes sense if the drop it requires is worth making.

Existing tools surface raw data but don't help you act on it. dynastyff closes that gap in two phases: practice startup drafts before the real thing, then manage your real team intelligently throughout the season.

## Approach

**Startup mock drafts:** A local web app that runs a full snake startup mock draft: the user drafts one team, bots simulate the other 11 using dynasty value data and positional need logic. A Claude-backed advisor is available on any pick — either "advise me" mode (agent gives a recommendation) or "grill-me" mode (user shares their thinking and the agent pushes back). The UI mirrors Sleeper's draft board so there's no new mental model to learn.

**Season management:** A standalone My Team section that connects to the user's real Sleeper league (read-only) and surfaces four tools: a roster evaluator that grades your team by position, a trade analyzer that evaluates pending Sleeper trade offers, a proactive trade recommender that scans the full league and surfaces trade opportunities grouped by roster need, and a waiver wire recommender that pairs add candidates with the optimal drop. All four tools run a structured algorithm first (value delta, age curve, positional need, team context, asset liquidity) and then pass the scored output to Claude for contextual reasoning — not a generic wrapper, but a reasoning layer that interprets the algorithm's signals in the context of the user's specific roster and competitive window.

Data (player values, ADP, dynasty rankings, Sleeper league state) is pre-loaded from a local SQLite database populated by a separate ETL pipeline feature. The ETL pipeline is extended to sync connected Sleeper leagues alongside player value scraping, and is designed for scheduled execution. The core draft loop requires no real-time external calls and runs fully offline. The advisor features (advise me, grill-me, trade analysis) require a network connection and a valid `ANTHROPIC_API_KEY`. Sleeper sync requires a network connection at ETL time.

## Target Users

- **Competitive dynasty managers** preparing for a real startup draft who want to practice strategy and get familiar with the player pool.
- **Active dynasty managers** in live Sleeper leagues who want systematic help evaluating trades and managing their roster week-to-week.
- **Solo use** — one manager, one local instance.

## Goals

1. **Realistic simulation.** Bot picks driven by dynasty value and positional need feel like real managers, not random selection.
2. **Grounded advisor.** Claude recommendations cite specific player values and roster context — no generic advice.
3. **Zero friction to start.** One config screen, one click to begin drafting. No accounts, no auth, no external dependencies at draft time.
4. **Sleeper-familiar UI.** Draft board, available players list, queue, and pick flow mirror Sleeper so the experience is immediately intuitive.
5. **Persistent history.** Completed mock drafts are saved locally for review and strategy comparison.
6. **Contextual season management.** Trade and waiver recommendations are grounded in the user's actual roster, their league's competitive landscape, and a defined rebuild/contend strategy — not just raw dynasty value comparisons.
7. **Algorithm-first reasoning.** Claude reasoning in season management is always downstream of a structured scoring pass — every suggestion is traceable to explicit signals (value delta, age curve, positional need, team context, asset liquidity).

## Non-Goals

- **Auction drafts.** Snake only for this version.
- **Multi-user / networked drafts.** Local-first, single manager.
- **Real-time data fetching during drafts.** Data is pre-loaded; the core draft loop runs fully offline. (Advisor features require the Claude API — see Approach.)
- **Write actions to Sleeper.** Read-only integration only; the manager executes waiver claims and trade responses in Sleeper directly.
- **Redraft support.** Dynasty-specific value system only.
- **Predictive statistical modeling.** The tool interprets existing dynasty rankings; it does not build its own.
- **Start/sit advice.** Requires a weekly projections data source not yet in scope; deferred to a future initiative.
- **Multi-platform support (ESPN, Yahoo).** Sleeper only for this version.

## System Design

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (React)                           │
│                                                                  │
│  ┌─── Draft Mode ──────────────────────────────────────┐        │
│  │  Draft Board  │  Available Players  │  Advisor Chat  │        │
│  │  (Sleeper UI) │  (ranked + search)  │  (Claude Q&A)  │        │
│  │  llds/ui.md                                          │        │
│  └──────────────────────────────────────────────────────┘        │
│                                                                  │
│  ┌─── My Team Mode ────────────────────────────────────┐        │
│  │  Roster Evaluator  │  Trade Analyzer  │  Waiver Wire │        │
│  │  (grades + pctile) │  (pending offers │  (add/drop   │        │
│  │                    │   + proactive)   │   pairs)     │        │
│  │  llds/season-management.md                          │        │
│  └──────────────────────────────────────────────────────┘        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP + SSE
┌──────────────────────────▼──────────────────────────────────────┐
│                      Express Server (TS)                         │
│                                                                  │
│  Draft Engine  │  Bot Simulator  │  Advisor Agent                │
│  llds/draft-engine.md   llds/bot-simulator.md                    │
│                          llds/advisor-agent.md                   │
│                                                                  │
│  Season Manager  │  Trade Scorer  │  Waiver Scorer               │
│  llds/season-management.md                                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                      Local SQLite DB                             │
│                                                                  │
│  players  │  pick_values  │  drafts  │  draft_order             │
│  picks    │  roster_players  │  trades  │  teams                 │
│  team_pick_assets  │  etl_runs                                   │
│  player_value_snapshots  │  pick_value_snapshots                 │
│                                                                  │
│  sleeper_leagues  │  sleeper_rosters  │  sleeper_players         │
│  sleeper_teams    │  sleeper_trade_offers                        │
│                        llds/data-model.md                        │
└─────────────────────────────────────────────────────────────────┘
                           ▲                        ▲
┌──────────────────────────┴──────────┐  ┌──────────┴─────────────┐
│      ETL Pipeline (npm run etl)     │  │   Sleeper Sync          │
│                                     │  │                         │
│  Scrapers: KTC │ FantasyCalc        │  │  GET /user/{name}       │
│            RosterAudit (Playwright) │  │  GET /user/{id}/leagues │
│  Match → Normalize → Aggregate      │  │  GET /league/{id}/...   │
│  → Upsert + Snapshot                │  │  (rosters, users,       │
│  llds/etl-pipeline.md               │  │   transactions)         │
│                                     │  │  llds/sleeper-sync.md   │
│  Runs Sleeper sync as final step    │  │                         │
│  Designed for scheduled execution   │  │                         │
└─────────────────────────────────────┘  └─────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│          Static Build (GitHub Pages)                             │
│                                                                  │
│  Browser-only React app — no Express, no SQLite                  │
│  data/snapshot.json (committed, ETL-generated)                   │
│  In-memory draft engine  │  Bot loop in React ctx               │
│  Advisor excluded        llds/static-build.md                   │
│  Season management excluded (requires local SQLite + Express)    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ GitHub Actions
┌──────────────────────────▼──────────────────────────────────────┐
│  etl-snapshot.yml: workflow_dispatch → ETL →                     │
│    export-snapshot → commit data/snapshot.json                   │
│  pages.yml: push to main → vite build → Pages deploy             │
│  https://wulke.github.io/dynastyff/                              │
└─────────────────────────────────────────────────────────────────┘
```

**Intent components:**

**Draft mode (existing):**

- **Draft Engine** (`llds/draft-engine.md`) — manages draft state: pick order, snake rotation, round progression, SSE event emission, pick submission, and draft history persistence.
- **Bot Simulator** (`llds/bot-simulator.md`) — drives automated picks for all non-user teams. Uses dynasty value + positional need multiplier + configurable noise across six team archetypes (`bpa`, `balanced`, `win_now`, `punt`, `rb_heavy`, `qb_early`). Emits picks on a 3–5s simulated delay via the Draft Engine. The core pick-selection logic lives in an isomorphic module (`src/draft/bot.ts`) shared with the static build.
- **Advisor Agent** (`llds/advisor-agent.md`) — Claude-backed conversational advisor. Receives full draft state as context. Supports two modes: "advise me" (agent recommends a pick with reasoning) and "grill-me" (agent challenges it). Multi-turn Q&A scoped to the current pick. Excluded from the static build.
- **UI** (`llds/ui.md`) — local React SPA connected to the Express backend via HTTP and SSE. Three views (config → drafting → history) driven by a top-level view-state enum. All draft state lives in a single `DraftContext` (React Context + useReducer); SSE events are the only write path during a live draft.
- **Static Build** (`llds/static-build.md`) — browser-only second deployable target at `https://wulke.github.io/dynastyff/`. No Express server, no SQLite, no persistent storage. Season management excluded.

**Season management (new):**

- **Sleeper Sync** (`llds/sleeper-sync.md`) — ETL sub-module that calls the Sleeper public API (read-only) to fetch league state for all connected leagues. Runs as the final step of `npm run etl`. Stores results in the `sleeper_*` SQLite tables. On-load auto-sync and manual refresh trigger a lightweight re-run of this step only. Designed for scheduled execution.
- **Season Manager** (`llds/season-management.md`) — Express-side orchestrator for the My Team section. Coordinates four sub-systems: Roster Evaluator, Trade Scorer, Trade Recommender, and Waiver Scorer. Each sub-system runs a structured algorithm pass over SQLite data and returns scored candidates; the Season Manager assembles the full context payload and passes it to Claude for reasoning.
- **Roster Evaluator** — scores the user's roster by positional group: dynasty value per position, age curve score, and percentile rank vs. all other teams in the league. Outputs a letter grade (A–F) and percentile per position, plus an overall team grade. Feeds the context header for all other season management tools.
- **Trade Scorer** — evaluates individual trades (pending Sleeper offers or proactive candidates) against five signals: value delta (KTC/FantasyCalc surplus per side), age curve score (buying youth vs. selling age), positional need gap (your depth vs. league average), team context (record-based contender/rebuilder classification), and asset liquidity (pick vs. player preference by team). Outputs a structured score object that Claude reasons over.
- **Trade Recommender** — scans all other league rosters to surface proactive trade opportunities. Matches user surplus assets against other teams' gaps. Groups candidates by roster need (e.g., "WR targets", "RB sells", "pick acquisitions"). Passes the top candidates per group to Claude for ranking and narrative explanation.
- **Waiver Scorer** — ranks free agents against the user's positional gaps. For each recommended add, identifies the optimal drop candidate (lowest dynasty value player at the position with the least depth). Passes add/drop pairs to Claude to evaluate whether each swap is net-positive in context.

**Shared (both modes):**

- **Data Model** (`llds/data-model.md`) — SQLite schema extended with `sleeper_leagues`, `sleeper_rosters`, `sleeper_players`, `sleeper_teams`, and `sleeper_trade_offers` tables. Existing tables unchanged.
- **ETL Pipeline** (`llds/etl-pipeline.md`) — extended to run Sleeper sync as a final step. Designed for scheduled execution (e.g., nightly cron) in addition to manual `npm run etl` invocation.

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
| Static build | Browser-only GitHub Pages target; advisor excluded | Server-only; no public deployment | Lets anyone practice drafts without running the local server; keeps API key off a public site |
| Draft value pinning | Nullable `etl_run_id` FK on `drafts` | Re-read current `players` on every pick | Prevents mid-draft or historical value drift when ETL runs during a draft or later |
| ETL run snapshots | `etl_runs` + `player_value_snapshots` + `pick_value_snapshots` | Overwrite-only `players` table | Enables point-in-time value reconstruction and auditable per-run failure tracking |
| Cross-source player matching | Name fuzzy match (Dice ≥ 0.85) + `player-aliases.json` | Shared external ID | No shared ID across all four sources; fuzzy match handles the common case; aliases handle known edge cases |
| DynastyDaddy scraper | Implemented but excluded from live ETL | Removed from codebase | Scraper is unstable; keeping the module preserves re-enablement path without blocking the pipeline |
| Sleeper integration | Read-only public API | Write API (unofficial); no integration | Sleeper's write API is undocumented and fragile; read-only covers all high-value analysis use cases |
| Sleeper connection flow | Username lookup → league picker, or direct league ID | OAuth | Sleeper's public API requires no auth for read; username lookup is lower friction than OAuth for a local tool |
| Sleeper data refresh | On app load + manual refresh button; also runs as ETL step | Polling; real-time webhooks | Dynasty rosters change infrequently; on-load sync is sufficient with a manual refresh for post-trade scenarios |
| Sleeper data persistence | SQLite (`sleeper_*` tables) | In-memory per session | Enables week-over-week roster value diffs, offline access after sync, and cross-feature data reuse |
| Season management Claude layer | Algorithm-first: structured score object → Claude reasoning | LLM-only; pure algorithm | Algorithm produces explicit, traceable signals; Claude interprets them in context — not a generic wrapper. Ensures every suggestion is grounded and auditable. |
| Trade scoring signals | Value delta + age curve + positional need + team context + asset liquidity | Value delta only | Five-signal model captures the full context a dynasty manager actually uses; each signal is independently computable from existing data |
| Proactive recommendations grouping | Grouped by roster need (WR targets, RB sells, etc.) | Flat ranked list | Grouping by need makes the reasoning self-evident; matches how dynasty managers think about their roster |
| Waiver recommendations | Add/drop pairs with net-swap evaluation | Add-only recommendations | A waiver add that ignores what you'd have to drop is incomplete advice; pairing is essential for actionability |
| Start/sit advice | Deferred | In scope | Requires a weekly projections data source not present in the current ETL stack; separate initiative |
| Season management in static build | Excluded | Included | Season management requires Express (Season Manager), SQLite (Sleeper data), and a live `ANTHROPIC_API_KEY` — none available in the static build |

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
- Trade recommendation relevance: ≥ 80% of proactive trade suggestions target a position where the user's grade is C or below.
- Waiver recommendation precision: ≥ 90% of waiver add/drop pairs show a positive dynasty value delta for the swap.
- Claude grounding in season management: 100% of trade and waiver recommendations reference at least one explicit algorithm signal (value delta, age curve, positional need, team context, or asset liquidity) in the explanation.

## References

- `docs/llds/draft-engine.md`
- `docs/llds/bot-simulator.md`
- `docs/llds/advisor-agent.md`
- `docs/llds/data-model.md`
- `docs/llds/etl-pipeline.md`
- `docs/llds/ui.md`
- `docs/llds/static-build.md`
- `docs/llds/player-value-history.md`
- `docs/llds/sleeper-sync.md` *(new)*
- `docs/llds/season-management.md` *(new)*
- `docs/specs/`
# TE-Premium Scoring Decision

TE premium is an independent league modifier rather than a scoring-format variant. The ETL retains KTC's three published premium tiers, draft configuration persists the selected tier, and bot pick scoring applies the selected adjusted value only to tight ends. This keeps the base scoring matrix (`ppr`, `half_ppr`, `standard`) orthogonal to TE premium.
