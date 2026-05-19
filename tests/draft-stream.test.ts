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
import {
  createDraft,
  emitTradeOffered,
  emitTradeResolved,
  recordPick,
} from '../src/draft/service.js';
import { createDraftStreamRoute } from '../src/server/app.js';

type StreamEvent = {
  event: string;
  data: unknown;
};

type StreamConnection = {
  events: StreamEvent[];
  ended: boolean;
  notify?: () => void;
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
      events.push({
        event: 'json',
        data: body,
      });
      notify?.();
      return this;
    },
  } as Response;

  route(request, response, () => undefined);

  assert.equal(statusCode, 200);
  assert.equal(headers['content-type'], 'text/event-stream; charset=utf-8');
  return {
    events,
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

    const stream = await connectToDraftStream(databasePath, draftId);

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

    const slots = database
      .prepare(
        `SELECT id
         FROM draft_order
         WHERE draft_id = ?
         ORDER BY pick_number`,
      )
      .all(draftId) as Array<{ id: string }>;

    const stream = await connectToDraftStream(databasePath, draftId);

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
