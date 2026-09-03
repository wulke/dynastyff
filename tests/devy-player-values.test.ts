// @spec DFF-DEVY-001
// @spec DFF-DEVY-002
// @spec DFF-DEVY-003
// @spec DFF-DEVY-004
// @spec DFF-DEVY-010
// @spec DFF-DEVY-011
// @spec DFF-DEVY-020
// @spec DFF-DEVY-021
// @spec DFF-DEVY-022
// @spec DFF-DEVY-030
// @spec DFF-DEVY-031
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { initializeDatabase } from '../src/db/init.js';
import { runDevyEtl } from '../src/etl/devy-index.js';
import { buildSnapshot } from '../src/etl/export-snapshot.js';
import { normalizeDevyRows } from '../src/etl/scraper/ktc-devy.js';

function createTempDatabase() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-devy-'));
  const dbPath = path.join(tempDir, 'test.sqlite');
  initializeDatabase(dbPath);
  const db = new Database(dbPath);

  return {
    db,
    dbPath,
    cleanup() {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

// @spec DFF-DEVY-001
// @spec DFF-DEVY-002
// @spec DFF-DEVY-003
// @spec DFF-DEVY-004
test('devy_players is a separate position-constrained table with its own name-position uniqueness', () => {
  const { db, cleanup } = createTempDatabase();

  try {
    const columns = db.prepare('PRAGMA table_info(devy_players)').all() as Array<{ name: string }>;
    assert.deepEqual(columns.map(({ name }) => name), [
      'id', 'name', 'position', 'school', 'school_code', 'draft_year', 'value_superflex',
      'value_one_qb', 'ktc_player_id', 'mfl_id', 'is_returning_to_school', 'is_year_decrement', 'updated_at',
    ]);
    assert.throws(() => db.prepare(
      "INSERT INTO devy_players (id, name, position, draft_year, value_superflex, updated_at) VALUES ('bad', 'Athlete', 'ATH', 2028, 100, 'now')",
    ).run());
  } finally {
    cleanup();
  }
});

// @spec DFF-DEVY-011
test('devy scraper drops and warns for unsupported positions', () => {
  const warnings: string[] = [];
  const rows = normalizeDevyRows([
    { playerName: 'Quarterback One', position: 'QB', team: 'UGA', teamLongName: 'Georgia', draftYear: 2028, superflexValues: { value: 4000 } },
    { playerName: 'Athlete One', position: 'ATH', team: 'UGA', draftYear: 2028, superflexValues: { value: 2000 } },
  ], { warn: (message) => warnings.push(message) });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.name, 'Quarterback One');
  assert.match(warnings[0] ?? '', /ATH/);
});

// @spec DFF-DEVY-020
// @spec DFF-DEVY-021
// @spec DFF-DEVY-022
test('runDevyEtl normalizes only the devy board and upserts by name and position', async () => {
  const { db, dbPath, cleanup } = createTempDatabase();
  db.close();

  try {
    await runDevyEtl({
      databasePath: dbPath,
      now: () => '2026-09-03T00:00:00.000Z',
      scrape: async () => [
        { name: 'Low Devy', position: 'QB', school: 'A', schoolCode: 'A', draftYear: 2028, rawValueSuperflex: 100, rawValueOneQb: 150, ktcPlayerId: '1', mflId: null, isReturningToSchool: false, isYearDecrement: false },
        { name: 'High Devy', position: 'WR', school: 'B', schoolCode: 'B', draftYear: 2027, rawValueSuperflex: 300, rawValueOneQb: 450, ktcPlayerId: '2', mflId: 'm2', isReturningToSchool: true, isYearDecrement: true },
      ],
    });

    const sqlite = new Database(dbPath);
    const rows = sqlite.prepare('SELECT name, value_superflex AS valueSuperflex, value_one_qb AS valueOneQb FROM devy_players ORDER BY name').all();
    sqlite.close();
    assert.deepEqual(rows, [
      { name: 'High Devy', valueSuperflex: 9999, valueOneQb: 9999 },
      { name: 'Low Devy', valueSuperflex: 0, valueOneQb: 0 },
    ]);
  } finally {
    cleanup();
  }
});

// @spec DFF-DEVY-030
test('snapshot exports devyPlayers separately from NFL players', () => {
  const { db, cleanup } = createTempDatabase();

  try {
    db.prepare("INSERT INTO players (id, name, position, nfl_team, is_rookie, dynasty_value, updated_at) VALUES ('nfl', 'NFL QB', 'QB', 'BUF', 0, 9000, 'now')").run();
    db.prepare("INSERT INTO devy_players (id, name, position, school, school_code, draft_year, value_superflex, value_one_qb, is_returning_to_school, is_year_decrement, updated_at) VALUES ('devy', 'Devy QB', 'QB', 'Texas', 'TEX', 2028, 8000, 7000, 0, 0, 'now')").run();

    assert.deepEqual(buildSnapshot(db, () => '2026-09-03T00:00:00.000Z').devyPlayers, [{
      id: 'devy', name: 'Devy QB', position: 'QB', school: 'Texas', schoolCode: 'TEX', draftYear: 2028,
      valueSuperflex: 8000, valueOneQb: 7000,
    }]);
  } finally {
    cleanup();
  }
});

// @spec DFF-DEVY-031
test('scheduled refresh runs the standalone devy ETL before exporting the snapshot', () => {
  const workflow = fs.readFileSync(path.resolve(process.cwd(), '.github/workflows/scheduled-refresh.yml'), 'utf8');
  const devyIndex = workflow.indexOf('npm run etl:devy');
  assert.ok(devyIndex > workflow.indexOf('run: npm run etl\n'));
  assert.ok(devyIndex < workflow.indexOf('run: npm run export:snapshot'));
});
