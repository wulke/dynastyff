// @spec DFF-ETL-001
// @spec DFF-ETL-010
// @spec DFF-ETL-011
// @spec DFF-ETL-012
// @spec DFF-ETL-020
// @spec DFF-ETL-021
// @spec DFF-ETL-030
// @spec DFF-ETL-031
// @spec DFF-ETL-032
// @spec DFF-ETL-040
// @spec DFF-ETL-041
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { initializeDatabase } from '../src/db/init.js';
import { normalizePlayers } from '../src/etl/normalize.js';
import { runEtl } from '../src/etl/index.js';
import { extractKtcRowsFromPage, scrapeKtcPlayers } from '../src/etl/scraper/ktc.js';
import type { KtcRawPlayer } from '../src/etl/types.js';

function createTempDatabase(): { db: Database.Database; dbPath: string; cleanup: () => void } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-etl-'));
  const dbPath = path.join(tempDir, 'test.sqlite');
  initializeDatabase(dbPath);
  const db = new Database(dbPath);

  db.pragma('foreign_keys = ON');

  return {
    db,
    dbPath,
    cleanup: () => {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test('package.json exposes npm run etl as a standalone entry point', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
  ) as {
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.scripts?.etl, 'node --import tsx src/etl/index.ts');
});

test('normalizePlayers min-max scales KTC values to 0..9999', () => {
  const players: KtcRawPlayer[] = [
    {
      name: 'Low Player',
      position: 'QB',
      nflTeam: 'BUF',
      age: 24,
      isRookie: false,
      rawValue: 100,
      adp: 10,
    },
    {
      name: 'Mid Player',
      position: 'RB',
      nflTeam: 'ATL',
      age: 22,
      isRookie: false,
      rawValue: 200,
      adp: 20,
    },
    {
      name: 'High Player',
      position: 'WR',
      nflTeam: 'CIN',
      age: 21,
      isRookie: true,
      rawValue: 300,
      adp: 30,
    },
  ];

  assert.deepEqual(
    normalizePlayers(players).map((player) => ({
      name: player.name,
      normalizedValue: player.normalizedValue,
    })),
    [
      { name: 'Low Player', normalizedValue: 0 },
      { name: 'Mid Player', normalizedValue: 5000 },
      { name: 'High Player', normalizedValue: 9999 },
    ],
  );
});

test('normalizePlayers assigns 9999 when KTC returns exactly one supported player', () => {
  const [player] = normalizePlayers([
    {
      name: 'Solo Player',
      position: 'TE',
      nflTeam: 'KC',
      age: 25,
      isRookie: false,
      rawValue: 777,
      adp: 42,
    },
  ]);

  assert.equal(player.normalizedValue, 9999);
});

