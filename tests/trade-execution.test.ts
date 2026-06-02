// @spec DFF-ENGINE-040
// @spec DFF-ENGINE-041
// @spec DFF-ENGINE-042
// @spec DFF-ENGINE-050
// @spec DFF-DATA-042
// @spec DFF-DATA-062
// @spec DFF-DATA-071
// @spec DFF-DATA-072
// @spec DFF-DATA-082
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { initializeDatabase } from '../src/db/init.js';
import {
  createDraft,
  getFuturePickAssetValuesForDraft,
  resolveTrade,
} from '../src/draft/service.js';

function withDatabase(
  run: (db: Database.Database, databasePath: string) => void | Promise<void>,
): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-trade-execution-'));
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
    ) VALUES (?, ?, 'WR', 'BUF', 25, 0, 5000, ?)`,
  ).run(playerId, name, '2026-05-18T00:00:00.000Z');
}

function createTradeDraft(databasePath: string): string {
  return createDraft({
    databasePath,
    config: {
      teamCount: 2,
      rounds: 3,
      scoringFormat: 'ppr',
      userPickPosition: 1,
      futurePickYears: 1,
      futurePickRounds: 2,
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
}

// @spec DFF-ENGINE-040
// @spec DFF-ENGINE-050
// @spec DFF-DATA-042
// @spec DFF-DATA-062
// @spec DFF-DATA-071
test('resolveTrade accepted swaps traded players, pick slots, and future pick assets in one transaction', async () => {
  await withDatabase(async (db, databasePath) => {
    seedPlayer(db, 'player-a', 'Player A');
    seedPlayer(db, 'player-b', 'Player B');

    const draftId = createTradeDraft(databasePath);
    const teams = db
      .prepare('SELECT id, is_user FROM teams WHERE draft_id = ? ORDER BY pick_position')
      .all(draftId) as Array<{ id: string; is_user: number }>;
    const initiatingTeamId = teams.find((team) => team.is_user === 1)!.id;
    const receivingTeamId = teams.find((team) => team.is_user === 0)!.id;

    db.prepare('INSERT INTO roster_players (id, draft_id, team_id, player_id) VALUES (?, ?, ?, ?)').run(
      'roster-a',
      draftId,
      initiatingTeamId,
      'player-a',
    );
    db.prepare('INSERT INTO roster_players (id, draft_id, team_id, player_id) VALUES (?, ?, ?, ?)').run(
      'roster-b',
      draftId,
      receivingTeamId,
      'player-b',
    );

    const pickSlots = db
      .prepare(
        `SELECT id, pick_number, team_id
         FROM draft_order
         WHERE draft_id = ? AND pick_number IN (3, 4)
         ORDER BY pick_number`,
      )
      .all(draftId) as Array<{ id: string; pick_number: number; team_id: string }>;
    const initiatingPickSlot = pickSlots.find((slot) => slot.team_id === initiatingTeamId)!;
    const receivingPickSlot = pickSlots.find((slot) => slot.team_id === receivingTeamId)!;

    const initiatingFuturePick = db
      .prepare(
        `SELECT team_id, year, round
         FROM team_pick_assets
         WHERE draft_id = ? AND team_id = ? AND round = 1`,
      )
      .get(draftId, initiatingTeamId) as { team_id: string; year: number; round: number };
    const receivingFuturePick = db
      .prepare(
        `SELECT team_id, year, round
         FROM team_pick_assets
         WHERE draft_id = ? AND team_id = ? AND round = 2`,
      )
      .get(draftId, receivingTeamId) as { team_id: string; year: number; round: number };

    resolveTrade({
      databasePath,
      tradeId: 'trade-accepted',
      draftId,
      pickNumber: 1,
      round: 1,
      initiatingTeamId,
      receivingTeamId,
      assetsSent: [
        { type: 'player', player_id: 'player-a' },
        {
          type: 'pick_slot',
          draft_order_id: initiatingPickSlot.id,
          pick_number: initiatingPickSlot.pick_number,
        },
        { type: 'future_pick', year: initiatingFuturePick.year, round: initiatingFuturePick.round },
      ],
      assetsReceived: [
        { type: 'player', player_id: 'player-b' },
        {
          type: 'pick_slot',
          draft_order_id: receivingPickSlot.id,
          pick_number: receivingPickSlot.pick_number,
        },
        { type: 'future_pick', year: receivingFuturePick.year, round: receivingFuturePick.round },
      ],
      status: 'accepted',
      now: () => '2026-05-18T20:05:00.000Z',
    });

    assert.deepEqual(
      db
        .prepare('SELECT player_id, team_id FROM roster_players WHERE draft_id = ? ORDER BY player_id')
        .all(draftId),
      [
        { player_id: 'player-a', team_id: receivingTeamId },
        { player_id: 'player-b', team_id: initiatingTeamId },
      ],
    );
    assert.deepEqual(
      db
        .prepare('SELECT id, team_id FROM draft_order WHERE id IN (?, ?) ORDER BY pick_number')
        .all(initiatingPickSlot.id, receivingPickSlot.id),
      [
        { id: initiatingPickSlot.id, team_id: receivingTeamId },
        { id: receivingPickSlot.id, team_id: initiatingTeamId },
      ],
    );
    assert.deepEqual(
      db
        .prepare(
          `SELECT year, round, team_id
           FROM team_pick_assets
           WHERE draft_id = ? AND ((team_id = ? AND round = 2) OR (team_id = ? AND round = 1))
           ORDER BY round`,
        )
        .all(draftId, initiatingTeamId, receivingTeamId),
      [
        { year: initiatingFuturePick.year, round: 1, team_id: receivingTeamId },
        { year: receivingFuturePick.year, round: 2, team_id: initiatingTeamId },
      ],
    );
    assert.deepEqual(
      db
        .prepare(
          `SELECT id, draft_id, pick_number, round, initiating_team_id, receiving_team_id, status
           FROM trades`,
        )
        .all(),
      [
        {
          id: 'trade-accepted',
          draft_id: draftId,
          pick_number: 1,
          round: 1,
          initiating_team_id: initiatingTeamId,
          receiving_team_id: receivingTeamId,
          status: 'accepted',
        },
      ],
    );
  });
});

// @spec DFF-ENGINE-040
// @spec DFF-DATA-082
test('resolveTrade rolls back the trade row and ownership changes when an accepted asset transfer fails', async () => {
  await withDatabase(async (db, databasePath) => {
    seedPlayer(db, 'player-a', 'Player A');
    seedPlayer(db, 'player-b', 'Player B');

    const draftId = createTradeDraft(databasePath);
    const teams = db
      .prepare('SELECT id, is_user FROM teams WHERE draft_id = ? ORDER BY pick_position')
      .all(draftId) as Array<{ id: string; is_user: number }>;
    const initiatingTeamId = teams.find((team) => team.is_user === 1)!.id;
    const receivingTeamId = teams.find((team) => team.is_user === 0)!.id;

    db.prepare('INSERT INTO roster_players (id, draft_id, team_id, player_id) VALUES (?, ?, ?, ?)').run(
      'roster-a',
      draftId,
      initiatingTeamId,
      'player-a',
    );
    db.prepare('INSERT INTO roster_players (id, draft_id, team_id, player_id) VALUES (?, ?, ?, ?)').run(
      'roster-b',
      draftId,
      receivingTeamId,
      'player-b',
    );

    const validPickSlot = db
      .prepare(
        `SELECT id, pick_number
         FROM draft_order
         WHERE draft_id = ? AND team_id = ? AND pick_number = 3`,
      )
      .get(draftId, initiatingTeamId) as { id: string; pick_number: number };

    assert.throws(
      () =>
        resolveTrade({
          databasePath,
          tradeId: 'trade-rollback',
          draftId,
          pickNumber: 1,
          round: 1,
          initiatingTeamId,
          receivingTeamId,
          assetsSent: [
            { type: 'player', player_id: 'player-a' },
            { type: 'pick_slot', draft_order_id: validPickSlot.id, pick_number: validPickSlot.pick_number },
          ],
          assetsReceived: [{ type: 'player', player_id: 'player-missing' }],
          status: 'accepted',
          now: () => '2026-05-18T20:05:00.000Z',
        }),
      /trade asset/i,
    );

    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM trades').get() as { count: number }).count, 0);
    assert.deepEqual(
      db
        .prepare('SELECT player_id, team_id FROM roster_players WHERE draft_id = ? ORDER BY player_id')
        .all(draftId),
      [
        { player_id: 'player-a', team_id: initiatingTeamId },
        { player_id: 'player-b', team_id: receivingTeamId },
      ],
    );
    assert.equal(
      (
        db
          .prepare('SELECT team_id FROM draft_order WHERE id = ?')
          .get(validPickSlot.id) as { team_id: string }
      ).team_id,
      initiatingTeamId,
    );
  });
});

// @spec DFF-ENGINE-041
// @spec DFF-ENGINE-042
// @spec DFF-DATA-082
test('resolveTrade declined and force_declined persist the trade outcome without transferring assets', async () => {
  await withDatabase(async (db, databasePath) => {
    seedPlayer(db, 'player-a', 'Player A');
    seedPlayer(db, 'player-b', 'Player B');

    const draftId = createTradeDraft(databasePath);
    const teams = db
      .prepare('SELECT id, is_user FROM teams WHERE draft_id = ? ORDER BY pick_position')
      .all(draftId) as Array<{ id: string; is_user: number }>;
    const initiatingTeamId = teams.find((team) => team.is_user === 1)!.id;
    const receivingTeamId = teams.find((team) => team.is_user === 0)!.id;

    db.prepare('INSERT INTO roster_players (id, draft_id, team_id, player_id) VALUES (?, ?, ?, ?)').run(
      'roster-a',
      draftId,
      initiatingTeamId,
      'player-a',
    );
    db.prepare('INSERT INTO roster_players (id, draft_id, team_id, player_id) VALUES (?, ?, ?, ?)').run(
      'roster-b',
      draftId,
      receivingTeamId,
      'player-b',
    );

    for (const [tradeId, status] of [
      ['trade-declined', 'declined'],
      ['trade-force-declined', 'force_declined'],
    ] as const) {
      resolveTrade({
        databasePath,
        tradeId,
        draftId,
        pickNumber: 1,
        round: 1,
        initiatingTeamId,
        receivingTeamId,
        assetsSent: [{ type: 'player', player_id: 'player-a' }],
        assetsReceived: [{ type: 'player', player_id: 'player-b' }],
        status,
        now: () => '2026-05-18T20:05:00.000Z',
      });
    }

    assert.deepEqual(
      db
        .prepare('SELECT id, status FROM trades WHERE draft_id = ? ORDER BY id')
        .all(draftId),
      [
        { id: 'trade-declined', status: 'declined' },
        { id: 'trade-force-declined', status: 'force_declined' },
      ],
    );
    assert.deepEqual(
      db
        .prepare('SELECT player_id, team_id FROM roster_players WHERE draft_id = ? ORDER BY player_id')
        .all(draftId),
      [
        { player_id: 'player-a', team_id: initiatingTeamId },
        { player_id: 'player-b', team_id: receivingTeamId },
      ],
    );
  });
});

// @spec DFF-DATA-072
test('getFuturePickAssetValuesForDraft joins team_pick_assets to pick_values on year and round', async () => {
  await withDatabase(async (db, databasePath) => {
    const draftId = createTradeDraft(databasePath);
    const teamIds = (
      db.prepare('SELECT id FROM teams WHERE draft_id = ? ORDER BY pick_position').all(draftId) as Array<{ id: string }>
    ).map((team) => team.id);

    db.prepare(
      `INSERT INTO pick_values (
        id, year, round, pick_in_round, dynasty_value, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('pick-value-2027-1', 2027, 1, 0, 7777, '2026-05-18T00:00:00.000Z');
    db.prepare(
      `INSERT INTO pick_values (
        id, year, round, pick_in_round, dynasty_value, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('pick-value-2027-2', 2027, 2, 0, 6666, '2026-05-18T00:00:00.000Z');

    assert.deepEqual(getFuturePickAssetValuesForDraft({ databasePath, draftId }), [
      { round: 1, team_id: teamIds[0], year: 2027, dynasty_value: 7777 },
      { round: 2, team_id: teamIds[0], year: 2027, dynasty_value: 6666 },
      { round: 1, team_id: teamIds[1], year: 2027, dynasty_value: 7777 },
      { round: 2, team_id: teamIds[1], year: 2027, dynasty_value: 6666 },
    ]);
  });
});
