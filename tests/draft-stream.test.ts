// @spec DFF-ENGINE-010
// @spec DFF-ENGINE-011
// @spec DFF-ENGINE-012
// @spec DFF-ENGINE-013
// @spec DFF-ENGINE-014
// @spec DFF-ENGINE-015
import test from 'node:test';
import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Request, Response } from 'express';

import { initializeDatabase } from '../src/db/init.js';
import { createBotChainCoordinator } from '../src/draft/bot-chain.js';
import {
  createDraft,
  emitTradeOffered,
  emitTradeResolved,
  recordPick,
} from '../src/draft/service.js';
import {
  createDraftPickRoute,
  createDraftStreamRoute,
  createDraftTradeOfferRoute,
  createDraftTradeResponseRoute,
} from '../src/server/app.js';

type StreamEvent = {
  event: string;
  data: unknown;
};

type StreamConnection = {
  statusCode: number;
  headers: Record<string, string>;
  events: StreamEvent[];
  ended: boolean;
  notify?: () => void;
  jsonBody?: unknown;
  close: () => void;
};

function createTempDatabasePath(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(tempDir, 'test.sqlite');
}

function seedPlayer(db: Database.Database, playerId: string, name: string): void {
  db.prepare(
    `INSERT INTO players (
      id, name, position, nfl_team, age, is_rookie, dynasty_value, updated_at
    ) VALUES (?, ?, 'QB', 'BUF', 25, 0, 5000, ?)`,
  ).run(playerId, name, '2026-05-18T00:00:00.000Z');
}

async function withDraftServer(
  run: (context: {
    databasePath: string;
    database: Database.Database;
  }) => Promise<void>,
): Promise<void> {
  const databasePath = createTempDatabasePath('dynastyff-draft-stream-');
  initializeDatabase(databasePath);
  const database = new Database(databasePath);
  database.pragma('foreign_keys = ON');

  try {
    await run({ databasePath, database });
  } finally {
    database.close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
}

async function connectToDraftStream(databasePath: string, draftId: string) {
  const route = createDraftStreamRoute({ databasePath });
  const request = new EventEmitter() as Request & EventEmitter;
  request.params = { id: draftId };

  const headers: Record<string, string> = {};
  const events: StreamEvent[] = [];
  let buffer = '';
  let statusCode = 200;
  let ended = false;
  let notify: (() => void) | undefined;
  let jsonBody: unknown;

  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    flushHeaders() {
      return this;
    },
    write(chunk: string) {
      buffer += chunk;

      while (buffer.includes('\n\n')) {
        const separatorIndex = buffer.indexOf('\n\n');
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);

        const lines = rawEvent.split('\n');
        const eventName = lines
          .filter((line) => line.startsWith('event:'))
          .map((line) => line.slice('event:'.length).trim())
          .at(0);
        const dataPayload = lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice('data:'.length).trim())
          .join('\n');

        if (!eventName) {
          continue;
        }

        events.push({
          event: eventName,
          data: JSON.parse(dataPayload),
        });
        notify?.();
      }

      return true;
    },
    end() {
      ended = true;
      notify?.();
      return this;
    },
    json(body: unknown) {
      jsonBody = body;
      notify?.();
      return this;
    },
  } as unknown as Response;

  route(request, response, () => undefined);
  return {
    statusCode,
    headers,
    events,
    jsonBody,
    get ended() {
      return ended;
    },
    set notify(callback: (() => void) | undefined) {
      notify = callback;
    },
    get notify() {
      return notify;
    },
    close() {
      request.emit('close');
    },
  } as StreamConnection;
}

async function invokePickRoute(
  databasePath: string,
  draftId: string,
  body: unknown,
  botChain = createBotChainCoordinator({ databasePath }),
) {
  const route = createDraftPickRoute({ databasePath, botChain });
  const request = { body, params: { id: draftId } } as unknown as Request;
  let statusCode = 200;
  let jsonBody: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(bodyJson: unknown) {
      jsonBody = bodyJson;
      return this;
    },
  } as Response;

  await Promise.resolve(route(request, response, () => undefined));

  return { statusCode, jsonBody };
}

