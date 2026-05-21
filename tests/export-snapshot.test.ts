// @spec DFF-STATIC-010
// @spec DFF-STATIC-011
// @spec DFF-STATIC-012
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { initializeDatabase } from '../src/db/init.js';

type TempDatabase = {
  db: Database.Database;
  dbPath: string;
  tempDir: string;
  cleanup: () => void;
};

function createTempDatabase(): TempDatabase {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-export-snapshot-'));
  const dbPath = path.join(tempDir, 'test.sqlite');
  initializeDatabase(dbPath);
  const db = new Database(dbPath);

  db.pragma('foreign_keys = ON');

  return {
    db,
    dbPath,
    tempDir,
    cleanup: () => {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function runExportSnapshot(databasePath: string, outputPath: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/etl/export-snapshot.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DYNASTYFF_DB_PATH: databasePath,
      DYNASTYFF_SNAPSHOT_PATH: outputPath,
    },
    encoding: 'utf8',
  });
}

// @spec DFF-STATIC-010
test('package.json exposes npm run export:snapshot as a standalone entry point', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
  ) as {
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.scripts?.['export:snapshot'], 'node --import tsx src/etl/export-snapshot.ts');
});

// @spec DFF-STATIC-010
// @spec DFF-STATIC-011
test('export-snapshot writes the documented snapshot shape from players and pick_values', () => {
  const { db, dbPath, tempDir, cleanup } = createTempDatabase();
  const outputPath = path.join(tempDir, 'snapshot.json');

  try {
    db.prepare(
      `INSERT INTO players (
        id, name, position, nfl_team, age, is_rookie, dynasty_value, value_ktc, adp, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'player-1',
      'Alpha QB',
      'QB',
      'BUF',
      24.5,
      0,
      8123,
      9000,
      12.4,
      '2026-05-21T00:00:00.000Z',
    );

    db.prepare(
      `INSERT INTO players (
        id, name, position, nfl_team, age, is_rookie, dynasty_value, value_ktc, adp, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'player-2',
      'Bravo WR',
      'WR',
      null,
      null,
      1,
      7345,
      8500,
      null,
      '2026-05-21T00:00:00.000Z',
    );

    db.prepare(
      `INSERT INTO pick_values (
        id, year, round, dynasty_value, updated_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run('pick-1', 2027, 1, 6400, '2026-05-21T00:00:00.000Z');

    db.prepare(
      `INSERT INTO pick_values (
        id, year, round, dynasty_value, updated_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run('pick-2', 2028, 2, 4200, '2026-05-21T00:00:00.000Z');

    const result = runExportSnapshot(dbPath, outputPath);

    assert.equal(result.status, 0, result.stderr);

    const snapshot = JSON.parse(fs.readFileSync(outputPath, 'utf8')) as {
      exportedAt: string;
      players: Array<Record<string, unknown>>;
      pickValues: Array<Record<string, unknown>>;
    };

    assert.match(snapshot.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(snapshot.players, [
      {
        id: 'player-1',
        name: 'Alpha QB',
        position: 'QB',
        nflTeam: 'BUF',
        age: 24.5,
        isRookie: false,
        dynastyValue: 8123,
        adp: 12.4,
      },
      {
        id: 'player-2',
        name: 'Bravo WR',
        position: 'WR',
        nflTeam: null,
        age: null,
        isRookie: true,
        dynastyValue: 7345,
        adp: null,
      },
    ]);
    assert.deepEqual(snapshot.pickValues, [
      {
        year: 2027,
        round: 1,
        dynastyValue: 6400,
      },
      {
        year: 2028,
        round: 2,
        dynastyValue: 4200,
      },
    ]);
  } finally {
    cleanup();
  }
});

// @spec DFF-STATIC-012
test('export-snapshot exits with code 1 and ETL guidance when players is empty', () => {
  const { dbPath, tempDir, cleanup } = createTempDatabase();
  const outputPath = path.join(tempDir, 'snapshot.json');

  try {
    const result = runExportSnapshot(dbPath, outputPath);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Run `npm run etl` first\./);
    assert.equal(fs.existsSync(outputPath), false);
  } finally {
    cleanup();
  }
});

// @spec DFF-STATIC-012
test('export-snapshot exits with code 1 and a clear error when the database file is missing', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-export-snapshot-missing-'));
  const dbPath = path.join(tempDir, 'missing.sqlite');
  const outputPath = path.join(tempDir, 'snapshot.json');

  try {
    const result = runExportSnapshot(dbPath, outputPath);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Database file not found/);
    assert.match(result.stderr, /Run `npm run etl` first\./);
    assert.equal(fs.existsSync(outputPath), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// @spec DFF-STATIC-012
test('export-snapshot exits with code 1 and ETL guidance when the players table is missing', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-export-snapshot-missing-players-'));
  const dbPath = path.join(tempDir, 'raw.sqlite');
  const outputPath = path.join(tempDir, 'snapshot.json');
  const db = new Database(dbPath);

  try {
    db.exec('CREATE TABLE placeholder (id TEXT PRIMARY KEY);');
    db.close();

    const result = runExportSnapshot(dbPath, outputPath);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Run `npm run etl` first\./);
    assert.equal(fs.existsSync(outputPath), false);
  } finally {
    if (db.open) {
      db.close();
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// @spec DFF-STATIC-010
// @spec DFF-STATIC-012
test('data git tracking keeps SQLite ignored while allowing snapshot.json to be committed', () => {
  const gitIgnore = fs.readFileSync(path.resolve(process.cwd(), '.gitignore'), 'utf8');

  assert.match(gitIgnore, /data\/dynastyff\.sqlite/);
  assert.doesNotMatch(gitIgnore, /^data\/$/m);

  const trackedFiles = execFileSync('git', ['ls-files', 'data', '.gitignore'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.match(trackedFiles, /^data\/snapshot\.json$/m);
  assert.doesNotMatch(trackedFiles, /^data\/dynastyff\.sqlite$/m);
});
