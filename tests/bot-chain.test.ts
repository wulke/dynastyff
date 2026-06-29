// @spec DFF-ENGINE-030
// @spec DFF-ENGINE-031
// @spec DFF-ENGINE-032
// @spec DFF-ENGINE-033
// @spec DFF-ENGINE-040
// @spec DFF-ENGINE-039
// @spec DFF-ENGINE-039b
// @spec DFF-SPKV-052
// @spec DFF-BOT-004
// @spec DFF-BOT-030
// @spec DFF-BOT-031
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { initializeDatabase } from '../src/db/init.js';
import {
  buildConservativeStartupPickValues,
  createBotChainCoordinator,
} from '../src/draft/bot-chain.js';
import type { ArchetypeConfig } from '../src/draft/archetype-config.js';
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

function seedCustomPlayer(
  db: Database.Database,
  options: {
    id: string;
    name: string;
    position: 'QB' | 'RB' | 'WR' | 'TE';
    age: number;
    dynastyValue: number;
  },
): void {
  db.prepare(
    `INSERT INTO players (
      id, name, position, nfl_team, age, is_rookie, dynasty_value, updated_at
    ) VALUES (?, ?, ?, 'BUF', ?, 0, ?, ?)`,
  ).run(
    options.id,
    options.name,
    options.position,
    options.age,
    options.dynastyValue,
    '2026-05-18T00:00:00.000Z',
  );
}

