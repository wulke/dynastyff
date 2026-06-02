# dynastyff

A local web app for practicing dynasty startup drafts. Run a full 12-team snake mock against simulated bots, with an optional Claude-backed advisor for pick guidance and strategy stress-testing.

## Prerequisites

- Node.js 20+
- Playwright (for ETL scraping)
- `ANTHROPIC_API_KEY` (required for advisor features only; core draft runs offline)

## Setup

```bash
# Install dependencies
npm install

# Initialize the local SQLite schema (recreates the local DB file)
npm run db:init

# Install Playwright browsers
npx playwright install

# Configure environment
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env

# Populate the database (scrapes KTC, FantasyCalc, and RosterAudit)
npm run etl

# Export the browser snapshot used by the static build
npm run export:snapshot

# Start the backend API server
npm run serve

# Start the UI dev server in a second terminal
npm run dev
```

The Vite dev server proxies `/drafts` requests to `http://localhost:3001`, so both commands should be running for draft creation, state/history reads, and the live draft SSE stream.

Open the Vite URL shown in the terminal to begin.

When saved drafts already exist, the UI now opens on a Drafts List page first. From there you can resume an in-progress draft, review any completed draft, or start a new draft. If the initial drafts lookup fails, the app falls back to the config screen and shows an error toast.

## Usage

1. **Configure your league** — set team count, roster slots, scoring, and your draft position on the config screen.
   - If prior drafts exist, use the Drafts List page first to resume or review them, or click **New Draft** to open the config form.
2. **Start a mock draft** — the app runs a full snake draft; bots pick for the other 11 teams automatically.
   - On the API-backed draft flow, bot turns continue server-side after every successful user pick with a randomized `3–5s` delay between bot selections.
   - If your league settings place a bot on the opening slot, the server now auto-starts those opening bot turns immediately after draft creation so the board advances to your first turn without extra input.
   - When a bot trade is resolved, the server now persists the trade outcome immediately. Accepted trades also transfer traded players, startup pick slots, and future pick assets inside the same SQLite transaction as the `trades` insert.
3. **Use the advisor (optional)** — on any pick, choose:
   - **Advise me** — Claude recommends a pick with dynasty value reasoning.
   - **Grill me** — share your thinking; Claude pushes back.
4. **Review history** — when a draft completes, the draft board stays visible behind a completion banner. Click **View Full History** to open the history view with three tabs:
   - **Pick Log** — chronological list of all picks with round, pick number, team, player name, position badge, and dynasty value at draft time.
   - **Roster View** — per-team cards with players grouped by position (QB, RB, WR, TE), showing round drafted and dynasty value. Your team card is highlighted.
   - **Trade Log** — chronological list of all trades with round, teams involved, assets exchanged, and outcome (accepted / declined / force_declined).
   A "New Draft" button returns you to the config screen.

## Configuration

| Setting | Default | Notes |
|---|---|---|
| Teams | 12 | |
| Draft rounds | 20 | |
| Scoring | PPR | |
| User pick position | Configurable | Selected on the config screen |
| Future pick years | 3 | |

All settings are configurable on the league config screen before starting a draft.

The advisor requires `ANTHROPIC_API_KEY` set in `.env`. The core draft loop runs fully offline.

## UI Scaffold

Issues `#13`, `#15`, `#17`, and `#54` establish the current frontend shell under `/src/ui`:

- `Config Screen` renders on first load as a real league configuration form
- `src/ui/context/DraftContext.tsx` owns the HTTP draft lifecycle and exposes `useDraftContext()` for all draft data and actions
- `Start Draft` now flows through `HttpDraftContext.startDraft()`, which posts the camelCase `POST /drafts` payload and opens `GET /drafts/:id/stream`
- Successful draft creation transitions the UI into the drafting view immediately, then hydrates `GET /drafts/:id/state` in parallel with SSE so the three-column draft room can load in place
- The draft board renders round headers, team rows, snake-order slots, a highlighted user row, and a pulsing skeleton for the current bot pick
- `pick_made` SSE events update the already-rendered board in place without a re-fetch
- The drafting room now renders three columns at wide viewports: `Draft Board`, `Available Players`, and `Pick Feed`, with weighted widths and a persistent status bar that shows current pick progress plus whose turn it is
- Each drafting column header now includes an expand control; expanding one panel turns the other two into narrow icon strips with rotated labels, and the layout resets to the default weighted widths on page load instead of persisting accordion state
- The `Available Players` column now uses `Available` / `Targets` tabs: the default `Available` view keeps the dynasty-sorted list, client-side position filters, live name search, draft-start skeleton rows, a two-step pick confirmation card, bot-turn disabled rows, and pick-submission error toasts
- The `Targets` tab hydrates from `GET /drafts/:id/queue`, shows queued players in ascending rank order with position badges and dynasty values, removes picked targets on live `pick_made` events, and shares the same confirmation flow plus bot-turn disabled state
- `trade_offered` SSE events now open a blocking Radix trade modal over the live draft room; user-targeted trades render `Accept` / `Decline`, while bot-to-bot trades render `OK` / `Force Decline`, and each action posts `POST /drafts/:id/trade-response`
- The drafting view continues to show a `Connecting…` SSE badge until the first stream event arrives
- Failed draft creation shows an error toast and keeps the user on the config screen
- Exhausted SSE reconnect attempts surface a global toast instructing the user to refresh
- `draft_complete` SSE now renders a blocking completion banner over the live draft board so the final grid remains visible in the background
- The completion banner shows your team name and a `View Full History` CTA that opens the full History view with Pick Log, Roster View, and Trade Log tabs
- `New Draft` returns the user to the config screen
- The app now checks `GET /drafts` on load and routes to the Drafts List page when persisted drafts exist; the list shows Resume only for in-progress drafts, Review for every draft, a table loading skeleton during the bootstrap fetch, and an error toast on bootstrap failure
- Human live-browser verification of the board fill behavior remains required before merge per issue `#17`

