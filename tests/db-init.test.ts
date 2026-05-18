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
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { initializeDatabase } from '../src/db/init.js';

function withDatabase(run: (db: Database.Database, dbPath: string) => void): void {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-db-init-'));
  const dbPath = path.join(tempDir, 'test.sqlite');
  initializeDatabase(dbPath);
  const db = new Database(dbPath);

  try {
    db.pragma('foreign_keys = ON');
    run(db, dbPath);
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('db:init creates all tables defined by the data-model LLD', () => {
  withDatabase((db) => {
    const tableNames = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    assert.deepEqual(tableNames, [
      'draft_order',
      'drafts',
      'pick_values',
      'picks',
      'players',
      'roster_players',
      'team_pick_assets',
      'teams',
      'trades',
      'user_queue',
    ]);
  });
});

test('players includes the documented ETL columns and constraints', () => {
  withDatabase((db) => {
    const columns = db.prepare("PRAGMA table_info('players')").all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;

    const columnMap = new Map(columns.map((column) => [column.name, column]));

    assert.equal(columnMap.get('id')?.pk, 1);
    assert.equal(columnMap.get('name')?.type, 'TEXT');
    assert.equal(columnMap.get('position')?.notnull, 1);
    assert.equal(columnMap.get('value_ktc')?.type, 'INTEGER');
    assert.equal(columnMap.get('value_fantasycalc')?.type, 'INTEGER');
    assert.equal(columnMap.get('value_dynastydaddy')?.type, 'INTEGER');
    assert.equal(columnMap.get('value_rosteraudit')?.type, 'INTEGER');
    assert.equal(columnMap.get('dynasty_value')?.notnull, 1);
    assert.equal(columnMap.get('adp')?.type, 'REAL');
    assert.equal(columnMap.get('updated_at')?.notnull, 1);

    db.prepare(
      `INSERT INTO players (
        id, name, position, nfl_team, age, is_rookie, dynasty_value, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('player-1', 'Valid Player', 'QB', 'BUF', 25.5, 0, 5000, '2026-05-18T00:00:00.000Z');

    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO players (
            id, name, position, nfl_team, age, is_rookie, dynasty_value, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run('player-2', 'Bad Position', 'K', 'BUF', 27, 0, 4000, '2026-05-18T00:00:00.000Z'),
      /CHECK constraint failed/,
    );
  });
});

test('pick_values enforces uniqueness on (year, round)', () => {
  withDatabase((db) => {
    db.prepare(
      'INSERT INTO pick_values (id, year, round, dynasty_value, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('pick-1', 2027, 1, 6500, '2026-05-18T00:00:00.000Z');

    assert.throws(
      () =>
        db.prepare(
          'INSERT INTO pick_values (id, year, round, dynasty_value, updated_at) VALUES (?, ?, ?, ?, ?)',
        ).run('pick-2', 2027, 1, 7000, '2026-05-18T01:00:00.000Z'),
      /UNIQUE constraint failed: pick_values.year, pick_values.round/,
    );
  });
});

test('db:init can build a fresh database file in one command path', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-db-file-'));
  const dbPath = path.join(tempDir, 'nested', 'dynastyff.sqlite');

  try {
    const initializedPath = initializeDatabase(dbPath);
    assert.equal(initializedPath, dbPath);
    assert.equal(fs.existsSync(dbPath), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