function assignDraftedPlayerToTeam(
  db: Database.Database,
  options: {
    draftId: string;
    teamId: string;
    playerId: string;
    slotIndex: number;
    pickedAt: string;
  },
): void {
  const draftSlot = db
    .prepare(
      `SELECT id, pick_number, round
       FROM draft_order
       WHERE draft_id = ? AND team_id = ?
       ORDER BY pick_number
       LIMIT 1 OFFSET ?`,
    )
    .get(options.draftId, options.teamId, options.slotIndex) as
    | { id: string; pick_number: number; round: number }
    | undefined;

  assert.ok(draftSlot);

  db.prepare(
    `INSERT INTO picks (
      id, draft_id, draft_order_id, team_id, player_id, pick_number, round, picked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `pick-${options.draftId}-${options.playerId}`,
    options.draftId,
    draftSlot.id,
    options.teamId,
    options.playerId,
    draftSlot.pick_number,
    draftSlot.round,
    options.pickedAt,
  );

  db.prepare(
    'INSERT INTO roster_players (id, draft_id, team_id, player_id) VALUES (?, ?, ?, ?)',
  ).run(
    `roster-${options.draftId}-${options.playerId}`,
    options.draftId,
    options.teamId,
    options.playerId,
  );
}

// @spec DFF-BOT-004
function buildArchetypeConfigWithRandomness(randomness: number): ArchetypeConfig & { randomness: number } {
  return {
    randomness,
    archetypes: {
      win_now: {
        acceptanceThreshold: 0.85,
        needModifier: 0.25,
        preferredPositionValueFloors: { QB: 3500, RB: 3500, WR: 3500, TE: 3500 },
        tradeAggressivenessProbability: 0.25,
        valueWeight: 0.6,
      },
      punt: {
        acceptanceThreshold: 1.15,
        needModifier: 0.25,
        preferredPositionValueFloors: { QB: 2500, RB: 2500, WR: 2500, TE: 2500 },
        tradeAggressivenessProbability: 0.35,
        valueWeight: 0.9,
      },
      rb_heavy: {
        acceptanceThreshold: 0.95,
        needModifier: 0.25,
        preferredPositionValueFloors: { QB: 2000, RB: 3500, WR: 2000, TE: 2000 },
        tradeAggressivenessProbability: 0.2,
        valueWeight: 0.7,
      },
      qb_early: {
        acceptanceThreshold: 0.95,
        needModifier: 0.25,
        preferredPositionValueFloors: { QB: 4000, RB: 2000, WR: 2000, TE: 2000 },
        tradeAggressivenessProbability: 0.2,
        valueWeight: 0.5,
      },
      bpa: {
        acceptanceThreshold: 1.05,
        needModifier: 0.05,
        preferredPositionValueFloors: { QB: 2500, RB: 2500, WR: 2500, TE: 2500 },
        tradeAggressivenessProbability: 0.1,
        valueWeight: 1,
      },
      balanced: {
        acceptanceThreshold: 1,
        needModifier: 0.25,
        preferredPositionValueFloors: { QB: 2500, RB: 2500, WR: 2500, TE: 2500 },
        tradeAggressivenessProbability: 0.15,
        valueWeight: 0.8,
      },
    },
  };
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
      randomness: 0,
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

// @spec DFF-BOT-004
// @spec DFF-BOT-030
// @spec DFF-BOT-031
test('createBotChainCoordinator honors randomness boundaries and the documented default pick-selection behavior', async () => {
  await withDatabase(async (db, databasePath) => {
    seedPlayer(db, 'player-1', 'Player One', 100);
    seedPlayer(db, 'player-2', 'Player Two', 99);
    seedPlayer(db, 'player-3', 'Player Zebra', 1);

    const createOneBotDraft = () =>
      createDraft({
        databasePath,
        config: {
          teamCount: 2,
          rounds: 1,
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

    const topPickDraftId = createOneBotDraft();
    const coordinatorOverrideDraftId = createOneBotDraft();
    const defaultRandomnessDraftId = createOneBotDraft();

    const topPickCoordinator = createBotChainCoordinator({
      databasePath,
      archetypeConfig: buildArchetypeConfigWithRandomness(0),
      now: () => '2026-05-18T20:05:00.000Z',
      random: () => 0.999,
      sleep: async () => undefined,
    });

    const noisyCoordinator = createBotChainCoordinator({
      databasePath,
      archetypeConfig: buildArchetypeConfigWithRandomness(0),
      randomness: 1,
      now: () => '2026-05-18T20:06:00.000Z',
      random: (() => {
        const values = [0.999, 0, 0.99, 0];
        let index = 0;
        return () => values[index++] ?? 0;
      })(),
      sleep: async () => undefined,
    });

    const defaultRandomnessCoordinator = createBotChainCoordinator({
      databasePath,
      now: () => '2026-05-18T20:07:00.000Z',
      random: () => 0.98,
      sleep: async () => undefined,
    });

    topPickCoordinator.trigger(topPickDraftId);
    noisyCoordinator.trigger(coordinatorOverrideDraftId);
    defaultRandomnessCoordinator.trigger(defaultRandomnessDraftId);

    await Promise.all([
      topPickCoordinator.waitForIdle(topPickDraftId),
      noisyCoordinator.waitForIdle(coordinatorOverrideDraftId),
      defaultRandomnessCoordinator.waitForIdle(defaultRandomnessDraftId),
    ]);

    const persistedPicks = db
      .prepare(
        `SELECT draft_id, player_id
         FROM picks
         WHERE draft_id IN (?, ?, ?)
         ORDER BY draft_id`,
      )
      .all(topPickDraftId, coordinatorOverrideDraftId, defaultRandomnessDraftId) as Array<{
      draft_id: string;
      player_id: string;
    }>;

    const playerByDraftId = new Map(persistedPicks.map((pick) => [pick.draft_id, pick.player_id]));

    assert.equal(playerByDraftId.get(topPickDraftId), 'player-1');
    assert.equal(playerByDraftId.get(coordinatorOverrideDraftId), 'player-2');
    assert.equal(playerByDraftId.get(defaultRandomnessDraftId), 'player-2');
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

// @spec DFF-SPKV-052
test('buildConservativeStartupPickValues reduces startup pick slot values as the player pool thins', () => {
  const startupPickValues = buildConservativeStartupPickValues({
    currentPickNumber: 2,
    availablePlayers: [
      { id: 'player-1', name: 'Player One', position: 'WR', nfl_team: 'BUF', age: 25, is_rookie: false, dynasty_value: 4800, adp: 1 },
      { id: 'player-2', name: 'Player Two', position: 'WR', nfl_team: 'BUF', age: 24, is_rookie: false, dynasty_value: 4300, adp: 2 },
      { id: 'player-3', name: 'Player Three', position: 'WR', nfl_team: 'BUF', age: 23, is_rookie: false, dynasty_value: 4100, adp: 3 },
    ],
    startupPickValues: [
      { global_pick_number: 3, dynasty_value: 5000 },
      { global_pick_number: 5, dynasty_value: 4200 },
    ],
  });

  assert.deepEqual([...startupPickValues.entries()], [
    [3, 4800],
    [5, 4100],
  ]);
});

// @spec DFF-SPKV-052
test('buildConservativeStartupPickValues falls back to ETL values when no derived value input is available', () => {
  assert.deepEqual(
    [
      ...buildConservativeStartupPickValues({
        currentPickNumber: null,
        availablePlayers: [
          { id: 'player-1', name: 'Player One', position: 'WR', nfl_team: 'BUF', age: 25, is_rookie: false, dynasty_value: 4800, adp: 1 },
        ],
        startupPickValues: [{ global_pick_number: 3, dynasty_value: 5000 }],
      }).entries(),
    ],
    [[3, 5000]],
  );

  assert.deepEqual(
    [
      ...buildConservativeStartupPickValues({
        currentPickNumber: 2,
        availablePlayers: [],
        startupPickValues: [{ global_pick_number: 3, dynasty_value: 5000 }],
      }).entries(),
    ],
    [[3, 5000]],
  );
});

// @spec DFF-SPKV-052
test('createBotChainCoordinator evaluates received startup pick slots with the conservative startup value map', async () => {
  await withDatabase(async (db, databasePath) => {
    seedPlayer(db, 'player-1', 'Player One', 4600);
    seedPlayer(db, 'player-2', 'Player Two', 4400);
    seedPlayer(db, 'player-3', 'Player Three', 4200);

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

    db.prepare('UPDATE drafts SET startup_pick_values = ? WHERE id = ?').run(
      JSON.stringify([{ globalPickNumber: 3, dynastyValue: 5000 }]),
      draftId,
    );

    const teams = db
      .prepare('SELECT id, is_user, pick_position FROM teams WHERE draft_id = ? ORDER BY pick_position')
      .all(draftId) as Array<{ id: string; is_user: number; pick_position: number }>;
    const userTeamId = teams.find((team) => team.is_user === 1)!.id;
    const botTeamId = teams.find((team) => team.is_user === 0 && team.pick_position === 2)!.id;

    db.prepare("UPDATE teams SET archetype = 'balanced' WHERE id = ?").run(botTeamId);

    const botChain = createBotChainCoordinator({
      databasePath,
      now: () => '2026-05-18T20:05:00.000Z',
      sleep: async () => undefined,
      idGenerator: () => 'trade-user-offer-conservative',
    });

    const tradeId = botChain.submitUserTradeOffer({
      draftId,
      targetTeamId: botTeamId,
      offeredAssets: [{ type: 'pick_slot', draft_order_id: 'ignored-by-parser', pick_number: 3 }],
      requestedAssets: [{ type: 'future_pick', year: 2027, round: 1 }],
    });

    assert.equal(tradeId, 'trade-user-offer-conservative');
    assert.notEqual(userTeamId, botTeamId);

    await new Promise((resolve) => setTimeout(resolve, 0));

    const persistedTrade = db
      .prepare('SELECT status FROM trades WHERE id = ?')
      .get(tradeId) as { status: string } | undefined;

    assert.deepEqual(persistedTrade, { status: 'declined' });
  });
});

// @spec DFF-BOT-001
// @spec DFF-BOT-002
test('createBotChainCoordinator uses the injected archetype config when evaluating a user trade offer', async () => {
  await withDatabase(async (db, databasePath) => {
    seedPlayer(db, 'player-1', 'Player One', 4600);
    seedPlayer(db, 'player-2', 'Player Two', 4400);
    seedPlayer(db, 'player-3', 'Player Three', 4200);

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

    db.prepare('UPDATE drafts SET startup_pick_values = ? WHERE id = ?').run(
      JSON.stringify([{ globalPickNumber: 3, dynastyValue: 5000 }]),
      draftId,
    );

    const teams = db
      .prepare('SELECT id, is_user, pick_position FROM teams WHERE draft_id = ? ORDER BY pick_position')
      .all(draftId) as Array<{ id: string; is_user: number; pick_position: number }>;
    const botTeamId = teams.find((team) => team.is_user === 0 && team.pick_position === 2)!.id;

    db.prepare("UPDATE teams SET archetype = 'balanced' WHERE id = ?").run(botTeamId);

    const archetypeConfig: ArchetypeConfig = {
      randomness: 0.3,
      archetypes: {
        win_now: {
          acceptanceThreshold: 0.85,
          needModifier: 1.3,
          preferredPositionValueFloors: { QB: 3500, RB: 3500, WR: 3500, TE: 3500 },
          tradeAggressivenessProbability: 0.25,
          valueWeight: 0.6,
        },
        punt: {
          acceptanceThreshold: 1.15,
          needModifier: 0.4,
          preferredPositionValueFloors: { QB: 2500, RB: 2500, WR: 2500, TE: 2500 },
          tradeAggressivenessProbability: 0.35,
          valueWeight: 0.9,
        },
        rb_heavy: {
          acceptanceThreshold: 0.95,
          needModifier: 1,
          preferredPositionValueFloors: { QB: 2000, RB: 3500, WR: 2000, TE: 2000 },
          tradeAggressivenessProbability: 0.2,
          valueWeight: 0.7,
        },
        qb_early: {
          acceptanceThreshold: 0.95,
          needModifier: 1,
          preferredPositionValueFloors: { QB: 4000, RB: 2000, WR: 2000, TE: 2000 },
          tradeAggressivenessProbability: 0.2,
          valueWeight: 0.5,
        },
        bpa: {
          acceptanceThreshold: 1.05,
          needModifier: 0.1,
          preferredPositionValueFloors: { QB: 2500, RB: 2500, WR: 2500, TE: 2500 },
          tradeAggressivenessProbability: 0.1,
          valueWeight: 1,
        },
        balanced: {
          acceptanceThreshold: 0.7,
          needModifier: 1,
          preferredPositionValueFloors: { QB: 2500, RB: 2500, WR: 2500, TE: 2500 },
          tradeAggressivenessProbability: 0.15,
          valueWeight: 0.8,
        },
      },
    };

    const botChain = createBotChainCoordinator({
      databasePath,
      archetypeConfig,
      now: () => '2026-05-18T20:05:00.000Z',
      sleep: async () => undefined,
      idGenerator: () => 'trade-user-offer-config-threshold',
    });

    const tradeId = botChain.submitUserTradeOffer({
      draftId,
      targetTeamId: botTeamId,
      offeredAssets: [{ type: 'pick_slot', draft_order_id: 'ignored-by-parser', pick_number: 3 }],
      requestedAssets: [{ type: 'future_pick', year: 2027, round: 1 }],
    });

    assert.equal(tradeId, 'trade-user-offer-config-threshold');

    await new Promise((resolve) => setTimeout(resolve, 0));

    const persistedTrade = db
      .prepare('SELECT status FROM trades WHERE id = ?')
      .get(tradeId) as { status: string } | undefined;

    assert.deepEqual(persistedTrade, { status: 'accepted' });
  });
});

// @spec DFF-BOT-050
// @spec DFF-BOT-051
test('createBotChainCoordinator declines user trade offers that request receiving-bot protected assets', async () => {
  await withDatabase(async (db, databasePath) => {
    const scenarios = [
      {
        archetype: 'rb_heavy',
        requestedPlayerId: 'rb-elite-1',
        offeredAssets: [{ type: 'future_pick', year: 2027, round: 1 }],
        botPlayerIds: ['rb-elite-1', 'rb-elite-2', 'wr-depth-1'],
        userPlayerIds: ['user-chip-1'],
        players: [
          { id: 'rb-elite-1', name: 'RB Elite One', position: 'RB' as const, age: 25, dynastyValue: 6200 },
          { id: 'rb-elite-2', name: 'RB Elite Two', position: 'RB' as const, age: 24, dynastyValue: 5900 },
          { id: 'wr-depth-1', name: 'WR Depth One', position: 'WR' as const, age: 26, dynastyValue: 4300 },
          { id: 'user-chip-1', name: 'User Chip One', position: 'WR' as const, age: 24, dynastyValue: 6100 },
        ],
      },
      {
        archetype: 'qb_early',
        requestedPlayerId: 'qb-anchor-1',
        offeredAssets: [{ type: 'future_pick', year: 2027, round: 1 }],
        botPlayerIds: ['qb-anchor-1', 'qb-depth-1', 'wr-depth-2'],
        userPlayerIds: ['user-chip-2'],
        players: [
          { id: 'qb-anchor-1', name: 'QB Anchor One', position: 'QB' as const, age: 26, dynastyValue: 7000 },
          { id: 'qb-depth-1', name: 'QB Depth One', position: 'QB' as const, age: 24, dynastyValue: 4800 },
          { id: 'wr-depth-2', name: 'WR Depth Two', position: 'WR' as const, age: 25, dynastyValue: 4100 },
          { id: 'user-chip-2', name: 'User Chip Two', position: 'WR' as const, age: 23, dynastyValue: 6100 },
        ],
      },
      {
        archetype: 'win_now',
        requestedPlayerId: 'vet-stud-1',
        offeredAssets: [{ type: 'future_pick', year: 2027, round: 1 }],
        botPlayerIds: ['vet-stud-1', 'young-core-1'],
        userPlayerIds: ['user-chip-3'],
        players: [
          { id: 'vet-stud-1', name: 'Vet Stud One', position: 'WR' as const, age: 29, dynastyValue: 5100 },
          { id: 'young-core-1', name: 'Young Core One', position: 'WR' as const, age: 24, dynastyValue: 4200 },
          { id: 'user-chip-3', name: 'User Chip Three', position: 'RB' as const, age: 23, dynastyValue: 6100 },
        ],
      },
    ] as const;

    for (const scenario of scenarios) {
      for (const player of scenario.players) {
        seedCustomPlayer(db, player);
      }
    }

    for (const [index, scenario] of scenarios.entries()) {
      const draftId = createDraft({
        databasePath,
        config: {
          teamCount: 2,
          rounds: 3,
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
        now: () => `2026-05-18T20:0${index}:00.000Z`,
        random: () => 0,
      });

      const teams = db
        .prepare('SELECT id, is_user FROM teams WHERE draft_id = ? ORDER BY pick_position')
        .all(draftId) as Array<{ id: string; is_user: number }>;
      const userTeamId = teams.find((team) => team.is_user === 1)!.id;
      const botTeamId = teams.find((team) => team.is_user === 0)!.id;

      db.prepare('UPDATE teams SET archetype = ? WHERE id = ?').run(scenario.archetype, botTeamId);

      for (const [slotIndex, playerId] of scenario.botPlayerIds.entries()) {
        assignDraftedPlayerToTeam(db, {
          draftId,
          teamId: botTeamId,
          playerId,
          slotIndex,
          pickedAt: `2026-05-18T20:1${index}:00.000Z`,
        });
      }

      for (const [slotIndex, playerId] of scenario.userPlayerIds.entries()) {
        assignDraftedPlayerToTeam(db, {
          draftId,
          teamId: userTeamId,
          playerId,
          slotIndex,
          pickedAt: `2026-05-18T20:2${index}:00.000Z`,
        });
      }

      const botChain = createBotChainCoordinator({
        databasePath,
        archetypeConfig: buildArchetypeConfigWithRandomness(0.3),
        now: () => `2026-05-18T21:0${index}:00.000Z`,
        sleep: async () => undefined,
        idGenerator: () => `trade-protected-${scenario.archetype}`,
      });

      const tradeId = botChain.submitUserTradeOffer({
        draftId,
        targetTeamId: botTeamId,
        offeredAssets: scenario.offeredAssets,
        requestedAssets: [{ type: 'player', player_id: scenario.requestedPlayerId }],
      });

      assert.equal(tradeId, `trade-protected-${scenario.archetype}`);

      await new Promise((resolve) => setTimeout(resolve, 0));

      const persistedTrade = db
        .prepare('SELECT status FROM trades WHERE id = ?')
        .get(tradeId) as { status: string } | undefined;

      assert.deepEqual(persistedTrade, { status: 'declined' });
    }
  });
});
