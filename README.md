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

# Start the backend API server
npm run serve

# Start the UI dev server in a second terminal
npm run dev
```

The Vite dev server proxies `/drafts` requests to `http://localhost:3001`, so both commands should be running for draft creation, state/history reads, and the live draft SSE stream.

Open the Vite URL shown in the terminal to begin.

## Usage

1. **Configure your league** — set team count, roster slots, scoring, and your draft position on the config screen.
2. **Start a mock draft** — the app runs a full snake draft; bots pick for the other 11 teams automatically.
3. **Use the advisor (optional)** — on any pick, choose:
   - **Advise me** — Claude recommends a pick with dynasty value reasoning.
   - **Grill me** — share your thinking; Claude pushes back.
4. **Review history** — completed mock drafts are saved locally and queryable from the draft history view.

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

Issues `#13` and `#15` establish the initial frontend shell under `/src/ui`:

- `Config Screen` renders on first load as a real league configuration form
- `Start Draft` submits camelCase `POST /drafts` JSON matching the UI form state
- Successful draft creation transitions the UI into the drafting view
- Failed draft creation shows an error toast and keeps the user on the config screen
- `Complete Draft` and `New Draft` remain scaffold controls for later UI slices
- Live browser verification of draft creation remains blocked until the HTTP draft route is implemented; current verification for this slice is mocked at the UI test layer

Current UI commands:

| Command | Purpose |
|---|---|
| `npm run serve` | Start the local HTTP API server for draft creation and live `/drafts/:id/stream` SSE updates |
| `npm run dev` | Start the Vite React frontend from `/src/ui` |
| `npm run build` | Build the TypeScript backend output and the Vite UI bundle |
| `npm run preview` | Preview the built Vite UI bundle locally |
| `npm run test:ui` | Run the UI tests for config submission and view-state transitions |

Current draft API surface:

| Route | Purpose |
|---|---|
| `POST /drafts` | Create a new draft |
| `GET /drafts/:id/stream` | Subscribe to live draft SSE updates |
| `GET /drafts/:id/state` | Read the persisted draft snapshot for page refresh / hydration |
| `GET /drafts` | List persisted drafts for history / resume flows |

## ETL

`npm run etl` is a standalone script. It does not require the Express server to be running.

Current ETL scope:

- Runs KTC, FantasyCalc, and RosterAudit scrapers with Playwright headless Chromium
- Leaves DynastyDaddy disabled in the live ETL job for now due to scraper instability
- Caps scraper concurrency at 2 in-flight scrapers
- Filters players to `QB`, `RB`, `WR`, and `TE`
- Returns a shared scraper contract: players `{ name, position, nflTeam, age, isRookie, rawValue, adp }` and pick values `{ year, round, rawValue }`
- Creates an `etl_runs` record at ETL start and finalizes it with per-source success status on completion
- Persists raw per-source player and pick snapshots into `player_value_snapshots` and `pick_value_snapshots`
- Wraps each source's snapshot writes plus `players` / `pick_values` hot-path updates in a single transaction
- Normalizes player values and pick values per source to `0-9999`
- Matches non-KTC players onto KTC-backed canonical rows with normalized-name exact match, Dice fuzzy match, and `player-aliases.json` overrides
- Aggregates player `dynasty_value` as the rounded mean of the non-NULL per-source normalized values
- Aggregates each `pick_values` `(year, round)` row as the rounded mean of the current run's non-NULL per-source normalized pick values
- Treats a missing `player-aliases.json` as an empty alias list and fails fast on malformed alias JSON
- Upserts the local SQLite `players` and `pick_values` tables from the current ETL write path
- Pins each new draft to the latest completed `etl_runs` record when one exists, preserving the value context used at draft creation time

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
    service.ts           # Transactional draft bootstrap, pick recording, and status updates
    stream.ts            # Draft SSE snapshot queries and in-process event fanout
  ui/
    App.tsx              # Top-level React view-state shell
    main.tsx             # Vite React entry point
    index.html           # Vite HTML entry
    styles.css           # Tailwind entry stylesheet
```

## Development Workflow

| Command | Purpose |
|---|---|
| `/grill-me` | Stress-test a feature idea or design — Claude interviews you until the plan is solid |
| `/to-issues @<spec-or-lld>` | Break a spec or LLD into independently-grabbable GitHub issues |
| `./scripts/do-work.sh` | Spin up an agent to implement an open issue |

## Architecture

See [`docs/high-level-design.md`](docs/high-level-design.md) for the full system design.

Component deep-dives: [`docs/llds/`](docs/llds/)
