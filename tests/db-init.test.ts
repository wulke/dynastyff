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
// @spec DFF-HIST-001
// @spec DFF-HIST-010
// @spec DFF-HIST-011
// @spec DFF-HIST-012
// @spec DFF-HIST-020
// @spec DFF-HIST-021
// @spec DFF-HIST-022
// @spec DFF-HIST-030
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

// @spec DFF-DATA-001
// @spec DFF-DATA-020
// @spec DFF-DATA-030
// @spec DFF-DATA-040
// @spec DFF-DATA-050
// @spec DFF-DATA-060
// @spec DFF-DATA-070
// @spec DFF-DATA-080
// @spec DFF-DATA-090
// @spec DFF-HIST-001
// @spec DFF-HIST-010
// @spec DFF-HIST-020
test('db:init creates all tables defined by the data-model LLD', () => {
  withDatabase((db) => {
    const tableNames = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    assert.deepEqual(tableNames, [
      'draft_order',
      'drafts',
      'etl_runs',
      'pick_value_snapshots',
      'pick_values',
      'picks',
      'player_value_snapshots',
      'players',
      'roster_players',
      'team_pick_assets',
      'teams',
      'trades',
      'user_queue',
    ]);
  });
});

// @spec DFF-DATA-001
// @spec DFF-DATA-002
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

// @spec DFF-DATA-010
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

// @spec DFF-DATA-001
// @spec DFF-DATA-010
// @spec DFF-DATA-020
// @spec DFF-HIST-001
// @spec DFF-HIST-010
// @spec DFF-HIST-020
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

