// @spec DFF-SCHED-010
// @spec DFF-SCHED-011
// @spec DFF-SCHED-012
// @spec DFF-SCHED-013
import fs from 'node:fs';

import type Database from 'better-sqlite3';

import { createDatabase } from '../db/client.js';
import { resolveDatabasePath } from '../db/init.js';
import { resolveSnapshotPath } from './export-snapshot.js';
import type { Snapshot } from './export-snapshot.js';

const POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;

const FLOORS: Record<(typeof POSITIONS)[number], number> = {
  QB: 50,
  RB: 100,
  WR: 150,
  TE: 50,
};

const TOTAL_PLAYER_FLOOR = 400;
const PICK_VALUE_FLOOR = 16;

export type SanityCheckResult = {
  ok: boolean;
  failures: string[];
  warning: string | null;
};

// @spec DFF-SCHED-011
// @spec DFF-SCHED-012
function checkCounts(snapshot: Snapshot): string[] {
  const failures: string[] = [];

  if (snapshot.players.length < TOTAL_PLAYER_FLOOR) {
    failures.push(
      `total players ${snapshot.players.length} is below the floor of ${TOTAL_PLAYER_FLOOR}`,
    );
  }

  for (const position of POSITIONS) {
    const count = snapshot.players.filter((player) => player.position === position).length;
    const floor = FLOORS[position];
    if (count < floor) {
      failures.push(`${position} count ${count} is below the floor of ${floor}`);
    }
  }

  if (snapshot.pickValues.length < PICK_VALUE_FLOOR) {
    failures.push(
      `pick value count ${snapshot.pickValues.length} is below the floor of ${PICK_VALUE_FLOOR}`,
    );
  }

  return failures;
}

// @spec DFF-SCHED-013
function checkSourceWarning(sqlite: Database.Database): string | null {
  const row = sqlite
    .prepare(
      `SELECT sources_attempted AS sourcesAttempted, sources_succeeded AS sourcesSucceeded
       FROM etl_runs
       ORDER BY started_at DESC
       LIMIT 1`,
    )
    .get() as { sourcesAttempted: string; sourcesSucceeded: string } | undefined;

  if (!row) {
    return null;
  }

  const attempted: string[] = JSON.parse(row.sourcesAttempted);
  const succeeded: string[] = JSON.parse(row.sourcesSucceeded);
  const missing = attempted.filter((source) => !succeeded.includes(source));

  if (missing.length === 0) {
    return null;
  }

  return `partial source failure — ${missing.join(', ')} did not succeed this run (attempted: ${attempted.join(', ')})`;
}

// @spec DFF-SCHED-010
export function runSanityCheck(options?: {
  databasePath?: string;
  snapshotPath?: string;
}): SanityCheckResult {
  const databasePath = options?.databasePath ?? resolveDatabasePath();
  const snapshotPath = options?.snapshotPath ?? resolveSnapshotPath();

  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as Snapshot;
  const sqlite = createDatabase(databasePath);

  try {
    const failures = checkCounts(snapshot);
    const warning = checkSourceWarning(sqlite);

    return { ok: failures.length === 0, failures, warning };
  } finally {
    sqlite.close();
  }
}

// @spec DFF-SCHED-013
function writeGithubOutput(warning: string): void {
  const githubOutputPath = process.env.GITHUB_OUTPUT;
  if (!githubOutputPath) {
    return;
  }

  const sanitized = warning.replace(/\n/g, ' ');
  fs.appendFileSync(githubOutputPath, `sources_warning=${sanitized}\n`);
}

// @spec DFF-SCHED-011
// @spec DFF-SCHED-013
function main(): void {
  const result = runSanityCheck();

  if (result.warning) {
    console.warn(`[sanity-check] WARN: ${result.warning}`);
    writeGithubOutput(result.warning);
  }

  if (!result.ok) {
    for (const failure of result.failures) {
      console.error(`[sanity-check] FAIL: ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('[sanity-check] all floors passed');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
