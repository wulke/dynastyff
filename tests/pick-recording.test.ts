// @spec DFF-ENGINE-022
// @spec DFF-ENGINE-023
// @spec DFF-DATA-050
// @spec DFF-DATA-051
// @spec DFF-DATA-052
// @spec DFF-DATA-061
// @spec DFF-DATA-092
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { initializeDatabase } from '../src/db/init.js';
import { createDraft, recordPick } from '../src/draft/service.js';

function withDatabase(
  run: (db: Database.Database, databasePath: string) => void | Promise<void>,
): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-pick-recording-'));
  const databasePath = path.join(tempDir, 'test.sqlite');
  initializeDatabase(databasePath);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  return Promise.resolve(run(db, databasePath)).finally(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
}

function seedPlayer(db: Database.Database, playerId: string, name: string): void {
  db.prepare(
    `INSERT INTO players (
      id, name, position, nfl_team, age, is_rookie, dynasty_value, updated_at
    ) VALUES (?, ?, 'QB', 'BUF', 25, 0, 5000, ?)`,
  ).run(playerId, name, '2026-05-18T00:00:00.000Z');
}

test('recordPick writes one pick row, writes current ownership, and removes the player from the queue', async () => {
  await withDatabase(async (db, databasePath) => {
    seedPlayer(db, 'player-picked', 'Picked Player');
    seedPlayer(db, 'player-other', 'Other Player');

    const draftId = createDraft({
      databasePath,
      config: {
        teamCount: 4,
        rounds: 3,
        scoringFormat: 'ppr',
        userPickPosition: 2,
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

    const draftOrderEntry = db
      .prepare(
        `SELECT id, draft_id, team_id, pick_number, round
         FROM draft_order
         WHERE draft_id = ?
         ORDER BY pick_number
         LIMIT 1`,
      )
      .get(draftId) as {
      id: string;
      draft_id: string;
      team_id: string;
      pick_number: number;
      round: number;
    };

    db.prepare('INSERT INTO user_queue (id, draft_id, player_id, rank) VALUES (?, ?, ?, ?)').run(
      'queue-picked',
      draftId,
      'player-picked',
      1,
    );
    db.prepare('INSERT INTO user_queue (id, draft_id, player_id, rank) VALUES (?, ?, ?, ?)').run(
      'queue-other',
      draftId,
      'player-other',
      2,
    );

    recordPick({
      databasePath,
      draftOrderId: draftOrderEntry.id,
      playerId: 'player-picked',
      now: () => '2026-05-18T20:05:00.000Z',
      idGenerator: () => 'pick-row-id',
    });

    const picks = db
      .prepare(
        `SELECT draft_id, draft_order_id, team_id, player_id, pick_number, round, picked_at
         FROM picks`,
      )
      .all() as Array<{
      draft_id: string;
      draft_order_id: string;
      team_id: string;
      player_id: string;
      pick_number: number;
      round: number;
      picked_at: string;
    }>;

    assert.deepEqual(picks, [
      {
        draft_id: draftOrderEntry.draft_id,
        draft_order_id: draftOrderEntry.id,
        team_id: draftOrderEntry.team_id,
        player_id: 'player-picked',
        pick_number: draftOrderEntry.pick_number,
        round: draftOrderEntry.round,
        picked_at: '2026-05-18T20:05:00.000Z',
      },
    ]);

    const rosterPlayers = db
      .prepare('SELECT draft_id, team_id, player_id FROM roster_players')
      .all() as Array<{ draft_id: string; team_id: string; player_id: string }>;

    assert.deepEqual(rosterPlayers, [
      {
        draft_id: draftOrderEntry.draft_id,
        team_id: draftOrderEntry.team_id,
        player_id: 'player-picked',
      },
    ]);

    const queue = db
      .prepare('SELECT player_id, rank FROM user_queue WHERE draft_id = ? ORDER BY rank')
      .all(draftId) as Array<{ player_id: string; rank: number }>;

    assert.deepEqual(queue, [{ player_id: 'player-other', rank: 2 }]);
  });
});

test('recordPick rolls back the pick row and queue cleanup when roster ownership write fails', async () => {
  await withDatabase(async (db, databasePath) => {
    seedPlayer(db, 'player-picked', 'Picked Player');

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

    const draftOrderEntry = db
      .prepare(
        `SELECT id, draft_id, team_id
         FROM draft_order
         WHERE draft_id = ?
         ORDER BY pick_number
         LIMIT 1`,
      )
      .get(draftId) as { id: string; draft_id: string; team_id: string };

    db.prepare('INSERT INTO roster_players (id, draft_id, team_id, player_id) VALUES (?, ?, ?, ?)').run(
      'existing-roster-row',
      draftId,
      draftOrderEntry.team_id,
      'player-picked',
    );
    db.prepare('INSERT INTO user_queue (id, draft_id, player_id, rank) VALUES (?, ?, ?, ?)').run(
      'queue-picked',
      draftId,
      'player-picked',
      1,
    );

    assert.throws(
      () =>
        recordPick({
          databasePath,
          draftOrderId: draftOrderEntry.id,
          playerId: 'player-picked',
          now: () => '2026-05-18T20:05:00.000Z',
          idGenerator: () => 'pick-row-id',
        }),
      /UNIQUE constraint failed: roster_players.draft_id, roster_players.player_id/,
    );

    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM picks').get() as { count: number }).count, 0);
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM roster_players').get() as { count: number }).count,
      1,
    );
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM user_queue').get() as { count: number }).count, 1);
  });
});

test('recorded picks are immutable and cannot be updated or deleted', async () => {
  await withDatabase(async (db, databasePath) => {
    seedPlayer(db, 'player-picked', 'Picked Player');

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

    const draftOrderEntry = db
      .prepare(
        `SELECT id
         FROM draft_order
         WHERE draft_id = ?
         ORDER BY pick_number
         LIMIT 1`,
      )
      .get(draftId) as { id: string };

    recordPick({
      databasePath,
      draftOrderId: draftOrderEntry.id,
      playerId: 'player-picked',
      now: () => '2026-05-18T20:05:00.000Z',
      idGenerator: () => 'pick-row-id',
    });

    assert.throws(
      () => db.prepare(`UPDATE picks SET team_id = 'other-team' WHERE id = 'pick-row-id'`).run(),
      /immutable/,
    );
    assert.throws(
      () => db.prepare(`DELETE FROM picks WHERE id = 'pick-row-id'`).run(),
      /immutable/,
    );
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM picks').get() as { count: number }).count, 1);
  });
});