async function invokeTradeResponseRoute(
  databasePath: string,
  draftId: string,
  body: unknown,
  botChain = createBotChainCoordinator({ databasePath }),
) {
  const route = createDraftTradeResponseRoute({ databasePath, botChain });
  const request = { body, params: { id: draftId } } as unknown as Request;
  let statusCode = 200;
  let jsonBody: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(bodyJson: unknown) {
      jsonBody = bodyJson;
      return this;
    },
  } as Response;

  await Promise.resolve(route(request, response, () => undefined));

  return { statusCode, jsonBody };
}

async function invokeTradeOfferRoute(
  databasePath: string,
  draftId: string,
  body: unknown,
  botChain = createBotChainCoordinator({ databasePath }),
) {
  const route = createDraftTradeOfferRoute({ databasePath, botChain });
  const request = { body, params: { id: draftId } } as unknown as Request;
  let statusCode = 200;
  let jsonBody: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(bodyJson: unknown) {
      jsonBody = bodyJson;
      return this;
    },
  } as Response;

  await Promise.resolve(route(request, response, () => undefined));

  return { statusCode, jsonBody };
}

function assertSseConnection(connection: StreamConnection): void {
  assert.equal(connection.statusCode, 200);
  assert.equal(connection.headers['content-type'], 'text/event-stream; charset=utf-8');
}

async function readStreamEvent(
  connection: StreamConnection,
  timeoutMs = 2_000,
): Promise<StreamEvent> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (connection.events.length > 0) {
      return connection.events.shift() as StreamEvent;
    }

    if (connection.ended) {
      throw new Error('SSE stream ended before the expected event arrived.');
    }

    await Promise.race([
      new Promise<void>((resolve) => {
        connection.notify = resolve;
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Timed out waiting for SSE event.')), timeoutMs);
      }),
    ]);
  }

  throw new Error('Timed out waiting for SSE event.');
}

