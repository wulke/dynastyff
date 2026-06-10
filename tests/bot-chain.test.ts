// @spec DFF-ENGINE-030
// @spec DFF-ENGINE-031
// @spec DFF-ENGINE-032
// @spec DFF-ENGINE-033
// @spec DFF-ENGINE-040
// @spec DFF-ENGINE-039
// @spec DFF-ENGINE-039b
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { initializeDatabase } from '../src/db/init.js';
import { createBotChainCoordinator } from '../src/draft/bot-chain.js';
import { createDraft } from '../src/draft/service.js';

function withDatabase(
  run: (db: Database.Database, databasePath: string) => void | Promise<void>,
): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-bot-chain-'));
  const databasePath = path.join(tempDir, 'test.sqlite');
  initializeDatabase(databasePath);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  return Promise.resolve(run(db, databasePath)).finally(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
}

function seedPlayer(
  db: Database.Database,
  playerId: string,
  name: string,
  dynastyValue: number,
): void {
  db.prepare(
    `INSERT INTO players (
      id, name, position, nfl_team, age, is_rookie, dynasty_value, updated_at
    ) VALUES (?, ?, 'WR', 'BUF', 25, 0, ?, ?)`,
  ).run(playerId, name, dynastyValue, '2026-05-18T00:00:00.000Z');
}

// @spec DFF-ENGINE-030
// @spec DFF-ENGINE-031
// @spec DFF-ENGINE-032
test('createBotChainCoordinator de-duplicates concurrent trigger calls for the same draft', async () => {
  await withDatabase(async (db, databasePath) => {
    seedPlayer(db, 'player-1', 'Player One', 6000);
    seedPlayer(db, 'player-2', 'Player Two', 5900);
    seedPlayer(db, 'player-3', 'Player Three', 5800);

    const draftId = createDraft({
      databasePath,
      config: {
        teamCount: 4,
        rounds: 1,
        scoringFormat: 'ppr',
        userPickPosition: 4,
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

    let sleepCalls = 0;
    let releaseFirstSleep: (() => void) | undefined;
    const firstSleepGate = new Promise<void>((resolve) => {
      releaseFirstSleep = resolve;
    });

    const botChain = createBotChainCoordinator({
      databasePath,
      now: () => '2026-05-18T20:05:00.000Z',
      sleep: async () => {
        sleepCalls += 1;

        if (sleepCalls === 1) {
          await firstSleepGate;
        }
      },
    });

    botChain.trigger(draftId);
    botChain.trigger(draftId);

    const picksBeforeRelease = db
      .prepare('SELECT COUNT(*) AS count FROM picks WHERE draft_id = ?')
      .get(draftId) as { count: number };

    assert.equal(picksBeforeRelease.count, 0);

    releaseFirstSleep?.();
    await botChain.waitForIdle(draftId);

    const persistedPicks = db
      .prepare(
        `SELECT pick_number, player_id
         FROM picks
         WHERE draft_id = ?
         ORDER BY pick_number`,
      )
      .all(draftId) as Array<{ pick_number: number; player_id: string }>;

    assert.equal(sleepCalls, 3);
    assert.deepEqual(persistedPicks, [
      { pick_number: 1, player_id: 'player-1' },
      { pick_number: 2, player_id: 'player-2' },
      { pick_number: 3, player_id: 'player-3' },
    ]);
  });
});

// @spec DFF-ENGINE-033
// @spec DFF-ENGINE-040
test('createBotChainCoordinator clears the pending trade when accepted trade persistence fails', async () => {
  await withDatabase(async (db, databasePath) => {
    seedPlayer(db, 'player-1', 'Player One', 6000);
    seedPlayer(db, 'player-2', 'Player Two', 5900);

    const draftId = createDraft({
      databasePath,
      config: {
        teamCount: 3,
        rounds: 1,
        scoringFormat: 'ppr',
        userPickPosition: 3,
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

    const teams = db
      .prepare('SELECT id, is_user FROM teams WHERE draft_id = ? ORDER BY pick_position')
      .all(draftId) as Array<{ id: string; is_user: number }>;
    const receivingTeamId = teams.find((team) => team.is_user === 0)!.id;

    const botChain = createBotChainCoordinator({
      databasePath,
      now: () => '2026-05-18T20:05:00.000Z',
      sleep: async () => undefined,
      decideBotAction: ({ slot }) => ({
        type: 'trade',
        tradeId: 'trade-failure',
        initiatingTeamId: slot.teamId,
        receivingTeamId,
        assetsSent: [{ type: 'player', player_id: 'missing-player' }],
        assetsReceived: [],
        isBotToBot: true,
      }),
    });

    botChain.trigger(draftId);

    let seenFailure = false;

    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        const resolved = botChain.resolvePendingTrade(draftId, 'accepted');

        if (!resolved) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          continue;
        }
      } catch (error) {
        assert.match(String(error), /Trade asset transfer failed for player missing-player\./);
        seenFailure = true;
        break;
      }
    }

    assert.equal(seenFailure, true);
    assert.equal(botChain.resolvePendingTrade(draftId, 'accepted'), false);

    await botChain.waitForIdle(draftId);
  });
});

// @spec DFF-ENGINE-034
test('createBotChainCoordinator can persist a user trade offer when an older sequence-style trade id already exists', async () => {
  await withDatabase(async (db, databasePath) => {
    seedPlayer(db, 'player-1', 'Player One', 6000);

    const draftId = createDraft({
      databasePath,
      config: {
        teamCount: 3,
        rounds: 1,
        scoringFormat: 'ppr',
        userPickPosition: 1,
        futurePickYears: 2,
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

    const teams = db
      .prepare('SELECT id, is_user FROM teams WHERE draft_id = ? ORDER BY pick_position')
      .all(draftId) as Array<{ id: string; is_user: number }>;
    const botTeamId = teams.find((team) => team.is_user === 0)!.id;

    db.prepare(
      `INSERT INTO trades (
        id, draft_id, pick_number, round, initiating_team_id, receiving_team_id, assets_sent, assets_received, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'trade-user-offer-1',
      draftId,
      1,
      1,
      teams[0]!.id,
      botTeamId,
      JSON.stringify([{ type: 'future_pick', year: 2027, round: 1 }]),
      JSON.stringify([{ type: 'future_pick', year: 2027, round: 2 }]),
      'declined',
      '2026-05-18T20:01:00.000Z',
    );

    const botChain = createBotChainCoordinator({
      databasePath,
      now: () => '2026-05-18T20:05:00.000Z',
      sleep: async () => undefined,
      idGenerator: () => 'trade-user-offer-2',
    });

    const tradeId = botChain.submitUserTradeOffer({
      draftId,
      targetTeamId: botTeamId,
      offeredAssets: [{ type: 'future_pick', year: 2027, round: 1 }],
      requestedAssets: [{ type: 'future_pick', year: 2027, round: 2 }],
    });

    assert.equal(tradeId, 'trade-user-offer-2');

    await new Promise((resolve) => setTimeout(resolve, 0));

    const persistedTrades = db
      .prepare('SELECT id FROM trades WHERE draft_id = ? ORDER BY created_at, id')
      .all(draftId) as Array<{ id: string }>;

    assert.deepEqual(persistedTrades, [{ id: 'trade-user-offer-1' }, { id: 'trade-user-offer-2' }]);
  });
});
