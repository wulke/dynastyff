// @spec DFF-DATA-001
// @spec DFF-DATA-002
// @spec DFF-DATA-010
// @spec DFF-DATA-020
// @spec DFF-DATA-021
// @spec DFF-DATA-022
// @spec DFF-DATA-030
// @spec DFF-DATA-033
// @spec DFF-DATA-040
// @spec DFF-DATA-050
// @spec DFF-DATA-060
// @spec DFF-DATA-070
// @spec DFF-DATA-080
// @spec DFF-DATA-081
// @spec DFF-DATA-090
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export const defaultDatabasePath = path.resolve(process.cwd(), 'data', 'dynastyff.sqlite');

export function resolveDatabasePath(inputPath = process.env.DYNASTYFF_DB_PATH): string {
  return inputPath ? path.resolve(process.cwd(), inputPath) : defaultDatabasePath;
}

const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      position TEXT NOT NULL CHECK (position IN ('QB', 'RB', 'WR', 'TE')),
      nfl_team TEXT,
      age REAL,
      is_rookie INTEGER NOT NULL DEFAULT 0 CHECK (is_rookie IN (0, 1)),
      dynasty_value INTEGER NOT NULL,
      value_ktc INTEGER,
      value_fantasycalc INTEGER,
      value_dynastydaddy INTEGER,
      value_rosteraudit INTEGER,
      adp REAL,
      updated_at TEXT NOT NULL
    )
  `,
  'CREATE UNIQUE INDEX IF NOT EXISTS players_name_position_unique ON players (name, position)',
  'CREATE INDEX IF NOT EXISTS players_position_idx ON players (position)',
  `
    CREATE TABLE IF NOT EXISTS pick_values (
      id TEXT PRIMARY KEY NOT NULL,
      year INTEGER NOT NULL,
      round INTEGER NOT NULL,
      dynasty_value INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  'CREATE UNIQUE INDEX IF NOT EXISTS pick_values_year_round_unique ON pick_values (year, round)',
  `
    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
      team_count INTEGER NOT NULL DEFAULT 12,
      rounds INTEGER NOT NULL DEFAULT 20,
      scoring_format TEXT NOT NULL DEFAULT 'ppr' CHECK (scoring_format IN ('ppr', 'half_ppr', 'standard')),
      user_pick_position INTEGER NOT NULL,
      future_pick_years INTEGER NOT NULL DEFAULT 3,
      future_pick_rounds INTEGER NOT NULL,
      roster_config TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY NOT NULL,
      draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      is_user INTEGER NOT NULL DEFAULT 0 CHECK (is_user IN (0, 1)),
      pick_position INTEGER NOT NULL,
      archetype TEXT CHECK (archetype IS NULL OR archetype IN ('win_now', 'punt', 'rb_heavy', 'qb_early', 'bpa', 'balanced'))
    )
  `,
  'CREATE INDEX IF NOT EXISTS teams_draft_id_idx ON teams (draft_id)',
  `
    CREATE TABLE IF NOT EXISTS draft_order (
      id TEXT PRIMARY KEY NOT NULL,
      draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
      pick_number INTEGER NOT NULL,
      round INTEGER NOT NULL,
      pick_in_round INTEGER NOT NULL,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT
    )
  `,
  'CREATE UNIQUE INDEX IF NOT EXISTS draft_order_draft_pick_number_unique ON draft_order (draft_id, pick_number)',
  'CREATE UNIQUE INDEX IF NOT EXISTS draft_order_draft_round_pick_in_round_unique ON draft_order (draft_id, round, pick_in_round)',
  'CREATE INDEX IF NOT EXISTS draft_order_team_id_idx ON draft_order (team_id)',
  `
    CREATE TABLE IF NOT EXISTS picks (
      id TEXT PRIMARY KEY NOT NULL,
      draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
      draft_order_id TEXT NOT NULL REFERENCES draft_order(id) ON DELETE RESTRICT,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
      pick_number INTEGER NOT NULL,
      round INTEGER NOT NULL,
      picked_at TEXT NOT NULL
    )
  `,
  'CREATE UNIQUE INDEX IF NOT EXISTS picks_draft_order_id_unique ON picks (draft_order_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS picks_draft_player_unique ON picks (draft_id, player_id)',
  'CREATE INDEX IF NOT EXISTS picks_draft_id_idx ON picks (draft_id)',
  'CREATE INDEX IF NOT EXISTS picks_team_id_idx ON picks (team_id)',
  `
    CREATE TABLE IF NOT EXISTS roster_players (
      id TEXT PRIMARY KEY NOT NULL,
      draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE RESTRICT
    )
  `,
  'CREATE UNIQUE INDEX IF NOT EXISTS roster_players_draft_player_unique ON roster_players (draft_id, player_id)',
  'CREATE INDEX IF NOT EXISTS roster_players_team_id_idx ON roster_players (team_id)',
  `
    CREATE TABLE IF NOT EXISTS team_pick_assets (
      id TEXT PRIMARY KEY NOT NULL,
      draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
      year INTEGER NOT NULL,
      round INTEGER NOT NULL
    )
  `,
  'CREATE UNIQUE INDEX IF NOT EXISTS team_pick_assets_draft_year_round_team_unique ON team_pick_assets (draft_id, team_id, year, round)',
  'CREATE INDEX IF NOT EXISTS team_pick_assets_team_id_idx ON team_pick_assets (team_id)',
  `
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY NOT NULL,
      draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
      pick_number INTEGER NOT NULL,
      round INTEGER NOT NULL,
      initiating_team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
      receiving_team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
      assets_sent TEXT NOT NULL,
      assets_received TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('accepted', 'declined', 'force_declined')),
      created_at TEXT NOT NULL
    )
  `,
  'CREATE INDEX IF NOT EXISTS trades_draft_id_idx ON trades (draft_id)',
  `
    CREATE TABLE IF NOT EXISTS user_queue (
      id TEXT PRIMARY KEY NOT NULL,
      draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
      rank INTEGER NOT NULL
    )
  `,
  'CREATE UNIQUE INDEX IF NOT EXISTS user_queue_draft_player_unique ON user_queue (draft_id, player_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS user_queue_draft_rank_unique ON user_queue (draft_id, rank)'
];

export function initializeDatabase(databasePath = resolveDatabasePath()): string {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const db = new Database(databasePath);

  try {
    db.pragma('foreign_keys = ON');
    db.transaction(() => {
      for (const statement of schemaStatements) {
        db.exec(statement);
      }
    })();
  } finally {
    db.close();
  }

  return databasePath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const databasePath = initializeDatabase();
  console.log(`[db:init] initialized schema at ${databasePath}`);
}