// @spec DFF-ENGINE-010
// @spec DFF-ENGINE-011
// @spec DFF-ENGINE-012
test('GET /drafts/:id/stream returns state_sync immediately and emits pick_made plus your_turn as picks are recorded', async () => {
  await withDraftServer(async ({ databasePath, database }) => {
    seedPlayer(database, 'player-1', 'Player One');
    seedPlayer(database, 'player-2', 'Player Two');

    const draftId = createDraft({
      databasePath,
      config: {
        teamCount: 2,
        rounds: 2,
        scoringFormat: 'ppr',
        userPickPosition: 2,
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

    const slots = database
      .prepare(
        `SELECT id, pick_number, round, pick_in_round
         FROM draft_order
         WHERE draft_id = ?
         ORDER BY pick_number`,
      )
      .all(draftId) as Array<{ id: string; pick_number: number; round: number; pick_in_round: number }>;

    const stream = await connectToDraftStream(databasePath, draftId);
    assertSseConnection(stream);

    try {
      const initialEvent = await readStreamEvent(stream);

      assert.equal(initialEvent.event, 'state_sync');
      const stateSync = initialEvent.data as {
        draft_id: string;
        status: string;
        current_pick_number: number | null;
        teams: Array<{ id: string; name: string; is_user: boolean; archetype: string | null }>;
        draft_order: Array<{
          pick_number: number;
          round: number;
          pick_in_round: number;
          team_id: string;
        }>;
        picks: unknown[];
        roster_players: unknown[];
        team_pick_assets: Array<{ team_id: string; year: number; round: number }>;
        user_queue: unknown[];
        available_players: Array<{ id: string; dynasty_value: number }>;
      };

      assert.equal(stateSync.draft_id, draftId);
      assert.equal(stateSync.status, 'in_progress');
      assert.equal(stateSync.current_pick_number, 1);
      assert.equal(stateSync.teams.length, 2);
      assert.deepEqual(
        stateSync.teams.map((team) => ({
          name: team.name,
          is_user: team.is_user,
          archetype: team.archetype,
        })),
        [
          { name: 'Bob', is_user: false, archetype: 'win_now' },
          { name: 'You', is_user: true, archetype: null },
        ],
      );
      assert.deepEqual(stateSync.draft_order, [
        {
          pick_number: 1,
          round: 1,
          pick_in_round: 1,
          team_id: stateSync.teams[0]?.id,
        },
        {
          pick_number: 2,
          round: 1,
          pick_in_round: 2,
          team_id: stateSync.teams[1]?.id,
        },
        {
          pick_number: 3,
          round: 2,
          pick_in_round: 1,
          team_id: stateSync.teams[1]?.id,
        },
        {
          pick_number: 4,
          round: 2,
          pick_in_round: 2,
          team_id: stateSync.teams[0]?.id,
        },
      ]);
      assert.deepEqual(stateSync.picks, []);
      assert.deepEqual(stateSync.roster_players, []);
      assert.equal(stateSync.team_pick_assets.length, 4);
      assert.deepEqual(stateSync.user_queue, []);
      assert.deepEqual(
        stateSync.available_players.map((player) => ({
          id: player.id,
          dynasty_value: player.dynasty_value,
        })),
        [
          { id: 'player-1', dynasty_value: 5000 },
          { id: 'player-2', dynasty_value: 5000 },
        ],
      );

      recordPick({
        databasePath,
        draftOrderId: slots[0].id,
        playerId: 'player-1',
        now: () => '2026-05-18T20:05:00.000Z',
      });

      const pickMade = await readStreamEvent(stream);
      assert.equal(pickMade.event, 'pick_made');
      assert.deepEqual(pickMade.data, {
        pick_number: 1,
        team_id: stateSync.teams[0]?.id,
        player_id: 'player-1',
        is_bot: true,
      });

      const yourTurn = await readStreamEvent(stream);
      assert.equal(yourTurn.event, 'your_turn');
      assert.deepEqual(yourTurn.data, {
        pick_number: 2,
        round: 1,
        pick_in_round: 2,
      });
    } finally {
      stream.close();
    }
  });
});

// @spec DFF-ENGINE-010
test('GET /drafts/:id/stream returns 404 when the draft does not exist', async () => {
  await withDraftServer(async ({ databasePath }) => {
    const stream = await connectToDraftStream(databasePath, 'missing-draft');

    assert.equal(stream.statusCode, 404);
    assert.deepEqual(stream.jsonBody, { error: 'Draft not found.' });
  });
});

// @spec DFF-ENGINE-011
// @spec DFF-ENGINE-012
test('GET /drafts/:id/stream does not emit your_turn when the next open slot belongs to a bot', async () => {
  await withDraftServer(async ({ databasePath, database }) => {
    seedPlayer(database, 'player-1', 'Player One');

    const draftId = createDraft({
      databasePath,
      config: {
        teamCount: 2,
        rounds: 2,
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

    const firstSlot = database
      .prepare(
        `SELECT id
         FROM draft_order
         WHERE draft_id = ?
         ORDER BY pick_number
         LIMIT 1`,
      )
      .get(draftId) as { id: string };

    const stream = await connectToDraftStream(databasePath, draftId);
    assertSseConnection(stream);

    try {
      await readStreamEvent(stream);

      recordPick({
        databasePath,
        draftOrderId: firstSlot.id,
        playerId: 'player-1',
        now: () => '2026-05-18T20:05:00.000Z',
      });

      const pickMade = await readStreamEvent(stream);
      assert.equal(pickMade.event, 'pick_made');
      assert.equal(stream.events.length, 0);
    } finally {
      stream.close();
    }
  });
});

// @spec DFF-ENGINE-013
// @spec DFF-ENGINE-014
test('GET /drafts/:id/stream emits trade_offered and trade_resolved events', async () => {
  await withDraftServer(async ({ databasePath }) => {
    const draftId = createDraft({
      databasePath,
      config: {
        teamCount: 2,
        rounds: 1,
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

    const stream = await connectToDraftStream(databasePath, draftId);
    assertSseConnection(stream);

    try {
      await readStreamEvent(stream);

      emitTradeOffered({
        draftId,
        tradeId: 'trade-1',
        initiatingTeamId: 'team-1',
        receivingTeamId: 'team-2',
        assetsSent: [{ type: 'player', player_id: 'player-1' }],
        assetsReceived: [{ type: 'pick', year: 2027, round: 1 }],
        isBotToBot: true,
      });

      const tradeOffered = await readStreamEvent(stream);
      assert.equal(tradeOffered.event, 'trade_offered');
      assert.deepEqual(tradeOffered.data, {
        trade_id: 'trade-1',
        initiating_team_id: 'team-1',
        receiving_team_id: 'team-2',
        assets_sent: [{ type: 'player', player_id: 'player-1' }],
        assets_received: [{ type: 'pick', year: 2027, round: 1 }],
        is_bot_to_bot: true,
      });

      emitTradeResolved({
        draftId,
        tradeId: 'trade-1',
        status: 'accepted',
        assetsSent: [{ type: 'player', player_id: 'player-1' }],
        assetsReceived: [{ type: 'pick', year: 2027, round: 1 }],
      });

      const tradeResolved = await readStreamEvent(stream);
      assert.equal(tradeResolved.event, 'trade_resolved');
      assert.deepEqual(tradeResolved.data, {
        trade_id: 'trade-1',
        status: 'accepted',
        assets_sent: [{ type: 'player', player_id: 'player-1' }],
        assets_received: [{ type: 'pick', year: 2027, round: 1 }],
      });
    } finally {
      stream.close();
    }
  });
});

// @spec DFF-ENGINE-011
test('GET /drafts/:id/stream unregisters the listener when the client disconnects', async () => {
  await withDraftServer(async ({ databasePath, database }) => {
    seedPlayer(database, 'player-1', 'Player One');
    seedPlayer(database, 'player-2', 'Player Two');

    const draftId = createDraft({
      databasePath,
      config: {
        teamCount: 2,
        rounds: 2,
        scoringFormat: 'ppr',
        userPickPosition: 2,
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

    const slots = database
      .prepare(
        `SELECT id
         FROM draft_order
         WHERE draft_id = ?
         ORDER BY pick_number`,
      )
      .all(draftId) as Array<{ id: string }>;

    const stream = await connectToDraftStream(databasePath, draftId);
    assertSseConnection(stream);
    await readStreamEvent(stream);
    stream.close();

    recordPick({
      databasePath,
      draftOrderId: slots[0].id,
      playerId: 'player-1',
      now: () => '2026-05-18T20:05:00.000Z',
    });

    assert.equal(stream.events.length, 0);
  });
});

// @spec DFF-ENGINE-015
test('GET /drafts/:id/stream emits draft_complete and persists completed status when the final pick is recorded', async () => {
  await withDraftServer(async ({ databasePath, database }) => {
    seedPlayer(database, 'player-1', 'Player One');
    seedPlayer(database, 'player-2', 'Player Two');

    const draftId = createDraft({
      databasePath,
      config: {
        teamCount: 2,
        rounds: 1,
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

    const slots = database
      .prepare(
        `SELECT id
         FROM draft_order
         WHERE draft_id = ?
         ORDER BY pick_number`,
      )
      .all(draftId) as Array<{ id: string }>;

    const stream = await connectToDraftStream(databasePath, draftId);
    assertSseConnection(stream);

    try {
      await readStreamEvent(stream);

      recordPick({
        databasePath,
        draftOrderId: slots[0].id,
        playerId: 'player-1',
        now: () => '2026-05-18T20:05:00.000Z',
      });
      await readStreamEvent(stream);

      recordPick({
        databasePath,
        draftOrderId: slots[1].id,
        playerId: 'player-2',
        now: () => '2026-05-18T20:06:00.000Z',
      });

      const finalPick = await readStreamEvent(stream);
      assert.equal(finalPick.event, 'pick_made');

      const draftComplete = await readStreamEvent(stream);
      assert.equal(draftComplete.event, 'draft_complete');
      assert.deepEqual(draftComplete.data, {
        draft_id: draftId,
        completed_at: '2026-05-18T20:06:00.000Z',
      });

      const persistedDraft = database
        .prepare(`SELECT status, completed_at FROM drafts WHERE id = ?`)
        .get(draftId) as { status: string; completed_at: string | null };

      assert.deepEqual(persistedDraft, {
        status: 'completed',
        completed_at: '2026-05-18T20:06:00.000Z',
      });
    } finally {
      stream.close();
    }
  });
});

// @spec DFF-ENGINE-030
// @spec DFF-ENGINE-032
// @spec DFF-ENGINE-015
test('GET /drafts/:id/stream emits bot pick_made events and draft_complete when the bot chain finishes after a user pick', async () => {
  await withDraftServer(async ({ databasePath, database }) => {
    seedPlayer(database, 'player-1', 'Player One');
    database.prepare('UPDATE players SET dynasty_value = 6000 WHERE id = ?').run('player-1');
    seedPlayer(database, 'player-2', 'Player Two');
    database.prepare('UPDATE players SET dynasty_value = 5900 WHERE id = ?').run('player-2');

    const draftId = createDraft({
      databasePath,
      config: {
        teamCount: 2,
        rounds: 1,
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
    const botChain = createBotChainCoordinator({
      databasePath,
      now: () => '2026-05-18T20:05:00.000Z',
      sleep: async () => undefined,
    });
    const stream = await connectToDraftStream(databasePath, draftId);
    assertSseConnection(stream);

    try {
      const initialEvent = await readStreamEvent(stream);
      const stateSync = initialEvent.data as {
        teams: Array<{ id: string; is_user: boolean }>;
      };
      const userTeamId = stateSync.teams.find((team) => team.is_user)?.id;
      const botTeamIds = stateSync.teams.filter((team) => !team.is_user).map((team) => team.id);
      const botTeamId = botTeamIds[0];
      const receivingTeamId = botTeamIds[1];

      const response = await invokePickRoute(
        databasePath,
        draftId,
        { playerId: 'player-1' },
        botChain,
      );

      await botChain.waitForIdle(draftId);

      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.jsonBody, { ok: true });

      const userPick = await readStreamEvent(stream);
      assert.equal(userPick.event, 'pick_made');
      assert.deepEqual(userPick.data, {
        pick_number: 1,
        team_id: userTeamId,
        player_id: 'player-1',
        is_bot: false,
      });

      const botPick = await readStreamEvent(stream);
      assert.equal(botPick.event, 'pick_made');
      assert.deepEqual(botPick.data, {
        pick_number: 2,
        team_id: botTeamId,
        player_id: 'player-2',
        is_bot: true,
      });

      const draftComplete = await readStreamEvent(stream);
      assert.equal(draftComplete.event, 'draft_complete');
      assert.deepEqual(draftComplete.data, {
        draft_id: draftId,
        completed_at: '2026-05-18T20:05:00.000Z',
      });
    } finally {
      stream.close();
    }
  });
});

// @spec DFF-ENGINE-033
// @spec DFF-ENGINE-039
// @spec DFF-ENGINE-039b
test('GET /drafts/:id/stream pauses the bot chain for a bot-to-bot trade until POST /drafts/:id/trade-response resumes it', async () => {
  await withDraftServer(async ({ databasePath, database }) => {
    seedPlayer(database, 'player-1', 'Player One');
    database.prepare('UPDATE players SET dynasty_value = 6000 WHERE id = ?').run('player-1');
    seedPlayer(database, 'player-2', 'Player Two');
    database.prepare('UPDATE players SET dynasty_value = 5900 WHERE id = ?').run('player-2');
    seedPlayer(database, 'player-3', 'Player Three');
    database.prepare('UPDATE players SET dynasty_value = 5800 WHERE id = ?').run('player-3');

    const draftId = createDraft({
      databasePath,
      config: {
        teamCount: 3,
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
    const botTeamIds = (
      database.prepare('SELECT id FROM teams WHERE draft_id = ? AND is_user = 0 ORDER BY pick_position').all(draftId) as Array<{ id: string }>
    ).map((team) => team.id);
    const receivingTeamId = botTeamIds[1];
    let tradeOffered = false;
    const botChain = createBotChainCoordinator({
      databasePath,
      now: () => '2026-05-18T20:05:00.000Z',
      sleep: async () => undefined,
      decideBotAction: ({ availablePlayers, slot }) => {
        if (!tradeOffered) {
          tradeOffered = true;
          return {
            type: 'trade',
            tradeId: 'trade-1',
            initiatingTeamId: slot.teamId,
            receivingTeamId: receivingTeamId!,
            assetsSent: [{ type: 'pick_slot', pick_number: slot.pickNumber }],
            assetsReceived: [{ type: 'future_pick', year: 2027, round: 1 }],
            isBotToBot: true,
          };
        }

        return {
          type: 'pick',
          playerId: availablePlayers[0]!.id,
        };
      },
    });
    const stream = await connectToDraftStream(databasePath, draftId);
    assertSseConnection(stream);

    try {
      await readStreamEvent(stream);

      const pickResponse = await invokePickRoute(
        databasePath,
        draftId,
        { playerId: 'player-1' },
        botChain,
      );

      assert.equal(pickResponse.statusCode, 200);

      const userPick = await readStreamEvent(stream);
      assert.equal(userPick.event, 'pick_made');

      const offeredTrade = await readStreamEvent(stream);
      assert.equal(offeredTrade.event, 'trade_offered');
      assert.deepEqual(offeredTrade.data, {
        trade_id: 'trade-1',
        initiating_team_id: (offeredTrade.data as { initiating_team_id: string }).initiating_team_id,
        receiving_team_id: receivingTeamId,
        assets_sent: [{ type: 'pick_slot', pick_number: 2 }],
        assets_received: [{ type: 'future_pick', year: 2027, round: 1 }],
        is_bot_to_bot: true,
      });
      assert.equal(stream.events.length, 0);

      const tradeResponse = await invokeTradeResponseRoute(
        databasePath,
        draftId,
        { status: 'force_declined' },
        botChain,
      );

      await botChain.waitForIdle(draftId);

      assert.equal(tradeResponse.statusCode, 200);
      assert.deepEqual(tradeResponse.jsonBody, { ok: true });

      const resolvedTrade = await readStreamEvent(stream);
      assert.equal(resolvedTrade.event, 'trade_resolved');
      assert.deepEqual(resolvedTrade.data, {
        trade_id: 'trade-1',
        status: 'force_declined',
        assets_sent: [{ type: 'pick_slot', pick_number: 2 }],
        assets_received: [{ type: 'future_pick', year: 2027, round: 1 }],
      });
      assert.deepEqual(
        database
          .prepare('SELECT id, status FROM trades WHERE draft_id = ?')
          .all(draftId),
        [{ id: 'trade-1', status: 'force_declined' }],
      );

      const botPick = await readStreamEvent(stream);
      assert.equal(botPick.event, 'pick_made');

      const finalPick = await readStreamEvent(stream);
      assert.equal(finalPick.event, 'pick_made');

      const draftComplete = await readStreamEvent(stream);
      assert.equal(draftComplete.event, 'draft_complete');
    } finally {
      stream.close();
    }
  });
});

// @spec DFF-ENGINE-040
// @spec DFF-ENGINE-050
// @spec DFF-DATA-042
// @spec DFF-DATA-062
// @spec DFF-DATA-071
test('POST /drafts/:id/trade-response accepts a pending trade and persists all ownership transfers before the bot chain resumes', async () => {
  await withDraftServer(async ({ databasePath, database }) => {
    seedPlayer(database, 'player-1', 'Player One');
    database.prepare('UPDATE players SET dynasty_value = 6000 WHERE id = ?').run('player-1');
    seedPlayer(database, 'player-2', 'Player Two');
    database.prepare('UPDATE players SET dynasty_value = 5900 WHERE id = ?').run('player-2');
    seedPlayer(database, 'player-3', 'Player Three');
    database.prepare('UPDATE players SET dynasty_value = 5800 WHERE id = ?').run('player-3');
    seedPlayer(database, 'player-4', 'Player Four');
    database.prepare('UPDATE players SET dynasty_value = 5700 WHERE id = ?').run('player-4');
    seedPlayer(database, 'player-5', 'Player Five');
    database.prepare('UPDATE players SET dynasty_value = 5600 WHERE id = ?').run('player-5');
    seedPlayer(database, 'player-6', 'Player Six');
    database.prepare('UPDATE players SET dynasty_value = 5500 WHERE id = ?').run('player-6');
    seedPlayer(database, 'player-7', 'Player Seven');
    database.prepare('UPDATE players SET dynasty_value = 5400 WHERE id = ?').run('player-7');

    const draftId = createDraft({
      databasePath,
      config: {
        teamCount: 3,
        rounds: 2,
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

    const teams = database
      .prepare('SELECT id, is_user FROM teams WHERE draft_id = ? ORDER BY pick_position')
      .all(draftId) as Array<{ id: string; is_user: number }>;
    const initiatingTeamId = teams.find((team) => team.is_user === 0)!.id;
    const receivingTeamId = teams.filter((team) => team.id !== initiatingTeamId && team.is_user === 0)[0]!.id;
    const initiatingPickSlot = database
      .prepare(
        `SELECT id, pick_number
         FROM draft_order
         WHERE draft_id = ? AND team_id = ? AND pick_number = 5`,
      )
      .get(draftId, initiatingTeamId) as { id: string; pick_number: number };
    const receivingPickSlot = database
      .prepare(
        `SELECT id, pick_number
         FROM draft_order
         WHERE draft_id = ? AND team_id = ? AND pick_number = 4`,
      )
      .get(draftId, receivingTeamId) as { id: string; pick_number: number };
    const initiatingFuturePick = database
      .prepare(
        `SELECT year, round
         FROM team_pick_assets
         WHERE draft_id = ? AND team_id = ? AND round = 1`,
      )
      .get(draftId, initiatingTeamId) as { year: number; round: number };
    const receivingFuturePick = database
      .prepare(
        `SELECT year, round
         FROM team_pick_assets
         WHERE draft_id = ? AND team_id = ? AND round = 2`,
      )
      .get(draftId, receivingTeamId) as { year: number; round: number };

    database.prepare('INSERT INTO roster_players (id, draft_id, team_id, player_id) VALUES (?, ?, ?, ?)').run(
      'roster-initiating',
      draftId,
      initiatingTeamId,
      'player-3',
    );
    database.prepare('INSERT INTO roster_players (id, draft_id, team_id, player_id) VALUES (?, ?, ?, ?)').run(
      'roster-receiving',
      draftId,
      receivingTeamId,
      'player-4',
    );

    let tradeOffered = false;
    const botChain = createBotChainCoordinator({
      databasePath,
      now: () => '2026-05-18T20:05:00.000Z',
      sleep: async () => undefined,
      decideBotAction: ({ availablePlayers, slot }) => {
        if (!tradeOffered) {
          tradeOffered = true;
          return {
            type: 'trade',
            tradeId: 'trade-accepted',
            initiatingTeamId: slot.teamId,
            receivingTeamId,
            assetsSent: [
              { type: 'player', player_id: 'player-3' },
              {
                type: 'pick_slot',
                draft_order_id: initiatingPickSlot.id,
                pick_number: initiatingPickSlot.pick_number,
              },
              { type: 'future_pick', year: initiatingFuturePick.year, round: initiatingFuturePick.round },
            ],
            assetsReceived: [
              { type: 'player', player_id: 'player-4' },
              {
                type: 'pick_slot',
                draft_order_id: receivingPickSlot.id,
                pick_number: receivingPickSlot.pick_number,
              },
              { type: 'future_pick', year: receivingFuturePick.year, round: receivingFuturePick.round },
            ],
            isBotToBot: true,
          };
        }

        const nextPick = availablePlayers.find(
          (player) => player.id !== 'player-3' && player.id !== 'player-4',
        );

        return {
          type: 'pick',
          playerId: nextPick!.id,
        };
      },
    });
    const stream = await connectToDraftStream(databasePath, draftId);
    assertSseConnection(stream);

    try {
      await readStreamEvent(stream);

      const pickResponse = await invokePickRoute(
        databasePath,
        draftId,
        { playerId: 'player-1' },
        botChain,
      );

      assert.equal(pickResponse.statusCode, 200);
      await readStreamEvent(stream);
      await readStreamEvent(stream);

      const tradeResponse = await invokeTradeResponseRoute(
        databasePath,
        draftId,
        { status: 'accepted' },
        botChain,
      );

      await botChain.waitForIdle(draftId);

      assert.equal(tradeResponse.statusCode, 200);
      assert.deepEqual(tradeResponse.jsonBody, { ok: true });

      const resolvedTrade = await readStreamEvent(stream);
      assert.equal(resolvedTrade.event, 'trade_resolved');
      assert.deepEqual(
        database
          .prepare('SELECT id, status FROM trades WHERE draft_id = ?')
          .all(draftId),
        [{ id: 'trade-accepted', status: 'accepted' }],
      );
      assert.deepEqual(
        database
          .prepare('SELECT player_id, team_id FROM roster_players WHERE draft_id = ? AND player_id IN (?, ?) ORDER BY player_id')
          .all(draftId, 'player-3', 'player-4'),
        [
          { player_id: 'player-3', team_id: receivingTeamId },
          { player_id: 'player-4', team_id: initiatingTeamId },
        ],
      );
      assert.deepEqual(
        database
          .prepare('SELECT id, team_id FROM draft_order WHERE id IN (?, ?) ORDER BY pick_number')
          .all(initiatingPickSlot.id, receivingPickSlot.id),
        [
          { id: initiatingPickSlot.id, team_id: receivingTeamId, pick_number: initiatingPickSlot.pick_number },
          { id: receivingPickSlot.id, team_id: initiatingTeamId, pick_number: receivingPickSlot.pick_number },
        ]
          .sort((left, right) => left.pick_number - right.pick_number)
          .map(({ id, team_id }) => ({ id, team_id })),
      );
      assert.deepEqual(
        database
          .prepare(
            `SELECT year, round, team_id
             FROM team_pick_assets
             WHERE draft_id = ? AND team_id IN (?, ?)
             ORDER BY team_id, round`,
          )
          .all(draftId, initiatingTeamId, receivingTeamId),
        [
          { year: initiatingFuturePick.year, round: initiatingFuturePick.round, team_id: receivingTeamId },
          { year: receivingFuturePick.year, round: 1, team_id: receivingTeamId },
          { year: initiatingFuturePick.year, round: 2, team_id: initiatingTeamId },
          { year: receivingFuturePick.year, round: receivingFuturePick.round, team_id: initiatingTeamId },
        ].sort(
          (left, right) => left.team_id.localeCompare(right.team_id) || left.round - right.round,
        ),
      );
    } finally {
      stream.close();
    }
  });
});

// @spec DFF-ENGINE-034
// @spec DFF-ENGINE-035
// @spec DFF-ENGINE-036
// @spec DFF-ENGINE-037
test('POST /drafts/:id/trade-offer emits trade events and defers the next bot pick until the offer resolves', async () => {
  await withDraftServer(async ({ databasePath, database }) => {
    seedPlayer(database, 'player-1', 'Player One');
    database.prepare('UPDATE players SET dynasty_value = 7000 WHERE id = ?').run('player-1');
    seedPlayer(database, 'player-2', 'Player Two');
    database.prepare('UPDATE players SET dynasty_value = 6900 WHERE id = ?').run('player-2');
    seedPlayer(database, 'player-3', 'Player Three');
    database.prepare('UPDATE players SET dynasty_value = 6800 WHERE id = ?').run('player-3');

    const draftId = createDraft({
      databasePath,
      config: {
        teamCount: 2,
        rounds: 2,
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

    const teams = database
      .prepare('SELECT id, is_user FROM teams WHERE draft_id = ? ORDER BY pick_position')
      .all(draftId) as Array<{ id: string; is_user: number }>;
    const userTeamId = teams.find((team) => team.is_user === 1)!.id;
    const botTeamId = teams.find((team) => team.is_user === 0)!.id;

    let releaseSleep: (() => void) | undefined;
    const sleepGate = new Promise<void>((resolve) => {
      releaseSleep = resolve;
    });

    const botChain = createBotChainCoordinator({
      databasePath,
      now: () => '2026-05-18T20:05:00.000Z',
      sleep: async () => {
        await sleepGate;
      },
    });

    const stream = await connectToDraftStream(databasePath, draftId);
    assertSseConnection(stream);

    try {
      await readStreamEvent(stream);

      const pickResponse = await invokePickRoute(
        databasePath,
        draftId,
        { playerId: 'player-1' },
        botChain,
      );

      assert.equal(pickResponse.statusCode, 200);
      await readStreamEvent(stream);

      const offerResponse = await invokeTradeOfferRoute(
        databasePath,
        draftId,
        {
          targetTeamId: botTeamId,
          offeredAssets: [{ type: 'future_pick', year: 2027, round: 1 }],
          requestedAssets: [{ type: 'future_pick', year: 2027, round: 2 }],
        },
        botChain,
      );

      assert.equal(offerResponse.statusCode, 202);
      assert.deepEqual(offerResponse.jsonBody, {
        ok: true,
        tradeId: 'trade-user-offer-1',
      });

      releaseSleep?.();
      await botChain.waitForIdle(draftId);

      const offeredTrade = await readStreamEvent(stream);
      assert.equal(offeredTrade.event, 'trade_offered');
      assert.deepEqual(offeredTrade.data, {
        trade_id: 'trade-user-offer-1',
        initiating_team_id: userTeamId,
        receiving_team_id: botTeamId,
        assets_sent: [{ type: 'future_pick', year: 2027, round: 1 }],
        assets_received: [{ type: 'future_pick', year: 2027, round: 2 }],
        is_bot_to_bot: false,
      });

      const resolvedTrade = await readStreamEvent(stream);
      assert.equal(resolvedTrade.event, 'trade_resolved');
      assert.deepEqual(resolvedTrade.data, {
        trade_id: 'trade-user-offer-1',
        status: 'accepted',
        assets_sent: [{ type: 'future_pick', year: 2027, round: 1 }],
        assets_received: [{ type: 'future_pick', year: 2027, round: 2 }],
      });

      const botPick = await readStreamEvent(stream);
      assert.equal(botPick.event, 'pick_made');
    } finally {
      stream.close();
    }
  });
});