// @spec DFF-HIST-011
// @spec DFF-HIST-012
// @spec DFF-HIST-021
// @spec DFF-HIST-022
test('history tables enforce documented source enums and unique keys', () => {
  withDatabase((db) => {
    db.prepare(
      `INSERT INTO etl_runs (
        id, started_at, completed_at, sources_attempted, sources_succeeded
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      'run-1',
      '2026-05-19T00:00:00.000Z',
      '2026-05-19T00:30:00.000Z',
      '["ktc","fantasycalc","dynastydaddy","rosteraudit"]',
      '["ktc"]',
    );

    db.prepare(
      `INSERT INTO players (
        id, name, position, nfl_team, age, is_rookie, dynasty_value, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('player-1', 'Valid Player', 'QB', 'BUF', 25.5, 0, 5000, '2026-05-18T00:00:00.000Z');

    db.prepare(
      `INSERT INTO player_value_snapshots (
        id, run_id, player_id, source, raw_value
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run('player-snapshot-1', 'run-1', 'player-1', 'ktc', 9999);

    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO player_value_snapshots (
            id, run_id, player_id, source, raw_value
          ) VALUES (?, ?, ?, ?, ?)`,
        ).run('player-snapshot-2', 'run-1', 'player-1', 'ktc', 8888),
      /UNIQUE constraint failed: player_value_snapshots.run_id, player_value_snapshots.player_id, player_value_snapshots.source/,
    );

    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO player_value_snapshots (
            id, run_id, player_id, source, raw_value
          ) VALUES (?, ?, ?, ?, ?)`,
        ).run('player-snapshot-3', 'run-1', 'player-1', 'bad-source', 7777),
      /CHECK constraint failed/,
    );

    db.prepare(
      `INSERT INTO pick_value_snapshots (
        id, run_id, year, round, source, raw_value
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('pick-snapshot-1', 'run-1', 2027, 1, 'ktc', 4500);

    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO pick_value_snapshots (
            id, run_id, year, round, source, raw_value
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run('pick-snapshot-2', 'run-1', 2027, 1, 'ktc', 4300),
      /UNIQUE constraint failed: pick_value_snapshots.run_id, pick_value_snapshots.year, pick_value_snapshots.round, pick_value_snapshots.source/,
    );

    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO pick_value_snapshots (
            id, run_id, year, round, source, raw_value
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run('pick-snapshot-3', 'run-1', 2027, 1, 'bad-source', 4200),
      /CHECK constraint failed/,
    );
  });
});

// @spec DFF-HIST-010
// @spec DFF-HIST-020
test('history snapshot tables enforce foreign keys and cascade deletes from etl_runs', () => {
  withDatabase((db) => {
    db.prepare(
      `INSERT INTO etl_runs (
        id, started_at, completed_at, sources_attempted, sources_succeeded
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      'run-1',
      '2026-05-19T00:00:00.000Z',
      '2026-05-19T00:30:00.000Z',
      '["ktc","fantasycalc","dynastydaddy","rosteraudit"]',
      '["ktc"]',
    );

    db.prepare(
      `INSERT INTO players (
        id, name, position, nfl_team, age, is_rookie, dynasty_value, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('player-1', 'Valid Player', 'QB', 'BUF', 25.5, 0, 5000, '2026-05-18T00:00:00.000Z');

    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO player_value_snapshots (
            id, run_id, player_id, source, raw_value
          ) VALUES (?, ?, ?, ?, ?)`,
        ).run('player-snapshot-missing-player', 'run-1', 'missing-player', 'fantasycalc', 5100),
      /FOREIGN KEY constraint failed/,
    );

    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO player_value_snapshots (
            id, run_id, player_id, source, raw_value
          ) VALUES (?, ?, ?, ?, ?)`,
        ).run('player-snapshot-4', 'missing-run', 'player-1', 'fantasycalc', 5000),
      /FOREIGN KEY constraint failed/,
    );

    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO pick_value_snapshots (
            id, run_id, year, round, source, raw_value
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run('pick-snapshot-missing-run', 'missing-run', 2027, 2, 'fantasycalc', 4100),
      /FOREIGN KEY constraint failed/,
    );

    db.prepare(
      `INSERT INTO etl_runs (
        id, started_at, completed_at, sources_attempted, sources_succeeded
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      'run-cascade',
      '2026-05-19T01:00:00.000Z',
      '2026-05-19T01:30:00.000Z',
      '["ktc","fantasycalc","dynastydaddy","rosteraudit"]',
      '["ktc","fantasycalc"]',
    );

    db.prepare(
      `INSERT INTO player_value_snapshots (
        id, run_id, player_id, source, raw_value
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run('player-snapshot-cascade', 'run-cascade', 'player-1', 'fantasycalc', 5050);

    db.prepare(
      `INSERT INTO pick_value_snapshots (
        id, run_id, year, round, source, raw_value
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('pick-snapshot-cascade', 'run-cascade', 2028, 1, 'fantasycalc', 4400);

    db.prepare('DELETE FROM etl_runs WHERE id = ?').run('run-cascade');

    const remainingPlayerSnapshots = db
      .prepare('SELECT COUNT(*) AS count FROM player_value_snapshots WHERE run_id = ?')
      .get('run-cascade') as { count: number };
    const remainingPickSnapshots = db
      .prepare('SELECT COUNT(*) AS count FROM pick_value_snapshots WHERE run_id = ?')
      .get('run-cascade') as { count: number };

    assert.equal(remainingPlayerSnapshots.count, 0);
    assert.equal(remainingPickSnapshots.count, 0);
  });
});

// @spec DFF-HIST-030
test('drafts includes nullable etl_run_id foreign key to etl_runs', () => {
  withDatabase((db) => {
    const columns = db.prepare("PRAGMA table_info('drafts')").all() as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;
    const etlRunColumn = columns.find((column) => column.name === 'etl_run_id');

    assert.equal(etlRunColumn?.type, 'TEXT');
    assert.equal(etlRunColumn?.notnull, 0);

    const foreignKeys = db.prepare("PRAGMA foreign_key_list('drafts')").all() as Array<{
      from: string;
      table: string;
      to: string;
    }>;

    const etlRunForeignKey = foreignKeys.find((foreignKey) => foreignKey.from === 'etl_run_id');

    assert.equal(etlRunForeignKey?.table, 'etl_runs');
    assert.equal(etlRunForeignKey?.to, 'id');

    db.prepare(
      `INSERT INTO drafts (
        id,
        created_at,
        completed_at,
        status,
        team_count,
        rounds,
        scoring_format,
        user_pick_position,
        future_pick_years,
        future_pick_rounds,
        roster_config,
        etl_run_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'draft-with-null-run',
      '2026-05-19T00:00:00.000Z',
      null,
      'in_progress',
      12,
      20,
      'ppr',
      1,
      3,
      3,
      '{"QB":1,"RB":2,"WR":3,"TE":1,"FLEX":2,"SF":1,"BN":10}',
      null,
    );

    db.prepare(
      `INSERT INTO etl_runs (
        id, started_at, completed_at, sources_attempted, sources_succeeded
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      'run-1',
      '2026-05-19T01:00:00.000Z',
      '2026-05-19T01:30:00.000Z',
      '["ktc","fantasycalc","dynastydaddy","rosteraudit"]',
      '["ktc","fantasycalc"]',
    );

    db.prepare(
      `INSERT INTO drafts (
        id,
        created_at,
        completed_at,
        status,
        team_count,
        rounds,
        scoring_format,
        user_pick_position,
        future_pick_years,
        future_pick_rounds,
        roster_config,
        etl_run_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'draft-with-run',
      '2026-05-19T02:00:00.000Z',
      null,
      'in_progress',
      12,
      20,
      'ppr',
      2,
      3,
      3,
      '{"QB":1,"RB":2,"WR":3,"TE":1,"FLEX":2,"SF":1,"BN":10}',
      'run-1',
    );

    db.prepare('DELETE FROM etl_runs WHERE id = ?').run('run-1');

    const deletedRunDraft = db
      .prepare('SELECT etl_run_id FROM drafts WHERE id = ?')
      .get('draft-with-run') as { etl_run_id: string | null };

    assert.equal(deletedRunDraft.etl_run_id, null);

    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO drafts (
            id,
            created_at,
            completed_at,
            status,
            team_count,
            rounds,
            scoring_format,
            user_pick_position,
            future_pick_years,
            future_pick_rounds,
            roster_config,
            etl_run_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          'draft-with-missing-run',
          '2026-05-19T03:00:00.000Z',
          null,
          'in_progress',
          12,
          20,
          'ppr',
          3,
          3,
          3,
          '{"QB":1,"RB":2,"WR":3,"TE":1,"FLEX":2,"SF":1,"BN":10}',
          'missing-run',
        ),
      /FOREIGN KEY constraint failed/,
    );
  });
});