test('scrapeKtcPlayers fixture path filters unsupported positions at the scraper boundary', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-etl-fixture-'));
  const fixturePath = path.join(tempDir, 'ktc.json');

  fs.writeFileSync(
    fixturePath,
    JSON.stringify([
      {
        name: 'Alpha QB',
        position: 'QB',
        nflTeam: 'BUF',
        age: 24,
        isRookie: false,
        rawValue: 100,
        adp: 12.5,
      },
      {
        name: 'Ignore Kicker',
        position: 'K',
        nflTeam: 'KC',
        age: 28,
        isRookie: false,
        rawValue: 999,
        adp: null,
      },
    ]),
  );

  process.env.DYNASTYFF_KTC_FIXTURE_PATH = fixturePath;

  try {
    const players = await scrapeKtcPlayers();

    assert.deepEqual(players, [
      {
        name: 'Alpha QB',
        position: 'QB',
        nflTeam: 'BUF',
        age: 24,
        isRookie: false,
        rawValue: 100,
        adp: 12.5,
      },
    ]);
  } finally {
    delete process.env.DYNASTYFF_KTC_FIXTURE_PATH;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('extractKtcRowsFromPage serializes without tsx helper references', async () => {
  let callbackSource = '';

  await extractKtcRowsFromPage({
    evaluate: async <T>(pageFunction: () => T | Promise<T>) => {
      callbackSource = pageFunction.toString();
      return [] as T;
    },
  });

  assert.equal(callbackSource.includes('__name'), false);
});

test('runEtl inserts KTC players with normalized dynasty values', async () => {
  const { db, dbPath, cleanup } = createTempDatabase();

  try {
    const players: KtcRawPlayer[] = [
      {
        name: 'Alpha QB',
        position: 'QB',
        nflTeam: 'BUF',
        age: 24,
        isRookie: false,
        rawValue: 100,
        adp: 12.5,
      },
      {
        name: 'Bravo RB',
        position: 'RB',
        nflTeam: 'ATL',
        age: 22,
        isRookie: true,
        rawValue: 300,
        adp: 22.1,
      },
    ];

    const exitCode = await runEtl({
      databasePath: dbPath,
      scrapeKtc: async () => players as KtcRawPlayer[],
      now: () => '2026-05-18T20:00:00.000Z',
    });

    const rows = db
      .prepare(
        `SELECT
          name,
          position,
          nfl_team,
          age,
          is_rookie,
          dynasty_value,
          value_ktc,
          value_fantasycalc,
          value_dynastydaddy,
          value_rosteraudit,
          adp,
          updated_at
        FROM players
        ORDER BY name`,
      )
      .all();

    assert.equal(exitCode, 0);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows, [
      {
        name: 'Alpha QB',
        position: 'QB',
        nfl_team: 'BUF',
        age: 24,
        is_rookie: 0,
        dynasty_value: 0,
        value_ktc: 0,
        value_fantasycalc: null,
        value_dynastydaddy: null,
        value_rosteraudit: null,
        adp: 12.5,
        updated_at: '2026-05-18T20:00:00.000Z',
      },
      {
        name: 'Bravo RB',
        position: 'RB',
        nfl_team: 'ATL',
        age: 22,
        is_rookie: 1,
        dynasty_value: 9999,
        value_ktc: 9999,
        value_fantasycalc: null,
        value_dynastydaddy: null,
        value_rosteraudit: null,
        adp: 22.1,
        updated_at: '2026-05-18T20:00:00.000Z',
      },
    ]);
  } finally {
    cleanup();
  }
});

test('runEtl updates an existing player matched by name and position', async () => {
  const { db, dbPath, cleanup } = createTempDatabase();

  try {
    db.prepare(
      `INSERT INTO players (
        id,
        name,
        position,
        nfl_team,
        age,
        is_rookie,
        dynasty_value,
        value_ktc,
        value_fantasycalc,
        value_dynastydaddy,
        value_rosteraudit,
        adp,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'player-1',
      'Existing Player',
      'WR',
      'SEA',
      27,
      0,
      1234,
      1234,
      4321,
      null,
      null,
      55.5,
      '2026-05-18T10:00:00.000Z',
    );

    const exitCode = await runEtl({
      databasePath: dbPath,
      scrapeKtc: async () => [
        {
          name: 'Existing Player',
          position: 'WR',
          nflTeam: 'SEA',
          age: 26,
          isRookie: false,
          rawValue: 999,
          adp: 11.2,
        },
      ],
      now: () => '2026-05-18T21:00:00.000Z',
    });

    const row = db
      .prepare(
        `SELECT
          id,
          dynasty_value,
          value_ktc,
          value_fantasycalc,
          adp,
          updated_at
        FROM players
        WHERE name = ? AND position = ?`,
      )
      .get('Existing Player', 'WR');

    assert.equal(exitCode, 0);
    assert.deepEqual(row, {
      id: 'player-1',
      dynasty_value: 9999,
      value_ktc: 9999,
      value_fantasycalc: 4321,
      adp: 11.2,
      updated_at: '2026-05-18T21:00:00.000Z',
    });
  } finally {
    cleanup();
  }
});

test('runEtl exits non-zero and writes nothing when KTC yields no supported players', async () => {
  const { db, dbPath, cleanup } = createTempDatabase();

  try {
    const exitCode = await runEtl({
      databasePath: dbPath,
      scrapeKtc: async () => [],
      now: () => '2026-05-18T22:00:00.000Z',
    });

    const rowCount = db.prepare('SELECT COUNT(*) as count FROM players').get() as { count: number };

    assert.equal(exitCode, 1);
    assert.equal(rowCount.count, 0);
  } finally {
    cleanup();
  }
});
