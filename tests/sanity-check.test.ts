// @spec DFF-SCHED-010
// @spec DFF-SCHED-011
// @spec DFF-SCHED-012
// @spec DFF-SCHED-013
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { initializeDatabase } from '../src/db/init.js';
import { runSanityCheck } from '../src/etl/sanity-check.js';
import type { Snapshot } from '../src/etl/export-snapshot.js';

type TempDatabase = {
  db: Database.Database;
  dbPath: string;
  tempDir: string;
  cleanup: () => void;
};

function createTempDatabase(): TempDatabase {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-sanity-check-'));
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

function insertEtlRun(
  db: Database.Database,
  options: { sourcesAttempted: string[]; sourcesSucceeded: string[] },
) {
  db.prepare(
    `INSERT INTO etl_runs (id, started_at, completed_at, sources_attempted, sources_succeeded)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    'run-1',
    '2026-05-21T00:00:00.000Z',
    '2026-05-21T00:05:00.000Z',
    JSON.stringify(options.sourcesAttempted),
    JSON.stringify(options.sourcesSucceeded),
  );
}

function makeSnapshot(counts: { QB: number; RB: number; WR: number; TE: number; picks: number }): Snapshot {
  const players: Snapshot['players'] = [];
  let id = 0;
  for (const position of ['QB', 'RB', 'WR', 'TE'] as const) {
    for (let i = 0; i < counts[position]; i += 1) {
      id += 1;
      players.push({
        id: `player-${id}`,
        name: `Player ${id}`,
        position,
        nflTeam: 'BUF',
        age: 25,
        isRookie: false,
        dynastyValue: 5000,
        adp: null,
      });
    }
  }

  const pickValues: Snapshot['pickValues'] = [];
  for (let i = 0; i < counts.picks; i += 1) {
    pickValues.push({ year: 2027, round: (i % 4) + 1, dynastyValue: 5000 });
  }

  return { exportedAt: '2026-05-21T00:00:00.000Z', players, pickValues };
}

function writeSnapshot(tempDir: string, snapshot: Snapshot): string {
  const snapshotPath = path.join(tempDir, 'snapshot.json');
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  return snapshotPath;
}

// Position floors (50/100/150/50) sum to only 350, below the 400 total floor,
// so this fixture pads TE to clear both the per-position and total floors at once.
const floorCounts = { QB: 50, RB: 100, WR: 150, TE: 100, picks: 16 };

// @spec DFF-SCHED-011
test('runSanityCheck passes when counts meet every floor exactly', () => {
  const { db, dbPath, tempDir, cleanup } = createTempDatabase();

  try {
    insertEtlRun(db, { sourcesAttempted: ['ktc', 'fantasycalc', 'rosteraudit'], sourcesSucceeded: ['ktc', 'fantasycalc', 'rosteraudit'] });
    const snapshotPath = writeSnapshot(tempDir, makeSnapshot(floorCounts));

    const result = runSanityCheck({ databasePath: dbPath, snapshotPath });

    assert.equal(result.ok, true);
    assert.deepEqual(result.failures, []);
    assert.equal(result.warning, null);
  } finally {
    cleanup();
  }
});

// @spec DFF-SCHED-011
test('runSanityCheck fails when total player count is below the floor', () => {
  const { db, dbPath, tempDir, cleanup } = createTempDatabase();

  try {
    insertEtlRun(db, { sourcesAttempted: ['ktc'], sourcesSucceeded: ['ktc'] });
    const snapshotPath = writeSnapshot(tempDir, makeSnapshot({ ...floorCounts, TE: 49 }));

    const result = runSanityCheck({ databasePath: dbPath, snapshotPath });

    assert.equal(result.ok, false);
    assert.ok(result.failures.some((f) => f.includes('TE')));
  } finally {
    cleanup();
  }
});

// @spec DFF-SCHED-011
test('runSanityCheck fails when a single position collapses even though the total floor is met', () => {
  const { db, dbPath, tempDir, cleanup } = createTempDatabase();

  try {
    insertEtlRun(db, { sourcesAttempted: ['ktc'], sourcesSucceeded: ['ktc'] });
    // QB collapses to 0 but WR is padded so the *total* still clears 400.
    const snapshotPath = writeSnapshot(
      tempDir,
      makeSnapshot({ QB: 0, RB: 100, WR: 350, TE: 50, picks: 16 }),
    );

    const result = runSanityCheck({ databasePath: dbPath, snapshotPath });

    assert.equal(result.ok, false);
    assert.ok(result.failures.some((f) => f.includes('QB')));
  } finally {
    cleanup();
  }
});

// @spec DFF-SCHED-011
test('runSanityCheck fails when pick value count is below the floor', () => {
  const { db, dbPath, tempDir, cleanup } = createTempDatabase();

  try {
    insertEtlRun(db, { sourcesAttempted: ['ktc'], sourcesSucceeded: ['ktc'] });
    const snapshotPath = writeSnapshot(tempDir, makeSnapshot({ ...floorCounts, picks: 15 }));

    const result = runSanityCheck({ databasePath: dbPath, snapshotPath });

    assert.equal(result.ok, false);
    assert.ok(result.failures.some((f) => f.toLowerCase().includes('pick')));
  } finally {
    cleanup();
  }
});

// @spec DFF-SCHED-013
test('runSanityCheck warns without blocking when a source partially failed', () => {
  const { db, dbPath, tempDir, cleanup } = createTempDatabase();

  try {
    insertEtlRun(db, {
      sourcesAttempted: ['ktc', 'fantasycalc', 'rosteraudit'],
      sourcesSucceeded: ['ktc', 'fantasycalc'],
    });
    const snapshotPath = writeSnapshot(tempDir, makeSnapshot(floorCounts));

    const result = runSanityCheck({ databasePath: dbPath, snapshotPath });

    assert.equal(result.ok, true);
    assert.deepEqual(result.failures, []);
    assert.match(result.warning ?? '', /rosteraudit/);
  } finally {
    cleanup();
  }
});

// @spec DFF-SCHED-013
test('runSanityCheck reports no warning when every attempted source succeeded', () => {
  const { db, dbPath, tempDir, cleanup } = createTempDatabase();

  try {
    insertEtlRun(db, { sourcesAttempted: ['ktc', 'fantasycalc'], sourcesSucceeded: ['ktc', 'fantasycalc'] });
    const snapshotPath = writeSnapshot(tempDir, makeSnapshot(floorCounts));

    const result = runSanityCheck({ databasePath: dbPath, snapshotPath });

    assert.equal(result.warning, null);
  } finally {
    cleanup();
  }
});

function runSanityCheckCli(
  databasePath: string,
  snapshotPath: string,
  githubOutputPath?: string,
) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/etl/sanity-check.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DYNASTYFF_DB_PATH: databasePath,
      DYNASTYFF_SNAPSHOT_PATH: snapshotPath,
      ...(githubOutputPath ? { GITHUB_OUTPUT: githubOutputPath } : {}),
    },
    encoding: 'utf8',
  });
}

// @spec DFF-SCHED-010
test('package.json exposes npm run etl:sanity-check as a standalone entry point', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };

  assert.equal(packageJson.scripts?.['etl:sanity-check'], 'node --import tsx src/etl/sanity-check.ts');
});

// @spec DFF-SCHED-011
test('CLI exits non-zero when the sanity check fails', () => {
  const { db, dbPath, tempDir, cleanup } = createTempDatabase();

  try {
    insertEtlRun(db, { sourcesAttempted: ['ktc'], sourcesSucceeded: ['ktc'] });
    const snapshotPath = writeSnapshot(tempDir, makeSnapshot({ ...floorCounts, RB: 10 }));

    const result = runSanityCheckCli(dbPath, snapshotPath);

    assert.notEqual(result.status, 0);
  } finally {
    cleanup();
  }
});

// @spec DFF-SCHED-013
test('CLI exits zero and appends sources_warning to GITHUB_OUTPUT on partial source success', () => {
  const { db, dbPath, tempDir, cleanup } = createTempDatabase();

  try {
    insertEtlRun(db, {
      sourcesAttempted: ['ktc', 'fantasycalc', 'rosteraudit'],
      sourcesSucceeded: ['ktc'],
    });
    const snapshotPath = writeSnapshot(tempDir, makeSnapshot(floorCounts));
    const githubOutputPath = path.join(tempDir, 'github_output.txt');
    fs.writeFileSync(githubOutputPath, '');

    const result = runSanityCheckCli(dbPath, snapshotPath, githubOutputPath);

    assert.equal(result.status, 0, result.stderr);
    const output = fs.readFileSync(githubOutputPath, 'utf8');
    assert.match(output, /^sources_warning=/m);
    assert.match(output, /fantasycalc/);
    assert.match(output, /rosteraudit/);
  } finally {
    cleanup();
  }
});
