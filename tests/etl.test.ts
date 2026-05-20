// @spec DFF-ETL-001
// @spec DFF-ETL-010
// @spec DFF-ETL-011
// @spec DFF-ETL-012
// @spec DFF-ETL-014
// @spec DFF-ETL-015
// @spec DFF-ETL-020
// @spec DFF-ETL-021
// @spec DFF-ETL-022
// @spec DFF-ETL-023
// @spec DFF-ETL-024
// @spec DFF-ETL-030
// @spec DFF-ETL-032
// @spec DFF-ETL-040
// @spec DFF-ETL-060
// @spec DFF-ETL-061
// @spec DFF-ETL-062
// @spec DFF-ETL-080
// @spec DFF-ETL-081
// @spec DFF-ETL-082
// @spec DFF-ETL-083
// @spec DFF-HIST-002
// @spec DFF-HIST-040
// @spec DFF-HIST-041
// @spec DFF-HIST-042
// @spec DFF-HIST-050
// @spec DFF-HIST-051
// @spec DFF-HIST-052
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { initializeDatabase } from '../src/db/init.js';
import { normalizePickValues, normalizePlayers } from '../src/etl/normalize.js';
import { runEtl, runScrapers } from '../src/etl/index.js';
import { scrapeDynastyDaddy } from '../src/etl/scraper/dynastydaddy.js';
import { scrapeFantasyCalc } from '../src/etl/scraper/fantasycalc.js';
import { extractKtcRowsFromPage, scrapeKtcPlayers } from '../src/etl/scraper/ktc.js';
import { scrapeRosterAudit } from '../src/etl/scraper/rosteraudit.js';
import { waitForScraperPageReady } from '../src/etl/scraper/shared.js';
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

// @spec DFF-ETL-002
test('etl CLI prints a schema help message when the local database is missing etl_runs', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-etl-missing-schema-'));
  const dbPath = path.join(tempDir, 'missing-schema.sqlite');

  try {
    fs.writeFileSync(dbPath, '');

    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          ['--import', 'tsx', 'src/etl/index.ts'],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              DYNASTYFF_DB_PATH: dbPath,
              DYNASTYFF_KTC_FIXTURE_PATH: path.join(tempDir, 'ktc-empty.json'),
              DYNASTYFF_FANTASYCALC_FIXTURE_PATH: path.join(tempDir, 'fantasycalc-empty.json'),
              DYNASTYFF_ROSTERAUDIT_FIXTURE_PATH: path.join(tempDir, 'rosteraudit-empty.json'),
            },
            stdio: 'pipe',
          },
        ),
      (error: unknown) => {
        if (!(error instanceof Error) || !('stderr' in error)) {
          return false;
        }

        const stderr = String((error as Error & { stderr?: Buffer }).stderr ?? '');
        return stderr.includes('Run `npm run db:init`');
      },
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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

// @spec DFF-ETL-031
test('normalizePickValues min-max scales pick values to 0..9999', () => {
  assert.deepEqual(
    normalizePickValues([
      { year: 2027, round: 1, rawValue: 100 },
      { year: 2027, round: 2, rawValue: 200 },
      { year: 2028, round: 1, rawValue: 300 },
    ]).map((pickValue) => ({
      year: pickValue.year,
      round: pickValue.round,
      normalizedValue: pickValue.normalizedValue,
    })),
    [
      { year: 2027, round: 1, normalizedValue: 0 },
      { year: 2027, round: 2, normalizedValue: 5000 },
      { year: 2028, round: 1, normalizedValue: 9999 },
    ],
  );
});