Current UI commands:

| Command | Purpose |
|---|---|
| `npm run serve` | Start the local HTTP API server for draft creation and live `/drafts/:id/stream` SSE updates |
| `npm run dev` | Start the Vite React frontend from `/src/ui` |
| `npm run build` | Build the TypeScript backend output and the Vite UI bundle |
| `npm run preview` | Preview the built Vite UI bundle locally |
| `npm run test:ui` | Run the UI tests for config submission, draft board rendering, draft context, SSE lifecycle transitions, and draft history view |

Static build commands:

| Command | Purpose |
|---|---|
| `npm run build:static` | Build the browser-only GitHub Pages bundle into `dist/static/` |
| `npm run export:snapshot` | Refresh `data/snapshot.json` before building or deploying the static app |
| `npm run dev:static` | Run the static build in Vite dev mode for local testing (handles the `/dynastyff/` base path; `npx serve dist/static` will not work due to the base path) |

Static draft runtime modules:

- `src/draft/engine.ts` provides the pure in-memory draft state machine used by the browser-only build
- `src/draft/bot.ts` provides pure bot-pick selection logic shared by the static draft flow
- `src/ui-static/InMemoryDraftContext.tsx` runs the static draft lifecycle entirely in browser memory, including delayed bot turns and session-only completed-draft history

Current static app behavior:

- `src/ui-static/App.tsx` now supports the full `config → drafting → history` flow without an Express server running
- Bot turns in the static build resolve locally with a visible `1.5–3s` delay before each pick
- Completed static drafts are shown in reverse chronological order for the current browser session only
- Refreshing the page clears static history by design; no `localStorage` or other browser storage APIs are used

GitHub Actions deployment:

- `.github/workflows/etl-snapshot.yml` is a manual `workflow_dispatch` workflow that runs `npm run etl`, runs `npm run export:snapshot`, and commits `data/snapshot.json` back to the triggering branch only when the snapshot changed
- `.github/workflows/pages.yml` deploys `dist/static/` to GitHub Pages on every push to `main`, with `pages: write` on the build job for artifact upload and `pages: write` plus `id-token: write` on the deploy job
- Before the first Pages deployment succeeds, set the repository Pages source to `GitHub Actions` in GitHub Settings

Current draft API surface:

| Route | Purpose |
|---|---|
| `POST /drafts` | Create a new draft |
| `POST /drafts/:id/pick` | Submit the user's pick with HTTP-layer validation for turn order and player availability |
| `POST /drafts/:id/trade-response` | Resolve a paused bot-chain trade; declined outcomes are persisted, and accepted outcomes persist the `trades` row plus all asset transfers before the draft resumes |
| `POST /drafts/:id/queue` | Add a player to the user's queue or update that player's rank |
| `DELETE /drafts/:id/queue/:player_id` | Remove one player from the user's queue |
| `GET /drafts/:id/queue` | Read the user's queue ordered by ascending rank |
| `GET /drafts/:id/stream` | Subscribe to live draft SSE updates |
| `GET /drafts/:id/state` | Read the persisted draft snapshot for page refresh / hydration, including available players |
| `GET /drafts` | List persisted drafts for history / resume flows |

## ETL

`npm run etl` is a standalone script. It does not require the Express server to be running.

Current ETL scope:

- Runs KTC, FantasyCalc, and RosterAudit scrapers with Playwright headless Chromium
- Leaves DynastyDaddy disabled in the live ETL job for now due to scraper instability
- Caps scraper concurrency at 2 in-flight scrapers
- Filters players to `QB`, `RB`, `WR`, and `TE`
- Returns a shared scraper contract: players `{ name, position, nflTeam, age, isRookie, rawValue, adp }` and pick values `{ year, round, pickInRound?, rawValue }`
- Parses KTC and FantasyCalc future pick assets such as `2027 Early 1st` into ETL pick values keyed by `(year, round, pick_in_round)`, using `pick_in_round = 0` for round-level future picks
- Parses KTC startup slots named `Startup R.PP` and FantasyCalc / RosterAudit exact current-year slots named `YYYY Pick R.PP` into startup pick values with `pick_in_round >= 1`
- Assigns startup pick rows to the ETL run's current calendar year, logs and excludes malformed `Startup ...` KTC assets, and keeps startup plus future picks in the same per-source normalization pool
- Warns when an ETL run completes without any current-year startup pick rows so operators know to re-run ETL before starting a draft
- If at least one scraper succeeds, creates an `etl_runs` record and finalizes it with per-source success status on completion
- Persists raw per-source player and pick snapshots into `player_value_snapshots` and `pick_value_snapshots`
- Wraps each source's snapshot writes plus `players` / `pick_values` hot-path updates in a single transaction
- Normalizes player values and pick values per source to `0-9999`
- Logs and excludes individual scraper failures without aborting the full run; if all active scrapers fail, exits non-zero before writing the database
- Matches non-KTC players onto KTC-backed canonical rows with normalized-name exact match, Dice fuzzy match, and `player-aliases.json` overrides
- Aggregates player `dynasty_value` as the rounded mean of the non-NULL per-source normalized values
- Aggregates each `pick_values` `(year, round, pick_in_round)` row as the rounded mean of the current run's non-NULL per-source normalized pick values
- Treats a missing `player-aliases.json` as an empty alias list and fails fast on malformed alias JSON
- Upserts the local SQLite `players` and `pick_values` tables from the current ETL write path
- Exposes `npm run export:snapshot`, which writes `data/snapshot.json` from the current `players` table and round-level `pick_values` rows (`pick_in_round = 0`) for the static browser build
- Pins each new draft to the latest completed `etl_runs` record when one exists, preserving the value context used at draft creation time
- Reconstructs draft-scoped player `dynasty_value` reads from the pinned ETL run's `player_value_snapshots`, and falls back to `players` when a draft was created before any ETL run completed

`player-aliases.json` lives at the project root and supports:

```json
{
  "aliases": [
    {
      "canonical": "Odell Beckham Jr.",
      "variants": ["Odell Beckham", "OBJ"]
    }
  ]
}
```

## Project Structure

```
docs/
  high-level-design.md   # System overview and design decisions
  llds/                  # Low-level designs per component
    draft-engine.md
    bot-simulator.md
    advisor-agent.md
    data-model.md
    etl-pipeline.md
  specs/                 # EARS specs per component
src/
  db/
    init.ts              # SQLite schema init entry point
    schema.ts            # Shared Drizzle table definitions
  draft/
    bot-chain.ts         # Server-side bot chain coordinator for delayed bot turns and paused trade acknowledgements
    bot.ts               # Pure bot pick selection for the static/browser draft flow
    engine.ts            # Pure in-memory draft engine for the static/browser draft flow
    invariant.ts         # Shared invariant error for pure draft modules
    service.ts           # Transactional draft bootstrap, pick recording, trade execution, and status updates
    stream.ts            # Draft SSE snapshot queries and in-process event fanout
  ui/
    App.tsx              # Top-level React view-state shell
    main.tsx             # Vite React entry point
    index.html           # Vite HTML entry
    styles.css           # Tailwind entry stylesheet
    components/
      DraftBoard.tsx     # Draft board grid with snake-order slot rendering
      DraftConfigScreen.tsx # League configuration form
      HistoryView.tsx    # Post-draft history view with Pick Log, Roster View, and Trade Log tabs
    context/
      DraftContext.tsx   # Draft state management, SSE lifecycle, and HTTP draft actions
```

## Development Workflow

| Command | Purpose |
|---|---|
| `/grill-me` | Stress-test a feature idea or design — Claude interviews you until the plan is solid |
| `/to-issues @<spec-or-lld>` | Break a spec or LLD into independently-grabbable GitHub issues |
| `./scripts/do-work.sh` | Spin up an agent to implement an open issue (default: claude; also: `codex`, `pi`) |
| `./scripts/do-work.sh pi` | Same, but route to the `pi` harness (deepseek via default config) |
| `./scripts/do-work.sh codex` | Same, but route to Codex |
| `./scripts/do-work.sh claude` | Same, but explicitly use Claude |

## Architecture

See [`docs/high-level-design.md`](docs/high-level-design.md) for the full system design.

Component deep-dives: [`docs/llds/`](docs/llds/)
