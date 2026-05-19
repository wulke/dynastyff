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

# Populate the database (scrapes KTC, FantasyCalc, DynastyDaddy, RosterAudit)
npm run etl

# Start the UI dev server
npm run dev
```

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
| User pick position | Random | |
| Future pick years | 3 | |

All settings are configurable on the league config screen before starting a draft.

The advisor requires `ANTHROPIC_API_KEY` set in `.env`. The core draft loop runs fully offline.

## UI Scaffold

Issue `#13` adds the initial frontend shell under `/src/ui`:

- `Config Screen` renders on first load
- `Start Draft` transitions the shell into the drafting view
- `Complete Draft` transitions the shell into the history view
- `New Draft` resets the shell back to config

Current UI commands:

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Vite React frontend from `/src/ui` |
| `npm run build` | Build the TypeScript backend output and the Vite UI bundle |
| `npm run preview` | Preview the built Vite UI bundle locally |
| `npm run test:ui` | Run the UI scaffold tests for view-state transitions |

## ETL

`npm run etl` is a standalone script. It does not require the Express server to be running.

Current ETL scope:

- Scrapes KTC player values with Playwright
- Filters players to `QB`, `RB`, `WR`, and `TE`
- Normalizes KTC values to `0-9999`
- Upserts the local SQLite `players` table

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
