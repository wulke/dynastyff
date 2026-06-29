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

The Vite dev server proxies `/drafts` and `/configs` requests to `http://localhost:3001`, so both commands should be running for draft creation, saved-config reads/writes, state/history reads, and the live draft SSE stream.

Open the Vite URL shown in the terminal to begin.

## Usage

1. **Resume or start** — if saved drafts exist, the Drafts List page lets you resume an in-progress draft, review a completed one, or start a new draft. Otherwise you land on the config screen.
2. **Configure your league** — set team count, roster slots, scoring, and your draft position, or load a saved league template.
3. **Draft** — the app runs a full snake draft; bots pick for the other 11 teams automatically, may proactively bring you trade offers during their turns, and will evaluate your counters before the bot chain resumes.
4. **Use the advisor (optional)** — on any pick, ask Claude to **Advise me** for a recommendation, or **Grill me** to pressure-test your own reasoning.
5. **Review your results** — once the draft completes, open the **Draft Grade Summary** for your overall grade, the room leaderboard, and your final roster, then drill into **Full History** (Pick Log / Roster View / Trade Log) if you want it.

A GitHub Pages–hosted static build (no backend, no advisor) is also available for offline practice; see `docs/llds/static-build.md`.

## Configuration

| Setting | Default | Notes |
|---|---|---|
| Teams | 12 | |
| Draft rounds | 20 | |
| Scoring | PPR | |
| User pick position | Configurable | Selected on the config screen |
| Future pick years | 3 | |

All settings are configurable on the league config screen before starting a draft. The advisor requires `ANTHROPIC_API_KEY` set in `.env`; the core draft loop runs fully offline.

Bot decision-making (bounded need-bias pick scoring, trade evaluation, archetype tuning in `config/archetypes.json`) is documented in [`docs/llds/bot-simulator.md`](docs/llds/bot-simulator.md). Draft engine and API behavior is documented in [`docs/llds/draft-engine.md`](docs/llds/draft-engine.md). UI behavior is documented in [`docs/llds/ui.md`](docs/llds/ui.md).

## ETL

`npm run etl` scrapes player and pick values from KTC, FantasyCalc, and RosterAudit, normalizes them, and writes the local `players` and `pick_values` tables. It's a standalone script and doesn't require the Express server to be running. Run `npm run export:snapshot` afterward to refresh `data/snapshot.json` for the static build.

Full scraper, normalization, and matching behavior is documented in [`docs/llds/etl-pipeline.md`](docs/llds/etl-pipeline.md).

`player-aliases.json` lives at the project root and lets you map scraper name variants onto a canonical player:

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

## Commands

| Command | Purpose |
|---|---|
| **Setup** | |
| `npm run db:init` | Initialize the local SQLite schema |
| `npm run etl` | Scrape and normalize player/pick values |
| `npm run export:snapshot` | Refresh `data/snapshot.json` for the static build |
| **Dev** | |
| `npm run serve` | Start the local HTTP API server and SSE stream |
| `npm run dev` | Start the Vite React frontend |
| `npm run dev:static` | Run the static (browser-only) build in Vite dev mode |
| **Test** | |
| `npm run test` | Run the full server + UI test suite |
| `npm run test:server` | Run backend tests |
| `npm run test:ui` | Run UI tests |
| `npm run test:coverage` | Run tests with coverage thresholds |
| **Build** | |
| `npm run build` | Build the TypeScript backend and the Vite UI bundle |
| `npm run build:static` | Build the browser-only GitHub Pages bundle into `dist/static/` |
| `npm run preview` | Preview the built Vite UI bundle locally |
| **Workflow** | |
| `/grill-me` | Stress-test a feature idea or design before implementing |
| `/to-issues @<spec-or-lld>` | Break a spec or LLD into independently-grabbable GitHub issues |
| `./scripts/do-work.sh [claude\|codex\|pi]` | Spin up an agent to implement an open issue |

## Project Structure

```
docs/
  high-level-design.md   # System overview and design decisions
  llds/                   # Low-level designs per component
  specs/                  # EARS specs per component
config/
  archetypes.json         # Bot archetype tuning (trade thresholds, bounded pick-scoring bias bands)
src/
  db/                     # SQLite schema and init
  draft/                  # Draft engine, bot logic, and trade/transaction service
  etl/                    # Scraper pipeline and snapshot export
  server/                 # Express API and SSE stream
  ui/                      # React frontend (HTTP-backed)
  ui-static/              # Browser-only frontend for the GitHub Pages build
tests/                    # Server and UI test suites
.github/workflows/        # ETL snapshot refresh and Pages deploy
```

## Architecture

See [`docs/high-level-design.md`](docs/high-level-design.md) for the full system design, and [`docs/llds/`](docs/llds/) for component deep-dives.
