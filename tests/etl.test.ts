// @spec DFF-ETL-001
// @spec DFF-ETL-010
// @spec DFF-ETL-011
// @spec DFF-ETL-012
// @spec DFF-ETL-030
// @spec DFF-ETL-032
// @spec DFF-HIST-002
// @spec DFF-HIST-040
// @spec DFF-HIST-041
// @spec DFF-HIST-042
// @spec DFF-HIST-050
// @spec DFF-HIST-051
// @spec DFF-HIST-052
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { initializeDatabase } from '../src/db/init.js';
import { normalizePlayers } from '../src/etl/normalize.js';
import { runEtl, runScrapers } from '../src/etl/index.js';
import { scrapeDynastyDaddy } from '../src/etl/scraper/dynastydaddy.js';
import { scrapeFantasyCalc } from '../src/etl/scraper/fantasycalc.js';
import { extractKtcRowsFromPage, scrapeKtcPlayers } from '../src/etl/scraper/ktc.js';
import { scrapeRosterAudit } from '../src/etl/scraper/rosteraudit.js';
import type { RawPlayer, ScraperResult } from '../src/etl/types.js';

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
  const players: RawPlayer[] = [
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

test('normalizePlayers assigns 9999 when all supported players share the same raw value', () => {
  const players: RawPlayer[] = [
    {
      name: 'Alpha QB',
      position: 'QB',
      nflTeam: 'BUF',
      age: 24,
      isRookie: false,
      rawValue: 777,
      adp: 10,
    },
    {
      name: 'Bravo RB',
      position: 'RB',
      nflTeam: 'ATL',
      age: 22,
      isRookie: false,
      rawValue: 777,
      adp: 20,
    },
  ];

  assert.deepEqual(
    normalizePlayers(players).map((player) => player.normalizedValue),
    [9999, 9999],
  );
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

test('FantasyCalc, DynastyDaddy, and RosterAudit fixture scrapers return typed players and pick values', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-etl-fixture-'));
  const fantasycalcFixturePath = path.join(tempDir, 'fantasycalc.json');
  const dynastydaddyFixturePath = path.join(tempDir, 'dynastydaddy.json');
  const rosterauditFixturePath = path.join(tempDir, 'rosteraudit.json');
  const fixturePayload = {
    players: [
      {
        name: 'Bravo WR',
        position: 'WR',
        nflTeam: 'CIN',
        age: 23,
        isRookie: false,
        rawValue: 456,
        adp: 18.2,
      },
      {
        name: 'Ignore DST',
        position: 'DST',
        nflTeam: 'PIT',
        age: null,
        isRookie: false,
        rawValue: 999,
        adp: null,
      },
    ],
    pickValues: [
      {
        year: 2027,
        round: 1,
        rawValue: 789,
      },
      {
        year: 2028,
        round: 2,
        rawValue: 'bad',
      },
    ],
  };

  fs.writeFileSync(fantasycalcFixturePath, JSON.stringify(fixturePayload));
  fs.writeFileSync(dynastydaddyFixturePath, JSON.stringify(fixturePayload));
  fs.writeFileSync(rosterauditFixturePath, JSON.stringify(fixturePayload));

  process.env.DYNASTYFF_FANTASYCALC_FIXTURE_PATH = fantasycalcFixturePath;
  process.env.DYNASTYFF_DYNASTYDADDY_FIXTURE_PATH = dynastydaddyFixturePath;
  process.env.DYNASTYFF_ROSTERAUDIT_FIXTURE_PATH = rosterauditFixturePath;

  try {
    const [fantasycalc, dynastydaddy, rosteraudit] = await Promise.all([
      scrapeFantasyCalc(),
      scrapeDynastyDaddy(),
      scrapeRosterAudit(),
    ]);

    for (const result of [fantasycalc, dynastydaddy, rosteraudit]) {
      assert.deepEqual(result.players, [
        {
          name: 'Bravo WR',
          position: 'WR',
          nflTeam: 'CIN',
          age: 23,
          isRookie: false,
          rawValue: 456,
          adp: 18.2,
        },
      ]);
      assert.deepEqual(result.pickValues, [
        {
          year: 2027,
          round: 1,
          rawValue: 789,
        },
      ]);
    }
  } finally {
    delete process.env.DYNASTYFF_FANTASYCALC_FIXTURE_PATH;
    delete process.env.DYNASTYFF_DYNASTYDADDY_FIXTURE_PATH;
    delete process.env.DYNASTYFF_ROSTERAUDIT_FIXTURE_PATH;
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

test('runScrapers caps concurrency at two simultaneous scrapers', async () => {
  let activeCount = 0;
  let maxActiveCount = 0;

  const enterScraper = async (delayMs: number): Promise<void> => {
    activeCount += 1;
    maxActiveCount = Math.max(maxActiveCount, activeCount);

    await new Promise((resolve) => setTimeout(resolve, delayMs));

    activeCount -= 1;
  };

  const createSourceScraper = (
    source: ScraperResult['source'],
    delayMs: number,
  ): (() => Promise<ScraperResult>) => {
    return async () => {
      await enterScraper(delayMs);

      return {
        source,
        players: [],
        pickValues: [],
      };
    };
  };

  const results = await runScrapers({
    scrapeKtc: async () => {
      await enterScraper(40);
      return [];
    },
    scrapeFantasycalc: createSourceScraper('fantasycalc', 40),
    scrapeDynastydaddy: createSourceScraper('dynastydaddy', 40),
    scrapeRosteraudit: createSourceScraper('rosteraudit', 40),
  });

  assert.equal(results.length, 4);
  assert.equal(maxActiveCount, 2);
  assert.deepEqual(
    results.map((result) => result.source).sort(),
    ['dynastydaddy', 'fantasycalc', 'ktc', 'rosteraudit'],
  );
});

test('runEtl inserts KTC players with normalized dynasty values', async () => {
  const { db, dbPath, cleanup } = createTempDatabase();

  try {
    const players: RawPlayer[] = [
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
      scrapeKtc: async () => players as RawPlayer[],
      scrapeFantasycalc: async () => ({ source: 'fantasycalc', players: [], pickValues: [] }),
      scrapeDynastydaddy: async () => ({ source: 'dynastydaddy', players: [], pickValues: [] }),
      scrapeRosteraudit: async () => ({ source: 'rosteraudit', players: [], pickValues: [] }),
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
      scrapeFantasycalc: async () => ({ source: 'fantasycalc', players: [], pickValues: [] }),
      scrapeDynastydaddy: async () => ({ source: 'dynastydaddy', players: [], pickValues: [] }),
      scrapeRosteraudit: async () => ({ source: 'rosteraudit', players: [], pickValues: [] }),
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

// @spec DFF-HIST-040
// @spec DFF-HIST-042
test('runEtl exits non-zero and leaves the etl run incomplete when KTC yields no supported players', async () => {
  const { db, dbPath, cleanup } = createTempDatabase();

  try {
    const exitCode = await runEtl({
      databasePath: dbPath,
      scrapeKtc: async () => [],
      scrapeFantasycalc: async () => ({ source: 'fantasycalc', players: [], pickValues: [] }),
      scrapeDynastydaddy: async () => ({ source: 'dynastydaddy', players: [], pickValues: [] }),
      scrapeRosteraudit: async () => ({ source: 'rosteraudit', players: [], pickValues: [] }),
      now: () => '2026-05-18T22:00:00.000Z',
    });

    const rowCount = db.prepare('SELECT COUNT(*) as count FROM players').get() as { count: number };
    const etlRuns = db
      .prepare(
        `SELECT started_at, completed_at, sources_attempted, sources_succeeded
         FROM etl_runs`,
      )
      .all();

    assert.equal(exitCode, 1);
    assert.equal(rowCount.count, 0);
    assert.deepEqual(etlRuns, [
      {
        started_at: '2026-05-18T22:00:00.000Z',
        completed_at: null,
        sources_attempted: '["ktc","fantasycalc","dynastydaddy","rosteraudit"]',
        sources_succeeded: '[]',
      },
    ]);
  } finally {
    cleanup();
  }
});

// @spec DFF-HIST-040
// @spec DFF-HIST-041
// @spec DFF-HIST-050
// @spec DFF-HIST-052
test('runEtl creates one etl_runs row and raw snapshots for each successful source', async () => {
  const { db, dbPath, cleanup } = createTempDatabase();

  try {
    const exitCode = await runEtl({
      databasePath: dbPath,
      scrapeKtc: async () => [
        {
          name: 'Shared Player',
          position: 'QB',
          nflTeam: 'BUF',
          age: 24,
          isRookie: false,
          rawValue: 100,
          adp: 10,
        },
      ],
      scrapeFantasycalc: async () => ({
        source: 'fantasycalc',
        players: [
          {
            name: 'Shared Player',
            position: 'QB',
            nflTeam: 'BUF',
            age: 24,
            isRookie: false,
            rawValue: 200,
            adp: 11,
          },
        ],
        pickValues: [{ year: 2027, round: 1, rawValue: 300 }],
      }),
      scrapeDynastydaddy: async () => ({
        source: 'dynastydaddy',
        players: [
          {
            name: 'Shared Player',
            position: 'QB',
            nflTeam: 'BUF',
            age: 24,
            isRookie: false,
            rawValue: 400,
            adp: 12,
          },
        ],
        pickValues: [{ year: 2027, round: 1, rawValue: 500 }],
      }),
      scrapeRosteraudit: async () => ({
        source: 'rosteraudit',
        players: [
          {
            name: 'Shared Player',
            position: 'QB',
            nflTeam: 'BUF',
            age: 24,
            isRookie: false,
            rawValue: 600,
            adp: 13,
          },
        ],
        pickValues: [{ year: 2027, round: 1, rawValue: 700 }],
      }),
      now: () => '2026-05-20T02:00:00.000Z',
    });

    const runRows = db
      .prepare(
        `SELECT started_at, completed_at, sources_attempted, sources_succeeded
         FROM etl_runs`,
      )
      .all();
    const playerSnapshots = db
      .prepare(
        `SELECT source, raw_value
         FROM player_value_snapshots
         ORDER BY source`,
      )
      .all();
    const pickSnapshots = db
      .prepare(
        `SELECT source, year, round, raw_value
         FROM pick_value_snapshots
         ORDER BY source`,
      )
      .all();

    assert.equal(exitCode, 0);
    assert.equal(runRows.length, 1);
    assert.deepEqual(runRows, [
      {
        started_at: '2026-05-20T02:00:00.000Z',
        completed_at: '2026-05-20T02:00:00.000Z',
        sources_attempted: '["ktc","fantasycalc","dynastydaddy","rosteraudit"]',
        sources_succeeded: '["ktc","fantasycalc","dynastydaddy","rosteraudit"]',
      },
    ]);
    assert.deepEqual(playerSnapshots, [
      { source: 'dynastydaddy', raw_value: 400 },
      { source: 'fantasycalc', raw_value: 200 },
      { source: 'ktc', raw_value: 100 },
      { source: 'rosteraudit', raw_value: 600 },
    ]);
    assert.deepEqual(pickSnapshots, [
      { source: 'dynastydaddy', year: 2027, round: 1, raw_value: 500 },
      { source: 'fantasycalc', year: 2027, round: 1, raw_value: 300 },
      { source: 'rosteraudit', year: 2027, round: 1, raw_value: 700 },
    ]);
  } finally {
    cleanup();
  }
});

// @spec DFF-HIST-041
// @spec DFF-HIST-050
// @spec DFF-HIST-051
// @spec DFF-HIST-052
test('runEtl rolls back one source transaction when snapshot writes fail and continues other sources', async () => {
  const { db, dbPath, cleanup } = createTempDatabase();

  try {
    db.exec(`
      CREATE TRIGGER fail_fantasycalc_player_snapshot
      BEFORE INSERT ON player_value_snapshots
      WHEN NEW.source = 'fantasycalc'
      BEGIN
        SELECT RAISE(ABORT, 'fantasycalc snapshot failed');
      END;
    `);

    const exitCode = await runEtl({
      databasePath: dbPath,
      scrapeKtc: async () => [
        {
          name: 'Shared Player',
          position: 'QB',
          nflTeam: 'BUF',
          age: 24,
          isRookie: false,
          rawValue: 100,
          adp: 10,
        },
      ],
      scrapeFantasycalc: async () => ({
        source: 'fantasycalc',
        players: [
          {
            name: 'Shared Player',
            position: 'QB',
            nflTeam: 'BUF',
            age: 24,
            isRookie: false,
            rawValue: 200,
            adp: 11,
          },
        ],
        pickValues: [{ year: 2028, round: 2, rawValue: 300 }],
      }),
      scrapeDynastydaddy: async () => ({
        source: 'dynastydaddy',
        players: [],
        pickValues: [],
      }),
      scrapeRosteraudit: async () => ({
        source: 'rosteraudit',
        players: [
          {
            name: 'Shared Player',
            position: 'QB',
            nflTeam: 'BUF',
            age: 24,
            isRookie: false,
            rawValue: 400,
            adp: 12,
          },
        ],
        pickValues: [{ year: 2029, round: 1, rawValue: 500 }],
      }),
      now: () => '2026-05-20T03:00:00.000Z',
    });

    const etlRun = db
      .prepare(
        `SELECT completed_at, sources_succeeded
         FROM etl_runs`,
      )
      .get() as { completed_at: string | null; sources_succeeded: string };
    const player = db
      .prepare(
        `SELECT value_ktc, value_fantasycalc, value_dynastydaddy, value_rosteraudit
         FROM players
         WHERE name = ? AND position = ?`,
      )
      .get('Shared Player', 'QB');
    const snapshotCounts = db
      .prepare(
        `SELECT source, COUNT(*) AS count
         FROM player_value_snapshots
         GROUP BY source
         ORDER BY source`,
      )
      .all();
    const pickRows = db
      .prepare(
        `SELECT year, round
         FROM pick_values
         ORDER BY year, round`,
      )
      .all();

    assert.equal(exitCode, 0);
    assert.deepEqual(etlRun, {
      completed_at: '2026-05-20T03:00:00.000Z',
      sources_succeeded: '["ktc","dynastydaddy","rosteraudit"]',
    });
    assert.deepEqual(player, {
      value_ktc: 9999,
      value_fantasycalc: null,
      value_dynastydaddy: null,
      value_rosteraudit: 9999,
    });
    assert.deepEqual(snapshotCounts, [
      { source: 'ktc', count: 1 },
      { source: 'rosteraudit', count: 1 },
    ]);
    assert.deepEqual(pickRows, [{ year: 2029, round: 1 }]);
  } finally {
    cleanup();
  }
});

// @spec DFF-HIST-002
test('runEtl leaves etl_runs.completed_at null when final completion update never commits', async () => {
  const { db, dbPath, cleanup } = createTempDatabase();

  try {
    db.exec(`
      CREATE TRIGGER fail_etl_run_completion
      BEFORE UPDATE OF completed_at ON etl_runs
      BEGIN
        SELECT RAISE(ABORT, 'etl run completion failed');
      END;
    `);

    await assert.rejects(
      () =>
        runEtl({
          databasePath: dbPath,
          scrapeKtc: async () => [
            {
              name: 'Solo Player',
              position: 'QB',
              nflTeam: 'BUF',
              age: 24,
              isRookie: false,
              rawValue: 100,
              adp: 10,
            },
          ],
          scrapeFantasycalc: async () => ({ source: 'fantasycalc', players: [], pickValues: [] }),
          scrapeDynastydaddy: async () => ({ source: 'dynastydaddy', players: [], pickValues: [] }),
          scrapeRosteraudit: async () => ({ source: 'rosteraudit', players: [], pickValues: [] }),
          now: () => '2026-05-20T04:00:00.000Z',
        }),
      /etl run completion failed/,
    );

    const etlRun = db
      .prepare(
        `SELECT started_at, completed_at, sources_succeeded
         FROM etl_runs`,
      )
      .get() as { started_at: string; completed_at: string | null; sources_succeeded: string };

    assert.deepEqual(etlRun, {
      started_at: '2026-05-20T04:00:00.000Z',
      completed_at: null,
      sources_succeeded: '[]',
    });
  } finally {
    cleanup();
  }
});