// @spec DFF-ETL-032
test('normalizePickValues warns and assigns 9999 when a source returns exactly one pick value', () => {
  const warnings: string[] = [];

  const [pickValue] = normalizePickValues(
    [{ year: 2027, round: 1, rawValue: 100 }],
    {
      source: 'fantasycalc',
      valueType: 'pick value',
      warn: (message) => {
        warnings.push(message);
      },
    },
  );

  assert.equal(pickValue.normalizedValue, 9999);
  assert.deepEqual(warnings, [
    '[ETL] WARN: fantasycalc returned exactly one pick value; assigning normalized value 9999.',
  ]);
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

// @spec DFF-ETL-014
test('waitForScraperPageReady warns and continues when networkidle never resolves', async () => {
  const warnings: string[] = [];

  await waitForScraperPageReady(
    {
      waitForLoadState: async () => {
        const error = new Error('Timeout 30000ms exceeded.');
        error.name = 'TimeoutError';
        throw error;
      },
    },
    'dynastydaddy',
    (message) => {
      warnings.push(message);
    },
  );

  assert.deepEqual(warnings, [
    '[ETL] WARN: dynastydaddy page never reached networkidle within 30000ms. Continuing with the loaded DOM.',
  ]);
});

// @spec DFF-ETL-014
test('waitForScraperPageReady rethrows non-timeout page readiness errors', async () => {
  await assert.rejects(
    () =>
      waitForScraperPageReady(
        {
          waitForLoadState: async () => {
            throw new Error('boom');
          },
        },
        'rosteraudit',
      ),
    /boom/,
  );
});

// @spec DFF-ETL-011
// @spec DFF-ETL-015
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
    scrapeRosteraudit: createSourceScraper('rosteraudit', 40),
  });

  assert.equal(results.length, 3);
  assert.equal(maxActiveCount, 2);
  assert.deepEqual(
    results.map((result) => result.source).sort(),
    ['fantasycalc', 'ktc', 'rosteraudit'],
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

// @spec DFF-ETL-031
// @spec DFF-ETL-041
// @spec DFF-ETL-070
// @spec DFF-ETL-071
// @spec DFF-DATA-011
// @spec DFF-DATA-012
test('runEtl aggregates pick values across sources and updates existing year-round rows in place', async () => {
  const { db, dbPath, cleanup } = createTempDatabase();

  try {
    db.prepare(
      `INSERT INTO pick_values (
        id,
        year,
        round,
        dynasty_value,
        updated_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run('pick-2027-1', 2027, 1, 1234, '2026-05-18T09:00:00.000Z');

    const exitCode = await runEtl({
      databasePath: dbPath,
      scrapeKtc: async () => [
        {
          name: 'Alpha QB',
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
        players: [],
        pickValues: [
          { year: 2027, round: 1, rawValue: 100 },
          { year: 2028, round: 1, rawValue: 300 },
        ],
      }),
      scrapeRosteraudit: async () => ({
        source: 'rosteraudit',
        players: [],
        pickValues: [
          { year: 2027, round: 1, rawValue: 600 },
          { year: 2029, round: 1, rawValue: 200 },
        ],
      }),
      now: () => '2026-05-20T07:00:00.000Z',
    });

    const rows = db
      .prepare(
        `SELECT
          id,
          year,
          round,
          dynasty_value,
          updated_at
         FROM pick_values
         ORDER BY year, round`,
      )
      .all();

    assert.equal(exitCode, 0);
    assert.deepEqual(rows, [
      {
        id: 'pick-2027-1',
        year: 2027,
        round: 1,
        dynasty_value: 5000,
        updated_at: '2026-05-20T07:00:00.000Z',
      },
      {
        id: rows[1]?.id,
        year: 2028,
        round: 1,
        dynasty_value: 9999,
        updated_at: '2026-05-20T07:00:00.000Z',
      },
      {
        id: rows[2]?.id,
        year: 2029,
        round: 1,
        dynasty_value: 0,
        updated_at: '2026-05-20T07:00:00.000Z',
      },
    ]);
    assert.equal(new Set(rows.map((row) => row.id)).size, 3);
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
      dynasty_value: 7160,
      value_ktc: 9999,
      value_fantasycalc: 4321,
      adp: 11.2,
      updated_at: '2026-05-18T21:00:00.000Z',
    });
  } finally {
    cleanup();
  }
});

// @spec DFF-ETL-082
test('runEtl continues with an empty alias list when player-aliases.json is missing from the project root', async () => {
  const { db, dbPath, cleanup } = createTempDatabase();
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-etl-missing-alias-file-'));
  const warnings: string[] = [];
  const originalWarn = console.warn;

  console.warn = (message?: unknown, ...optionalParams: unknown[]) => {
    warnings.push([message, ...optionalParams].map(String).join(' '));
  };

  process.chdir(tempDir);

  try {
    const exitCode = await runEtl({
      databasePath: dbPath,
      scrapeKtc: async () => [
        {
          name: 'Alpha QB',
          position: 'QB',
          nflTeam: 'BUF',
          age: 24,
          isRookie: false,
          rawValue: 100,
          adp: 12.5,
        },
      ],
      scrapeFantasycalc: async () => ({ source: 'fantasycalc', players: [], pickValues: [] }),
      scrapeRosteraudit: async () => ({ source: 'rosteraudit', players: [], pickValues: [] }),
      now: () => '2026-05-20T05:00:00.000Z',
    });

    const rowCount = db.prepare('SELECT COUNT(*) AS count FROM players').get() as { count: number };

    assert.equal(exitCode, 0);
    assert.equal(rowCount.count, 1);
    assert.ok(
      warnings.some((warning) =>
        /aliases file not found at .*player-aliases\.json\. Continuing with an empty alias list\./.test(
          warning,
        ),
      ),
    );
    assert.match(
      warnings.join('\n'),
      /aliases file not found at .*player-aliases\.json\. Continuing with an empty alias list\./,
    );
  } finally {
    process.chdir(originalCwd);
    console.warn = originalWarn;
    fs.rmSync(tempDir, { recursive: true, force: true });
    cleanup();
  }
});

// @spec DFF-ETL-083
test('runEtl fails before database writes when player-aliases.json contains malformed JSON', async () => {
  const { db, dbPath, cleanup } = createTempDatabase();
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-etl-bad-alias-file-'));

  fs.writeFileSync(path.join(tempDir, 'player-aliases.json'), '{ bad json');
  process.chdir(tempDir);

  try {
    await assert.rejects(
      () =>
        runEtl({
          databasePath: dbPath,
          scrapeKtc: async () => [
            {
              name: 'Alpha QB',
              position: 'QB',
              nflTeam: 'BUF',
              age: 24,
              isRookie: false,
              rawValue: 100,
              adp: 12.5,
            },
          ],
          scrapeFantasycalc: async () => ({ source: 'fantasycalc', players: [], pickValues: [] }),
          scrapeRosteraudit: async () => ({ source: 'rosteraudit', players: [], pickValues: [] }),
          now: () => '2026-05-20T06:00:00.000Z',
        }),
      /aliases file .* is invalid JSON/,
    );

    const playerCount = db.prepare('SELECT COUNT(*) AS count FROM players').get() as { count: number };
    const etlRunCount = db.prepare('SELECT COUNT(*) AS count FROM etl_runs').get() as { count: number };

    assert.equal(playerCount.count, 0);
    assert.equal(etlRunCount.count, 0);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    cleanup();
  }
});

// @spec DFF-ETL-020
// @spec DFF-ETL-021
// @spec DFF-ETL-022
// @spec DFF-ETL-023
// @spec DFF-ETL-024
// @spec DFF-ETL-040
// @spec DFF-ETL-060
// @spec DFF-ETL-061
// @spec DFF-ETL-062
// @spec DFF-ETL-080
// @spec DFF-ETL-081
// @spec DFF-ETL-082
test('runEtl matches non-KTC players by exact name, fuzzy name, and alias while excluding unmatched players', async () => {
  const { db, dbPath, cleanup } = createTempDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-etl-aliases-'));
  const aliasesPath = path.join(tempDir, 'player-aliases.json');
  const warnings: string[] = [];
  const originalWarn = console.warn;

  fs.writeFileSync(
    aliasesPath,
    JSON.stringify({
      aliases: [
        {
          canonical: 'Odell Beckham Jr.',
          variants: ['Odell Beckham'],
        },
      ],
    }),
  );

  console.warn = (message?: unknown, ...optionalParams: unknown[]) => {
    warnings.push([message, ...optionalParams].map(String).join(' '));
  };

  try {
    const exitCode = await runEtl({
      databasePath: dbPath,
      aliasesPath,
      scrapeKtc: async () => [
        {
          name: 'Odell Beckham Jr.',
          position: 'WR',
          nflTeam: 'MIA',
          age: 31,
          isRookie: false,
          rawValue: 100,
          adp: 10,
        },
        {
          name: 'Jaxon Smith-Njigba',
          position: 'WR',
          nflTeam: 'SEA',
          age: 23,
          isRookie: false,
          rawValue: 200,
          adp: 20,
        },
        {
          name: 'Brian Thomas Jr.',
          position: 'WR',
          nflTeam: 'JAX',
          age: 22,
          isRookie: true,
          rawValue: 300,
          adp: 30,
        },
      ],
      scrapeFantasycalc: async () => ({
        source: 'fantasycalc',
        players: [
          {
            name: 'Odell Beckham',
            position: 'WR',
            nflTeam: 'LAR',
            age: 29,
            isRookie: false,
            rawValue: 500,
            adp: 99,
          },
          {
            name: 'Jaxon Smith Njigba',
            position: 'WR',
            nflTeam: 'NYJ',
            age: 28,
            isRookie: false,
            rawValue: 600,
            adp: 98,
          },
          {
            name: 'Brian Thomas Jr.',
            position: 'WR',
            nflTeam: 'BUF',
            age: 27,
            isRookie: false,
            rawValue: 700,
            adp: 97,
          },
          {
            name: 'Unmatched Receiver',
            position: 'WR',
            nflTeam: 'CHI',
            age: 24,
            isRookie: false,
            rawValue: 800,
            adp: 96,
          },
        ],
        pickValues: [],
      }),
      scrapeRosteraudit: async () => ({
        source: 'rosteraudit',
        players: [
          {
            name: 'Brian Thomas Jr.',
            position: 'WR',
            nflTeam: 'DAL',
            age: 25,
            isRookie: false,
            rawValue: 900,
            adp: 95,
          },
        ],
        pickValues: [],
      }),
      now: () => '2026-05-20T01:00:00.000Z',
    });

    const players = db
      .prepare(
        `SELECT
          name,
          nfl_team,
          age,
          is_rookie,
          dynasty_value,
          value_ktc,
          value_fantasycalc,
          value_dynastydaddy,
          value_rosteraudit,
          adp
        FROM players
        ORDER BY name`,
      )
      .all();
    const fantasycalcSnapshots = db
      .prepare(
        `SELECT player_id, source, raw_value
         FROM player_value_snapshots
         WHERE source = 'fantasycalc'
         ORDER BY raw_value`,
      )
      .all();

    assert.equal(exitCode, 0);
    assert.deepEqual(players, [
      {
        name: 'Brian Thomas Jr.',
        nfl_team: 'JAX',
        age: 22,
        is_rookie: 1,
        dynasty_value: 8888,
        value_ktc: 9999,
        value_fantasycalc: 6666,
        value_dynastydaddy: null,
        value_rosteraudit: 9999,
        adp: 95,
      },
      {
        name: 'Jaxon Smith-Njigba',
        nfl_team: 'SEA',
        age: 23,
        is_rookie: 0,
        dynasty_value: 4167,
        value_ktc: 5000,
        value_fantasycalc: 3333,
        value_dynastydaddy: null,
        value_rosteraudit: null,
        adp: 98,
      },
      {
        name: 'Odell Beckham Jr.',
        nfl_team: 'MIA',
        age: 31,
        is_rookie: 0,
        dynasty_value: 0,
        value_ktc: 0,
        value_fantasycalc: 0,
        value_dynastydaddy: null,
        value_rosteraudit: null,
        adp: 99,
      },
    ]);
    assert.equal(fantasycalcSnapshots.length, 3);
    assert.ok(
      warnings.includes(
        "[ETL] WARN: fantasycalc player 'Unmatched Receiver' (WR) could not be matched to a canonical player. Excluding from this run.",
      ),
    );
  } finally {
    console.warn = originalWarn;
    fs.rmSync(tempDir, { recursive: true, force: true });
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
        sources_attempted: '["ktc","fantasycalc","rosteraudit"]',
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
        sources_attempted: '["ktc","fantasycalc","rosteraudit"]',
        sources_succeeded: '["ktc","fantasycalc","rosteraudit"]',
      },
    ]);
    assert.deepEqual(playerSnapshots, [
      { source: 'fantasycalc', raw_value: 200 },
      { source: 'ktc', raw_value: 100 },
      { source: 'rosteraudit', raw_value: 600 },
    ]);
    assert.deepEqual(pickSnapshots, [
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
      sources_succeeded: '["ktc","rosteraudit"]',
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
