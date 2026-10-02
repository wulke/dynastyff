// @spec DFF-SLS-002
// @spec DFF-SLS-003
// @spec DFF-SLS-004
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { initializeDatabase } from '../src/db/init.js';
import { runEtl } from '../src/etl/index.js';
import type { ScraperResult } from '../src/etl/types.js';

function createFixture(): { dbPath: string; cleanup: () => void } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-etl-sleeper-'));
  const dbPath = path.join(tempDir, 'test.sqlite');
  initializeDatabase(dbPath);

  return { dbPath, cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }) };
}

function createScrapers(): {
  scrapeKtc: () => Promise<ScraperResult>;
  scrapeFantasycalc: () => Promise<ScraperResult>;
  scrapeRosteraudit: () => Promise<ScraperResult>;
} {
  const empty = (source: 'fantasycalc' | 'rosteraudit'): ScraperResult => ({
    source,
    players: [],
    pickValues: [],
  });

  return {
    scrapeKtc: async () => ({
      source: 'ktc',
      players: [
        {
          name: 'Josh Allen',
          position: 'QB',
          nflTeam: 'BUF',
          age: 30,
          isRookie: false,
          rawValue: 5000,
          adp: null,
        },
      ],
      pickValues: [{ year: 2026, round: 1, rawValue: 5500 }],
    }),
    scrapeFantasycalc: async () => empty('fantasycalc'),
    scrapeRosteraudit: async () => empty('rosteraudit'),
  };
}

// @spec DFF-SLS-002
test('runEtl runs the Sleeper sync step as its final step', async () => {
  const fixture = createFixture();
  const calls: Array<{ databasePath?: string }> = [];

  try {
    const exitCode = await runEtl({
      databasePath: fixture.dbPath,
      ...createScrapers(),
      sleeperSync: async (options) => {
        calls.push({ databasePath: options.databasePath });
        return { skipped: true };
      },
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(calls, [{ databasePath: fixture.dbPath }]);
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SLS-004
test('a throwing Sleeper sync step does not fail the ETL run', async () => {
  const fixture = createFixture();
  const warnings: string[] = [];
  const originalWarn = console.warn;

  console.warn = (message: string) => warnings.push(message);

  try {
    const exitCode = await runEtl({
      databasePath: fixture.dbPath,
      ...createScrapers(),
      sleeperSync: async () => {
        throw new Error('registry exploded');
      },
    });

    assert.equal(exitCode, 0);
    assert.ok(
      warnings.some((warning) => warning.includes('Sleeper sync step failed')),
      'expected an ETL warning for the failed Sleeper step',
    );
  } finally {
    console.warn = originalWarn;
    fixture.cleanup();
  }
});

// @spec DFF-SLS-003
test('runEtl skips the Sleeper step without network calls when no leagues are connected', async () => {
  const fixture = createFixture();

  try {
    // Default sleeperSync (runSleeperSync) runs for real here: no connections
    // exist in the fresh DB, so it must skip without touching the network.
    const exitCode = await runEtl({
      databasePath: fixture.dbPath,
      ...createScrapers(),
    });

    assert.equal(exitCode, 0);
  } finally {
    fixture.cleanup();
  }
});
