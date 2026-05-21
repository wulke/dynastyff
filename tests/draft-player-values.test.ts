// @spec DFF-HIST-062
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { initializeDatabase } from '../src/db/init.js';
import { createDraft, getAvailablePlayersForDraft } from '../src/draft/service.js';

function withDatabase(
  run: (db: Database.Database, databasePath: string) => void | Promise<void>,
): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-draft-player-values-'));
  const databasePath = path.join(tempDir, 'test.sqlite');
  initializeDatabase(databasePath);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  return Promise.resolve(run(db, databasePath)).finally(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
}

// @spec DFF-HIST-062
function seedPlayer(
  db: Database.Database,
  {
    id,
    name,
    dynastyValue,
  }: {
    id: string;
    name: string;
    dynastyValue: number;
  },
): void {
  db.prepare(
    `INSERT INTO players (
      id, name, position, nfl_team, age, is_rookie, dynasty_value, updated_at
    ) VALUES (?, ?, 'QB', 'BUF', 25, 0, ?, ?)`,
  ).run(id, name, dynastyValue, '2026-05-18T00:00:00.000Z');
}

// @spec DFF-HIST-062
function insertCompletedRun(db: Database.Database, runId: string): void {
  db.prepare(
    `INSERT INTO etl_runs (
      id, started_at, completed_at, sources_attempted, sources_succeeded
    ) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    runId,
    '2026-05-18T19:00:00.000Z',
    '2026-05-18T19:05:00.000Z',
    '["ktc","fantasycalc"]',
    '["ktc","fantasycalc"]',
  );
}

// @spec DFF-HIST-062
function insertPlayerSnapshot(
  db: Database.Database,
  {
    id,
    runId,
    playerId,
    source,
    rawValue,
  }: {
    id: string;
    runId: string;
    playerId: string;
    source: 'ktc' | 'fantasycalc';
    rawValue: number;
  },
): void {
  db.prepare(
    `INSERT INTO player_value_snapshots (
      id, run_id, player_id, source, raw_value
    ) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, runId, playerId, source, rawValue);
}

// @spec DFF-HIST-062
test('getAvailablePlayersForDraft reconstructs dynasty values from the draft pinned ETL run snapshots', async () => {
  await withDatabase(async (db, databasePath) => {
    seedPlayer(db, { id: 'player-a', name: 'Player A', dynastyValue: 1111 });
    seedPlayer(db, { id: 'player-b', name: 'Player B', dynastyValue: 2222 });
    seedPlayer(db, { id: 'player-c', name: 'Player C', dynastyValue: 3333 });
    insertCompletedRun(db, 'run-pinned');

    insertPlayerSnapshot(db, {
      id: 'snap-a-ktc',
      runId: 'run-pinned',
      playerId: 'player-a',
      source: 'ktc',
      rawValue: 100,
    });
    insertPlayerSnapshot(db, {
      id: 'snap-b-ktc',
      runId: 'run-pinned',
      playerId: 'player-b',
      source: 'ktc',
      rawValue: 50,
    });
    insertPlayerSnapshot(db, {
      id: 'snap-c-ktc',
      runId: 'run-pinned',
      playerId: 'player-c',
      source: 'ktc',
      rawValue: 0,
    });
    insertPlayerSnapshot(db, {
      id: 'snap-a-fc',
      runId: 'run-pinned',
      playerId: 'player-a',
      source: 'fantasycalc',
      rawValue: 1000,
    });
    insertPlayerSnapshot(db, {
      id: 'snap-b-fc',
      runId: 'run-pinned',
      playerId: 'player-b',
      source: 'fantasycalc',
      rawValue: 500,
    });
    insertPlayerSnapshot(db, {
      id: 'snap-c-fc',
      runId: 'run-pinned',
      playerId: 'player-c',
      source: 'fantasycalc',
      rawValue: 0,
    });

    const draftId = createDraft({
      databasePath,
      config: {
        teamCount: 2,
        rounds: 1,
        scoringFormat: 'ppr',
        userPickPosition: 1,
        futurePickYears: 1,
        futurePickRounds: 1,
        rosterConfig: {
          QB: 1,
          RB: 2,
          WR: 3,
          TE: 1,
          FLEX: 1,
          SF: 1,
          bench: 6,
        },
      },
      now: () => '2026-05-18T20:00:00.000Z',
      random: () => 0,
    });

    const players = getAvailablePlayersForDraft({ databasePath, draftId });

    assert.deepEqual(
      players.map((player) => ({ id: player.id, dynasty_value: player.dynasty_value })),
      [
        { id: 'player-a', dynasty_value: 9999 },
        { id: 'player-b', dynasty_value: 5000 },
        { id: 'player-c', dynasty_value: 0 },
      ],
    );
  });
});

// @spec DFF-HIST-062
test('getAvailablePlayersForDraft falls back to current players values when drafts.etl_run_id is null', async () => {
  await withDatabase(async (db, databasePath) => {
    seedPlayer(db, { id: 'player-a', name: 'Player A', dynastyValue: 6100 });
    seedPlayer(db, { id: 'player-b', name: 'Player B', dynastyValue: 4200 });

    const draftId = createDraft({
      databasePath,
      config: {
        teamCount: 2,
        rounds: 1,
        scoringFormat: 'ppr',
        userPickPosition: 1,
        futurePickYears: 1,
        futurePickRounds: 1,
        rosterConfig: {
          QB: 1,
          RB: 2,
          WR: 3,
          TE: 1,
          FLEX: 1,
          SF: 1,
          bench: 6,
        },
      },
      now: () => '2026-05-18T20:00:00.000Z',
      random: () => 0,
    });

    insertCompletedRun(db, 'run-created-later');
    insertPlayerSnapshot(db, {
      id: 'later-snap-a-ktc',
      runId: 'run-created-later',
      playerId: 'player-a',
      source: 'ktc',
      rawValue: 0,
    });
    insertPlayerSnapshot(db, {
      id: 'later-snap-b-ktc',
      runId: 'run-created-later',
      playerId: 'player-b',
      source: 'ktc',
      rawValue: 100,
    });

    const players = getAvailablePlayersForDraft({ databasePath, draftId });

    assert.deepEqual(
      players.map((player) => ({ id: player.id, dynasty_value: player.dynasty_value })),
      [
        { id: 'player-a', dynasty_value: 6100 },
        { id: 'player-b', dynasty_value: 4200 },
      ],
    );
  });
});
