import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { createDatabase } from '../src/db/client.js';
import { migrateDatabase } from '../src/db/migrate.js';

function createPreDevyFixture(options?: { includesDevyName?: boolean }): { tempDir: string; dbPath: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-db-migrate-'));
  const dbPath = path.join(tempDir, 'legacy.sqlite');
  const sqlite = new Database(dbPath);

  try {
    sqlite.exec(`
      CREATE TABLE sleeper_rosters (
        id TEXT PRIMARY KEY NOT NULL,
        league_id TEXT NOT NULL,
        roster_id INTEGER NOT NULL,
        sleeper_player_id TEXT NOT NULL,
        players_id TEXT,
        slot_type TEXT NOT NULL,${options?.includesDevyName ? '\n        devy_name TEXT,' : ''}
        synced_at TEXT NOT NULL
      );
      CREATE TABLE pick_values (
        id TEXT PRIMARY KEY NOT NULL,
        year INTEGER NOT NULL,
        round INTEGER NOT NULL,
        pick_in_round INTEGER NOT NULL DEFAULT 0,
        dynasty_value INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE etl_runs (
        id TEXT PRIMARY KEY NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        sources_attempted TEXT NOT NULL,
        sources_succeeded TEXT NOT NULL
      );
    `);
    sqlite
      .prepare(
        'INSERT INTO sleeper_rosters (id, league_id, roster_id, sleeper_player_id, players_id, slot_type, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('roster-1', 'league-1', 1, 'sleeper-1', 'player-1', 'taxi', '2026-10-10T00:00:00.000Z');
    sqlite
      .prepare(
        'INSERT INTO pick_values (id, year, round, pick_in_round, dynasty_value, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('pick-1', 2027, 1, 0, 6500, '2026-10-10T00:00:00.000Z');
    sqlite
      .prepare(
        'INSERT INTO etl_runs (id, started_at, completed_at, sources_attempted, sources_succeeded) VALUES (?, ?, ?, ?, ?)',
      )
      .run('run-1', '2026-10-10T00:00:00.000Z', null, '["ktc"]', '["ktc"]');
  } finally {
    sqlite.close();
  }

  return { tempDir, dbPath };
}

// @spec DFF-DATA-097
// @spec DFF-DATA-098
test('db:migrate upgrades a pre-devy database without losing Sleeper, pick-value, or ETL rows', () => {
  const { tempDir, dbPath } = createPreDevyFixture();

  try {
    migrateDatabase(dbPath);

    const sqlite = new Database(dbPath);
    try {
      const columns = sqlite.prepare("PRAGMA table_info('sleeper_rosters')").all() as Array<{ name: string }>;
      assert.equal(columns.some((column) => column.name === 'devy_name'), true);
      assert.deepEqual(
        sqlite.prepare('SELECT id, sleeper_player_id, devy_name FROM sleeper_rosters').all(),
        [{ id: 'roster-1', sleeper_player_id: 'sleeper-1', devy_name: null }],
      );
      assert.deepEqual(sqlite.prepare('SELECT id, dynasty_value FROM pick_values').all(), [
        { id: 'pick-1', dynasty_value: 6500 },
      ]);
      assert.deepEqual(sqlite.prepare('SELECT id, sources_succeeded FROM etl_runs').all(), [
        { id: 'run-1', sources_succeeded: '["ktc"]' },
      ]);
    } finally {
      sqlite.close();
    }

    assert.doesNotThrow(() => migrateDatabase(dbPath));
    const currentDatabase = createDatabase(dbPath);
    currentDatabase.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// @spec DFF-DATA-097
// @spec DFF-DATA-098
test('db:migrate baselines an already-pushed devy schema without replaying the devy migration', () => {
  const { tempDir, dbPath } = createPreDevyFixture({ includesDevyName: true });

  try {
    assert.doesNotThrow(() => migrateDatabase(dbPath));

    const currentDatabase = createDatabase(dbPath);
    try {
      assert.deepEqual(
        currentDatabase.prepare('SELECT sleeper_player_id, devy_name FROM sleeper_rosters').all(),
        [{ sleeper_player_id: 'sleeper-1', devy_name: null }],
      );
    } finally {
      currentDatabase.close();
    }

    assert.doesNotThrow(() => migrateDatabase(dbPath));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// @spec DFF-DATA-099
// @spec DFF-DATA-100
test('a missing database fails fast with the fresh-database command without creating a file', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-db-missing-'));
  const dbPath = path.join(tempDir, 'missing.sqlite');

  try {
    assert.throws(
      () => createDatabase(dbPath),
      /Database schema is not initialized\. Run `npm run db:init` to create a fresh database\./,
    );
    assert.equal(fs.existsSync(dbPath), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// @spec DFF-DATA-099
test('database entry points fail fast with the schema upgrade command', () => {
  const { tempDir, dbPath } = createPreDevyFixture();

  try {
    assert.throws(() => createDatabase(dbPath), /Database schema is out of date\. Run `npm run db:migrate`\./);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
