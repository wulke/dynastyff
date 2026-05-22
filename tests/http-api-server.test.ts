// @spec DFF-ENGINE-001
// @spec DFF-ENGINE-003
// @spec DFF-ENGINE-020
// @spec DFF-ENGINE-021
// @spec DFF-ENGINE-022
// @spec DFF-ENGINE-060
// @spec DFF-ENGINE-061
// @spec DFF-ENGINE-062
// @spec DFF-ENGINE-063
// @spec DFF-DATA-093
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Request, RequestHandler, Response } from 'express';

import { initializeDatabase } from '../src/db/init.js';
import { createDraft, recordPick } from '../src/draft/service.js';
import { createBotChainCoordinator } from '../src/draft/bot-chain.js';
import {
  createDraftErrorHandler,
  createDraftRoute,
  createDraftQueueDeleteRoute,
  createDraftQueueGetRoute,
  createDraftQueuePostRoute,
  createDraftPickRoute,
  createDraftStateRoute,
  createDraftTradeResponseRoute,
  createDraftHistoryRoute,
} from '../src/server/app.js';
import { parseCreateDraftConfig } from '../src/server/config.js';
import { resolveApiBaseUrl } from '../src/server/runtime.js';
import viteConfig from '../src/ui/vite.config.js';

function createTempDatabasePath(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(tempDir, 'test.sqlite');
}

function createDraftRequestBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    configName: 'Startup 12',
    teamCount: 12,
    rounds: 20,
    scoringFormat: 'ppr',
    rosterSlots: {
      QB: 1,
      RB: 2,
      WR: 3,
      TE: 1,
      FLEX: 1,
      SF: 1,
      BN: 6,
    },
    pickPosition: 6,
    futurePickYears: 3,
    ...overrides,
  };
}

function readDraft(databasePath: string, draftId: string) {
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  try {
    return db
      .prepare(
        `SELECT team_count, rounds, scoring_format, user_pick_position, future_pick_years, future_pick_rounds, roster_config
         FROM drafts
         WHERE id = ?`,
      )
      .get(draftId) as
      | {
          team_count: number;
          rounds: number;
          scoring_format: string;
          user_pick_position: number;
          future_pick_years: number;
          future_pick_rounds: number;
          roster_config: string;
        }
      | undefined;
  } finally {
    db.close();
  }
}

function seedPlayer(db: Database.Database, playerId: string, name: string, position = 'QB'): void {
  db.prepare(
    `INSERT INTO players (
      id, name, position, nfl_team, age, is_rookie, dynasty_value, updated_at
    ) VALUES (?, ?, ?, 'BUF', 25, 0, 5000, ?)`,
  ).run(playerId, name, position, '2026-05-18T00:00:00.000Z');
}

async function invokeRoute({
  route,
  body,
  params,
}: {
  route: RequestHandler;
  body?: unknown;
  params?: Record<string, string>;
}): Promise<{
  statusCode: number;
  headers: Record<string, number | string | string[] | undefined>;
  json: unknown;
}> {
  const request = { body, params } as Request;
  const errorHandler = createDraftErrorHandler();
  const headers: Record<string, number | string | string[] | undefined> = {};
  let statusCode = 200;
  let responseBody: unknown;
  const response = {
    statusCode: 200,
    status(code: number) {
      statusCode = code;
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    json(bodyJson: unknown) {
      headers['content-type'] = 'application/json';
      responseBody = bodyJson;
      return this;
    },
  } as Response;

  let forwardedError: unknown;
  await Promise.resolve(
    route(request, response, (error?: unknown) => {
      forwardedError = error;
    }),
  );

  if (forwardedError !== undefined) {
    errorHandler(forwardedError, request, response, () => undefined);
  }

  return {
    statusCode,
    headers,
    json: responseBody,
  };
}

async function invokeDraftRoute(databasePath: string, body: Record<string, unknown>) {
  return invokeRoute({
    route: createDraftRoute({ databasePath }),
    body,
  });
}

async function invokePickRoute(
  databasePath: string,
  draftId: string,
  body: unknown,
) {
  return invokeRoute({
    route: createDraftPickRoute({
      databasePath,
      botChain: {
        trigger: () => undefined,
        waitForIdle: async () => undefined,
        resolvePendingTrade: () => false,
      },
    }),
    body,
    params: { id: draftId },
  });
}

async function invokeTradeResponseRoute(
  databasePath: string,
  draftId: string,
  body: unknown,
) {
  return invokeRoute({
    route: createDraftTradeResponseRoute({
      databasePath,
      botChain: {
        trigger: () => undefined,
        waitForIdle: async () => undefined,
        resolvePendingTrade: () => false,
      },
    }),
    body,
    params: { id: draftId },
  });
}

async function invokeQueuePostRoute(
  databasePath: string,
  draftId: string,
  body: unknown,
) {
  return invokeRoute({
    route: createDraftQueuePostRoute({ databasePath }),
    body,
    params: { id: draftId },
  });
}

async function invokeQueueGetRoute(databasePath: string, draftId: string) {
  return invokeRoute({
    route: createDraftQueueGetRoute({ databasePath }),
    params: { id: draftId },
  });
}

async function invokeQueueDeleteRoute(
  databasePath: string,
  draftId: string,
  playerId: string,
) {
  return invokeRoute({
    route: createDraftQueueDeleteRoute({ databasePath }),
    params: { id: draftId, player_id: playerId },
  });
}

function readDraftMutationCounts(databasePath: string, draftId: string) {
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  try {
    const pickCount = db
      .prepare('SELECT COUNT(*) AS count FROM picks WHERE draft_id = ?')
      .get(draftId) as { count: number };
    const rosterCount = db
      .prepare('SELECT COUNT(*) AS count FROM roster_players WHERE draft_id = ?')
      .get(draftId) as { count: number };

    return {
      picks: pickCount.count,
      rosterPlayers: rosterCount.count,
    };
  } finally {
    db.close();
  }
}

test('POST /drafts returns 201 and the created draft id for a valid camelCase config payload', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-valid-');
  initializeDatabase(databasePath);
  const response = await invokeDraftRoute(
    databasePath,
    createDraftRequestBody({
      configName: 'Superflex Sprint',
      teamCount: 10,
      rounds: 18,
      scoringFormat: 'half_ppr',
      rosterSlots: {
        QB: 2,
        RB: 2,
        WR: 2,
        TE: 1,
        FLEX: 2,
        SF: 1,
        BN: 8,
      },
      pickPosition: 4,
      futurePickYears: 2,
    }),
  );

  assert.equal(response.statusCode, 201);
  assert.equal(response.headers['content-type'], 'application/json');

  const body = response.json as { draftId: string };

  assert.match(body.draftId, /^[0-9a-f-]{36}$/i);

  const draft = readDraft(databasePath, body.draftId);

  assert.ok(draft);
  assert.deepEqual(draft, {
    team_count: 10,
    rounds: 18,
    scoring_format: 'half_ppr',
    user_pick_position: 4,
    future_pick_years: 2,
    future_pick_rounds: 18,
    roster_config: JSON.stringify({
      QB: 2,
      RB: 2,
      WR: 2,
      TE: 1,
      FLEX: 2,
      SF: 1,
      bench: 8,
    }),
  });

  fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
});

test('POST /drafts returns 400 with a descriptive error and does not create a draft when a required field is missing', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-missing-');
  initializeDatabase(databasePath);
  const invalidBody = createDraftRequestBody();
  delete invalidBody.teamCount;
  const response = await invokeDraftRoute(databasePath, invalidBody);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json, {
    error: 'Invalid draft config: teamCount is required.',
  });

  const db = new Database(databasePath);

  try {
    const draftCount = db.prepare('SELECT COUNT(*) AS count FROM drafts').get() as { count: number };
    assert.equal(draftCount.count, 0);
  } finally {
    db.close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

test('POST /drafts returns 400 with a descriptive error and does not create a draft when a field is out of range', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-invalid-');
  initializeDatabase(databasePath);
  const response = await invokeDraftRoute(
    databasePath,
    createDraftRequestBody({
      configName: 'Invalid Team Count',
      teamCount: 7,
    }),
  );

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json, {
    error: 'Invalid draft config: teamCount must be an integer between 8 and 16.',
  });

  const db = new Database(databasePath);

  try {
    const draftCount = db.prepare('SELECT COUNT(*) AS count FROM drafts').get() as { count: number };
    assert.equal(draftCount.count, 0);
  } finally {
    db.close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

test('createDraftErrorHandler returns 400 for Express JSON body parse failures', () => {
  const errorHandler = createDraftErrorHandler();
  const request = {} as Request;
  let statusCode = 200;
  let responseBody: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      responseBody = body;
      return this;
    },
  } as Response;
  const parseError = Object.assign(new SyntaxError('Unexpected token'), {
    status: 400,
    body: '{"broken":',
  });

  errorHandler(parseError, request, response, () => undefined);

  assert.equal(statusCode, 400);
  assert.deepEqual(responseBody, {
    error: 'Invalid draft config: request body must be valid JSON.',
  });
});

// @spec DFF-ENGINE-020
// @spec DFF-ENGINE-022
test('POST /drafts/:id/pick returns 200 and records the user pick for a valid player on the current user slot', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-pick-valid-');
  initializeDatabase(databasePath);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  try {
    seedPlayer(db, 'player-valid', 'Valid Player', 'WR');

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

    const response = await invokePickRoute(databasePath, draftId, {
      playerId: 'player-valid',
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json, { ok: true });

    const persistedPick = db
      .prepare(
        `SELECT draft_id, player_id, pick_number
         FROM picks
         WHERE draft_id = ?`,
      )
      .get(draftId) as
      | {
          draft_id: string;
          player_id: string;
          pick_number: number;
        }
      | undefined;

    assert.deepEqual(persistedPick, {
      draft_id: draftId,
      player_id: 'player-valid',
      pick_number: 1,
    });
    assert.deepEqual(readDraftMutationCounts(databasePath, draftId), {
      picks: 1,
      rosterPlayers: 1,
    });
  } finally {
    db.close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-ENGINE-030
// @spec DFF-ENGINE-031
// @spec DFF-ENGINE-032
test('POST /drafts/:id/pick triggers consecutive bot picks with a 3-5 second delay and stops at the next user turn', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-bot-chain-');
  initializeDatabase(databasePath);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  try {
    seedPlayer(db, 'player-1', 'Player One', 'WR');
    db.prepare('UPDATE players SET dynasty_value = 6000 WHERE id = ?').run('player-1');
    seedPlayer(db, 'player-2', 'Player Two', 'WR');
    db.prepare('UPDATE players SET dynasty_value = 5900 WHERE id = ?').run('player-2');
    seedPlayer(db, 'player-3', 'Player Three', 'WR');
    db.prepare('UPDATE players SET dynasty_value = 5800 WHERE id = ?').run('player-3');
    seedPlayer(db, 'player-4', 'Player Four', 'WR');
    db.prepare('UPDATE players SET dynasty_value = 5700 WHERE id = ?').run('player-4');
    seedPlayer(db, 'player-5', 'Player Five', 'WR');
    db.prepare('UPDATE players SET dynasty_value = 5600 WHERE id = ?').run('player-5');
    seedPlayer(db, 'player-6', 'Player Six', 'WR');
    db.prepare('UPDATE players SET dynasty_value = 5500 WHERE id = ?').run('player-6');

    const draftId = createDraft({
      databasePath,
      config: {
        teamCount: 3,
        rounds: 2,
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
    const delayCalls: number[] = [];
    const botChain = createBotChainCoordinator({
      databasePath,
      random: () => 0.5,
      sleep: async (delayMs) => {
        delayCalls.push(delayMs);
      },
    });

    const response = await invokeRoute({
      route: createDraftPickRoute({ databasePath, botChain }),
      body: { playerId: 'player-1' },
      params: { id: draftId },
    });

    await botChain.waitForIdle(draftId);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(delayCalls, [4000, 4000, 4000, 4000]);

    const persistedPicks = db
      .prepare(
        `SELECT pick_number, player_id
         FROM picks
         WHERE draft_id = ?
         ORDER BY pick_number`,
      )
      .all(draftId) as Array<{ pick_number: number; player_id: string }>;

    assert.deepEqual(persistedPicks, [
      { pick_number: 1, player_id: 'player-1' },
      { pick_number: 2, player_id: 'player-2' },
      { pick_number: 3, player_id: 'player-3' },
      { pick_number: 4, player_id: 'player-4' },
      { pick_number: 5, player_id: 'player-5' },
    ]);

    const nextOpenSlot = db
      .prepare(
        `SELECT draft_order.pick_number, teams.is_user
         FROM draft_order
         INNER JOIN teams ON teams.id = draft_order.team_id
         LEFT JOIN picks ON picks.draft_order_id = draft_order.id
         WHERE draft_order.draft_id = ?
           AND picks.id IS NULL
         ORDER BY draft_order.pick_number
         LIMIT 1`,
      )
      .get(draftId) as { pick_number: number; is_user: number };

    assert.deepEqual(nextOpenSlot, {
      pick_number: 6,
      is_user: 1,
    });
  } finally {
    db.close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-ENGINE-030
// @spec DFF-ENGINE-032
test('POST /drafts/:id/pick completes the draft automatically when the bot chain exhausts the remaining slots', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-bot-complete-');
  initializeDatabase(databasePath);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  try {
    seedPlayer(db, 'player-1', 'Player One', 'WR');
    db.prepare('UPDATE players SET dynasty_value = 6000 WHERE id = ?').run('player-1');
    seedPlayer(db, 'player-2', 'Player Two', 'WR');
    db.prepare('UPDATE players SET dynasty_value = 5900 WHERE id = ?').run('player-2');

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
    const botChain = createBotChainCoordinator({
      databasePath,
      sleep: async () => undefined,
    });

    const response = await invokeRoute({
      route: createDraftPickRoute({ databasePath, botChain }),
      body: { playerId: 'player-1' },
      params: { id: draftId },
    });

    await botChain.waitForIdle(draftId);

    assert.equal(response.statusCode, 200);

    const completedDraft = db
      .prepare(
        `SELECT status, completed_at
         FROM drafts
         WHERE id = ?`,
      )
      .get(draftId) as { status: string; completed_at: string | null };

    assert.equal(completedDraft.status, 'completed');
    assert.equal(completedDraft.completed_at !== null, true);

    const persistedPicks = db
      .prepare(
        `SELECT pick_number, player_id
         FROM picks
         WHERE draft_id = ?
         ORDER BY pick_number`,
      )
      .all(draftId) as Array<{ pick_number: number; player_id: string }>;

    assert.deepEqual(persistedPicks, [
      { pick_number: 1, player_id: 'player-1' },
      { pick_number: 2, player_id: 'player-2' },
    ]);
  } finally {
    db.close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-ENGINE-020
// @spec DFF-ENGINE-021
test('POST /drafts/:id/pick returns 400 and leaves draft state unchanged when it is not the user turn', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-pick-turn-');
  initializeDatabase(databasePath);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  try {
    seedPlayer(db, 'player-valid', 'Valid Player', 'WR');

    const draftId = createDraft({
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
    const countsBefore = readDraftMutationCounts(databasePath, draftId);

    const response = await invokePickRoute(databasePath, draftId, {
      playerId: 'player-valid',
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json, {
      error: 'Invalid pick submission: it is not currently the user team turn.',
    });
    assert.deepEqual(readDraftMutationCounts(databasePath, draftId), countsBefore);
  } finally {
    db.close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-ENGINE-020
// @spec DFF-ENGINE-021
test('POST /drafts/:id/pick returns 400 and leaves draft state unchanged when the player does not exist', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-pick-unknown-');
  initializeDatabase(databasePath);

  try {
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
    const countsBefore = readDraftMutationCounts(databasePath, draftId);

    const response = await invokePickRoute(databasePath, draftId, {
      playerId: 'missing-player',
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json, {
      error: 'Invalid pick submission: player does not exist.',
    });
    assert.deepEqual(readDraftMutationCounts(databasePath, draftId), countsBefore);
  } finally {
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-ENGINE-020
// @spec DFF-ENGINE-021
test('POST /drafts/:id/pick returns 400 when playerId is missing from the request body', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-pick-body-');
  initializeDatabase(databasePath);

  try {
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
    const countsBefore = readDraftMutationCounts(databasePath, draftId);

    const response = await invokePickRoute(databasePath, draftId, {});

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json, {
      error: 'Invalid pick submission: playerId is required.',
    });
    assert.deepEqual(readDraftMutationCounts(databasePath, draftId), countsBefore);
  } finally {
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-ENGINE-020
// @spec DFF-ENGINE-021
test('POST /drafts/:id/pick returns 400 when the request body is not a JSON object', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-pick-non-object-');
  initializeDatabase(databasePath);

  try {
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
    const countsBefore = readDraftMutationCounts(databasePath, draftId);

    const response = await invokePickRoute(databasePath, draftId, []);

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json, {
      error: 'Invalid pick submission: request body must be a JSON object.',
    });
    assert.deepEqual(readDraftMutationCounts(databasePath, draftId), countsBefore);
  } finally {
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-ENGINE-020
// @spec DFF-ENGINE-021
test('POST /drafts/:id/pick returns 400 when playerId is blank', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-pick-blank-id-');
  initializeDatabase(databasePath);

  try {
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
    const countsBefore = readDraftMutationCounts(databasePath, draftId);

    const response = await invokePickRoute(databasePath, draftId, {
      playerId: '   ',
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json, {
      error: 'Invalid pick submission: playerId is required.',
    });
    assert.deepEqual(readDraftMutationCounts(databasePath, draftId), countsBefore);
  } finally {
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-ENGINE-020
// @spec DFF-ENGINE-021
test('POST /drafts/:id/pick returns 400 and leaves draft state unchanged when the player has already been picked', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-pick-picked-');
  initializeDatabase(databasePath);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  try {
    seedPlayer(db, 'player-picked', 'Picked Player', 'QB');
    seedPlayer(db, 'player-next', 'Next Player', 'WR');

    const draftId = createDraft({
      databasePath,
      config: {
        teamCount: 2,
        rounds: 2,
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
    const firstSlot = db
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
      draftOrderId: firstSlot.id,
      playerId: 'player-picked',
      now: () => '2026-05-18T20:05:00.000Z',
    });

    const countsBefore = readDraftMutationCounts(databasePath, draftId);

    const response = await invokePickRoute(databasePath, draftId, {
      playerId: 'player-picked',
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json, {
      error: 'Invalid pick submission: player has already been picked.',
    });
    assert.deepEqual(readDraftMutationCounts(databasePath, draftId), countsBefore);
  } finally {
    db.close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-ENGINE-020
// @spec DFF-ENGINE-021
test('POST /drafts/:id/pick returns 404 when the draft does not exist', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-pick-missing-draft-');
  initializeDatabase(databasePath);

  try {
    const response = await invokePickRoute(databasePath, 'missing-draft-id', {
      playerId: 'player-valid',
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json, {
      error: 'Draft not found.',
    });
  } finally {
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-ENGINE-033
// @spec DFF-ENGINE-039
// @spec DFF-ENGINE-039b
test('POST /drafts/:id/trade-response returns 400 when status is missing', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-trade-response-missing-status-');
  initializeDatabase(databasePath);

  try {
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

    const response = await invokeTradeResponseRoute(databasePath, draftId, {});

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json, {
      error: 'Invalid trade response: status must be accepted, declined, or force_declined.',
    });
  } finally {
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-ENGINE-033
// @spec DFF-ENGINE-039
// @spec DFF-ENGINE-039b
test('POST /drafts/:id/trade-response returns 400 when status is invalid', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-trade-response-invalid-status-');
  initializeDatabase(databasePath);

  try {
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

    const response = await invokeTradeResponseRoute(databasePath, draftId, { status: 'bogus' });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json, {
      error: 'Invalid trade response: status must be accepted, declined, or force_declined.',
    });
  } finally {
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-DATA-093
test('POST /drafts/:id/queue returns 200 and inserts a new queue entry for a valid playerId and rank', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-queue-post-insert-');
  initializeDatabase(databasePath);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  try {
    seedPlayer(db, 'player-queue-1', 'Queue Player 1', 'RB');

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

    const response = await invokeQueuePostRoute(databasePath, draftId, {
      playerId: 'player-queue-1',
      rank: 1,
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json, { ok: true });
    assert.deepEqual(
      db.prepare('SELECT player_id, rank FROM user_queue WHERE draft_id = ?').all(draftId),
      [{ player_id: 'player-queue-1', rank: 1 }],
    );
  } finally {
    db.close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-DATA-091
// @spec DFF-DATA-093
test('POST /drafts/:id/queue returns 200 and updates the rank when the player is already queued', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-queue-post-update-');
  initializeDatabase(databasePath);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  try {
    seedPlayer(db, 'player-queue-1', 'Queue Player 1', 'RB');

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

    db.prepare('INSERT INTO user_queue (id, draft_id, player_id, rank) VALUES (?, ?, ?, ?)').run(
      'queue-row-id',
      draftId,
      'player-queue-1',
      3,
    );

    const response = await invokeQueuePostRoute(databasePath, draftId, {
      playerId: 'player-queue-1',
      rank: 1,
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json, { ok: true });
    assert.deepEqual(
      db.prepare('SELECT player_id, rank FROM user_queue WHERE draft_id = ?').all(draftId),
      [{ player_id: 'player-queue-1', rank: 1 }],
    );
  } finally {
    db.close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-DATA-093
test('POST /drafts/:id/queue returns 400 when playerId is missing', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-queue-post-missing-player-');
  initializeDatabase(databasePath);

  try {
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

    const response = await invokeQueuePostRoute(databasePath, draftId, {
      rank: 1,
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json, {
      error: 'Invalid queue submission: playerId is required.',
    });
  } finally {
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-DATA-093
test('POST /drafts/:id/queue returns 400 when rank is missing', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-queue-post-missing-rank-');
  initializeDatabase(databasePath);

  try {
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

    const response = await invokeQueuePostRoute(databasePath, draftId, {
      playerId: 'player-queue-1',
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json, {
      error: 'Invalid queue submission: rank is required.',
    });
  } finally {
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-DATA-093
test('POST /drafts/:id/queue returns 400 when playerId does not exist in the players table', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-queue-post-unknown-player-');
  initializeDatabase(databasePath);

  try {
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

    const response = await invokeQueuePostRoute(databasePath, draftId, {
      playerId: 'missing-player',
      rank: 1,
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json, {
      error: 'Invalid queue submission: player does not exist.',
    });
  } finally {
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-DATA-093
test('POST /drafts/:id/queue returns 400 when rank is invalid', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-queue-post-invalid-rank-');
  initializeDatabase(databasePath);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  try {
    seedPlayer(db, 'player-queue-1', 'Queue Player 1', 'RB');

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

    const response = await invokeQueuePostRoute(databasePath, draftId, {
      playerId: 'player-queue-1',
      rank: 0,
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json, {
      error: 'Invalid queue submission: rank must be a positive integer.',
    });
  } finally {
    db.close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-DATA-093
test('POST /drafts/:id/queue returns 404 for an unknown draft id', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-queue-post-missing-draft-');
  initializeDatabase(databasePath);

  try {
    const response = await invokeQueuePostRoute(databasePath, 'missing-draft-id', {
      playerId: 'player-queue-1',
      rank: 1,
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json, { error: 'Draft not found.' });
  } finally {
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-DATA-093
test('POST /drafts/:id/queue shifts existing ranks when moving an existing entry up', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-queue-post-update-up-');
  initializeDatabase(databasePath);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  try {
    seedPlayer(db, 'player-queue-1', 'Queue Player 1', 'RB');
    seedPlayer(db, 'player-queue-2', 'Queue Player 2', 'WR');
    seedPlayer(db, 'player-queue-3', 'Queue Player 3', 'TE');

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

    db.prepare('INSERT INTO user_queue (id, draft_id, player_id, rank) VALUES (?, ?, ?, ?)').run(
      'queue-row-1',
      draftId,
      'player-queue-1',
      1,
    );
    db.prepare('INSERT INTO user_queue (id, draft_id, player_id, rank) VALUES (?, ?, ?, ?)').run(
      'queue-row-2',
      draftId,
      'player-queue-2',
      2,
    );
    db.prepare('INSERT INTO user_queue (id, draft_id, player_id, rank) VALUES (?, ?, ?, ?)').run(
      'queue-row-3',
      draftId,
      'player-queue-3',
      3,
    );

    const response = await invokeQueuePostRoute(databasePath, draftId, {
      playerId: 'player-queue-3',
      rank: 1,
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      db.prepare('SELECT player_id, rank FROM user_queue WHERE draft_id = ? ORDER BY rank').all(draftId),
      [
        { player_id: 'player-queue-3', rank: 1 },
        { player_id: 'player-queue-1', rank: 2 },
        { player_id: 'player-queue-2', rank: 3 },
      ],
    );
  } finally {
    db.close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-DATA-091
// @spec DFF-DATA-093
test('POST /drafts/:id/queue shifts existing ranks when moving an existing entry down', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-queue-post-update-down-');
  initializeDatabase(databasePath);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  try {
    seedPlayer(db, 'player-queue-1', 'Queue Player 1', 'RB');
    seedPlayer(db, 'player-queue-2', 'Queue Player 2', 'WR');
    seedPlayer(db, 'player-queue-3', 'Queue Player 3', 'TE');

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

    db.prepare('INSERT INTO user_queue (id, draft_id, player_id, rank) VALUES (?, ?, ?, ?)').run(
      'queue-row-1',
      draftId,
      'player-queue-1',
      1,
    );
    db.prepare('INSERT INTO user_queue (id, draft_id, player_id, rank) VALUES (?, ?, ?, ?)').run(
      'queue-row-2',
      draftId,
      'player-queue-2',
      2,
    );
    db.prepare('INSERT INTO user_queue (id, draft_id, player_id, rank) VALUES (?, ?, ?, ?)').run(
      'queue-row-3',
      draftId,
      'player-queue-3',
      3,
    );

    const response = await invokeQueuePostRoute(databasePath, draftId, {
      playerId: 'player-queue-1',
      rank: 3,
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      db.prepare('SELECT player_id, rank FROM user_queue WHERE draft_id = ? ORDER BY rank').all(draftId),
      [
        { player_id: 'player-queue-2', rank: 1 },
        { player_id: 'player-queue-3', rank: 2 },
        { player_id: 'player-queue-1', rank: 3 },
      ],
    );
  } finally {
    db.close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-DATA-093
test('POST /drafts/:id/queue shifts existing ranks when inserting at an occupied rank', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-queue-post-shift-');
  initializeDatabase(databasePath);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  try {
    seedPlayer(db, 'player-queue-1', 'Queue Player 1', 'RB');
    seedPlayer(db, 'player-queue-2', 'Queue Player 2', 'WR');
    seedPlayer(db, 'player-queue-3', 'Queue Player 3', 'TE');

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

    db.prepare('INSERT INTO user_queue (id, draft_id, player_id, rank) VALUES (?, ?, ?, ?)').run(
      'queue-row-1',
      draftId,
      'player-queue-1',
      1,
    );
    db.prepare('INSERT INTO user_queue (id, draft_id, player_id, rank) VALUES (?, ?, ?, ?)').run(
      'queue-row-2',
      draftId,
      'player-queue-2',
      2,
    );

    const response = await invokeQueuePostRoute(databasePath, draftId, {
      playerId: 'player-queue-3',
      rank: 1,
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      db.prepare('SELECT player_id, rank FROM user_queue WHERE draft_id = ? ORDER BY rank').all(draftId),
      [
        { player_id: 'player-queue-3', rank: 1 },
        { player_id: 'player-queue-1', rank: 2 },
        { player_id: 'player-queue-2', rank: 3 },
      ],
    );
  } finally {
    db.close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-DATA-093
test('GET /drafts/:id/queue returns the queue ordered by ascending rank', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-queue-get-');
  initializeDatabase(databasePath);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  try {
    seedPlayer(db, 'player-queue-1', 'Queue Player 1', 'RB');
    seedPlayer(db, 'player-queue-2', 'Queue Player 2', 'WR');
    seedPlayer(db, 'player-queue-3', 'Queue Player 3', 'TE');

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

    db.prepare('INSERT INTO user_queue (id, draft_id, player_id, rank) VALUES (?, ?, ?, ?)').run(
      'queue-row-1',
      draftId,
      'player-queue-1',
      3,
    );
    db.prepare('INSERT INTO user_queue (id, draft_id, player_id, rank) VALUES (?, ?, ?, ?)').run(
      'queue-row-2',
      draftId,
      'player-queue-2',
      1,
    );
    db.prepare('INSERT INTO user_queue (id, draft_id, player_id, rank) VALUES (?, ?, ?, ?)').run(
      'queue-row-3',
      draftId,
      'player-queue-3',
      2,
    );

    const response = await invokeQueueGetRoute(databasePath, draftId);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json, [
      { playerId: 'player-queue-2', rank: 1 },
      { playerId: 'player-queue-3', rank: 2 },
      { playerId: 'player-queue-1', rank: 3 },
    ]);
  } finally {
    db.close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-DATA-093
test('GET /drafts/:id/queue returns 404 for an unknown draft id', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-queue-get-missing-draft-');
  initializeDatabase(databasePath);

  try {
    const response = await invokeQueueGetRoute(databasePath, 'missing-draft-id');

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json, { error: 'Draft not found.' });
  } finally {
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-DATA-093
test('DELETE /drafts/:id/queue/:player_id returns 200 and removes the queued player', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-queue-delete-');
  initializeDatabase(databasePath);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  try {
    seedPlayer(db, 'player-queue-1', 'Queue Player 1', 'RB');
    seedPlayer(db, 'player-queue-2', 'Queue Player 2', 'WR');

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

    db.prepare('INSERT INTO user_queue (id, draft_id, player_id, rank) VALUES (?, ?, ?, ?)').run(
      'queue-row-1',
      draftId,
      'player-queue-1',
      1,
    );
    db.prepare('INSERT INTO user_queue (id, draft_id, player_id, rank) VALUES (?, ?, ?, ?)').run(
      'queue-row-2',
      draftId,
      'player-queue-2',
      2,
    );

    const response = await invokeQueueDeleteRoute(databasePath, draftId, 'player-queue-1');

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json, { ok: true });
    assert.deepEqual(
      db.prepare('SELECT player_id, rank FROM user_queue WHERE draft_id = ? ORDER BY rank').all(draftId),
      [{ player_id: 'player-queue-2', rank: 2 }],
    );
  } finally {
    db.close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-DATA-093
test('DELETE /drafts/:id/queue/:player_id returns 404 when the player is not queued', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-queue-delete-missing-player-');
  initializeDatabase(databasePath);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  try {
    seedPlayer(db, 'player-queue-1', 'Queue Player 1', 'RB');

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

    const response = await invokeQueueDeleteRoute(databasePath, draftId, 'player-queue-1');

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json, { error: 'Queue entry not found.' });
  } finally {
    db.close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

// @spec DFF-DATA-093
test('DELETE /drafts/:id/queue/:player_id returns 404 for an unknown draft id', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-queue-delete-missing-draft-');
  initializeDatabase(databasePath);

  try {
    const response = await invokeQueueDeleteRoute(databasePath, 'missing-draft-id', 'player-queue-1');

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json, { error: 'Draft not found.' });
  } finally {
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

test('GET /drafts/:id/state returns the persisted draft snapshot plus trades for mid-draft hydration', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-state-');
  initializeDatabase(databasePath);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  try {
    seedPlayer(db, 'player-picked', 'Picked Player', 'QB');
    seedPlayer(db, 'player-queued', 'Queued Player', 'WR');

    const draftId = createDraft({
      databasePath,
      config: {
        teamCount: 4,
        rounds: 3,
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

    const firstSlot = db
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
      draftOrderId: firstSlot.id,
      playerId: 'player-picked',
      now: () => '2026-05-18T20:05:00.000Z',
      idGenerator: () => 'pick-row-id',
    });

    db.prepare('INSERT INTO user_queue (id, draft_id, player_id, rank) VALUES (?, ?, ?, ?)').run(
      'queue-row-id',
      draftId,
      'player-queued',
      1,
    );

    const secondSlot = db
      .prepare(
        `SELECT do.pick_number, do.round, do.team_id
         FROM draft_order do
         WHERE do.draft_id = ?
         ORDER BY do.pick_number
         LIMIT 1 OFFSET 1`,
      )
      .get(draftId) as { pick_number: number; round: number; team_id: string };

    const userTeamId = (
      db.prepare('SELECT id FROM teams WHERE draft_id = ? AND is_user = 1').get(draftId) as { id: string }
    ).id;

    db.prepare(
      `INSERT INTO trades (
        id,
        draft_id,
        pick_number,
        round,
        initiating_team_id,
        receiving_team_id,
        assets_sent,
        assets_received,
        status,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'trade-row-id',
      draftId,
      secondSlot.pick_number,
      secondSlot.round,
      secondSlot.team_id,
      userTeamId,
      JSON.stringify([{ type: 'pick', year: 2027, round: 1 }]),
      JSON.stringify([{ type: 'player', player_id: 'player-picked' }]),
      'declined',
      '2026-05-18T20:06:00.000Z',
    );

    const response = await invokeRoute({
      route: createDraftStateRoute({ databasePath }),
      params: { id: draftId },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'application/json');

    const body = response.json as {
      draft_id: string;
      status: string;
      current_pick_number: number | null;
      teams: Array<{ id: string; name: string; is_user: boolean; archetype: string | null }>;
      draft_order: Array<{ pick_number: number; round: number; pick_in_round: number; team_id: string }>;
      picks: Array<{ pick_number: number; team_id: string; player_id: string; picked_at: string }>;
      roster_players: Array<{ team_id: string; player_id: string }>;
      team_pick_assets: Array<{ team_id: string; year: number; round: number }>;
      user_queue: Array<{ player_id: string; rank: number }>;
      available_players: Array<{ id: string; dynasty_value: number }>;
      trades: Array<{
        id: string;
        round: number;
        initiating_team_id: string;
        receiving_team_id: string;
        assets_sent: Array<{ type: string; year?: number; round?: number }>;
        assets_received: Array<{ type: string; player_id?: string }>;
        status: string;
      }>;
    };

    assert.equal(body.draft_id, draftId);
    assert.equal(body.status, 'in_progress');
    assert.equal(body.current_pick_number, 2);
    assert.equal(body.teams.length, 4);
    assert.deepEqual(body.teams.map((team) => team.name), ['Bob', 'You', 'Carl', 'Dana']);
    assert.deepEqual(
      body.draft_order.slice(0, 4),
      [
        { pick_number: 1, round: 1, pick_in_round: 1, team_id: body.teams[0]?.id },
        { pick_number: 2, round: 1, pick_in_round: 2, team_id: body.teams[1]?.id },
        { pick_number: 3, round: 1, pick_in_round: 3, team_id: body.teams[2]?.id },
        { pick_number: 4, round: 1, pick_in_round: 4, team_id: body.teams[3]?.id },
      ],
    );
    assert.deepEqual(body.picks, [
      {
        pick_number: 1,
        team_id: body.teams[0]?.id,
        player_id: 'player-picked',
        picked_at: '2026-05-18T20:05:00.000Z',
      },
    ]);
    assert.deepEqual(body.roster_players, [
      {
        team_id: body.teams[0]?.id,
        player_id: 'player-picked',
      },
    ]);
    assert.equal(body.team_pick_assets.length, 8);
    assert.deepEqual(body.user_queue, [{ player_id: 'player-queued', rank: 1 }]);
    assert.deepEqual(
      body.available_players.map((player) => ({
        id: player.id,
        dynasty_value: player.dynasty_value,
      })),
      [{ id: 'player-queued', dynasty_value: 5000 }],
    );
    assert.deepEqual(body.trades, [
      {
        id: 'trade-row-id',
        round: 1,
        initiating_team_id: body.teams[1]?.id,
        receiving_team_id: userTeamId,
        assets_sent: [{ type: 'pick', year: 2027, round: 1 }],
        assets_received: [{ type: 'player', player_id: 'player-picked' }],
        status: 'declined',
      },
    ]);
  } finally {
    db.close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

test('GET /drafts/:id/state returns 404 for an unknown draft id', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-state-missing-');
  initializeDatabase(databasePath);

  try {
    const response = await invokeRoute({
      route: createDraftStateRoute({ databasePath }),
      params: { id: 'nonexistent-id' },
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json, { error: 'Draft not found.' });
  } finally {
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

test('GET /drafts/:id/state returns 500 when persisted trade JSON cannot be parsed', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-state-error-');
  initializeDatabase(databasePath);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  try {
    seedPlayer(db, 'player-picked', 'Picked Player', 'QB');

    const draftId = createDraft({
      databasePath,
      config: {
        teamCount: 2,
        rounds: 2,
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

    const firstSlot = db
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
      draftOrderId: firstSlot.id,
      playerId: 'player-picked',
      now: () => '2026-05-18T20:05:00.000Z',
      idGenerator: () => 'pick-row-id',
    });

    const firstTeamId = (
      db.prepare('SELECT id FROM teams WHERE draft_id = ? ORDER BY pick_position LIMIT 1').get(draftId) as {
        id: string;
      }
    ).id;
    const secondTeamId = (
      db.prepare('SELECT id FROM teams WHERE draft_id = ? ORDER BY pick_position LIMIT 1 OFFSET 1').get(draftId) as {
        id: string;
      }
    ).id;

    db.prepare(
      `INSERT INTO trades (
        id,
        draft_id,
        pick_number,
        round,
        initiating_team_id,
        receiving_team_id,
        assets_sent,
        assets_received,
        status,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'trade-row-id',
      draftId,
      1,
      1,
      firstTeamId,
      secondTeamId,
      'not-json',
      JSON.stringify([{ type: 'player', player_id: 'player-picked' }]),
      'declined',
      '2026-05-18T20:06:00.000Z',
    );

    const response = await invokeRoute({
      route: createDraftStateRoute({ databasePath }),
      params: { id: draftId },
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json, { error: 'Internal server error.' });
  } finally {
    db.close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

test('GET /drafts returns all persisted drafts with history metadata', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-history-');
  initializeDatabase(databasePath);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  try {
    const completedDraftId = createDraft({
      databasePath,
      config: {
        teamCount: 2,
        rounds: 2,
        scoringFormat: 'standard',
        userPickPosition: 1,
        futurePickYears: 1,
        futurePickRounds: 1,
        rosterConfig: {
          QB: 1,
          RB: 2,
          WR: 2,
          TE: 1,
          FLEX: 1,
          SF: 0,
          bench: 5,
        },
      },
      now: () => '2026-05-18T18:00:00.000Z',
      random: () => 0,
    });
    const inProgressDraftId = createDraft({
      databasePath,
      config: {
        teamCount: 4,
        rounds: 3,
        scoringFormat: 'half_ppr',
        userPickPosition: 3,
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
      now: () => '2026-05-18T19:00:00.000Z',
      random: () => 0,
    });

    const completedAt = '2026-05-18T20:00:00.000Z';
    db.prepare('UPDATE drafts SET status = ?, completed_at = ? WHERE id = ?').run(
      'completed',
      completedAt,
      completedDraftId,
    );

    const response = await invokeRoute({
      route: createDraftHistoryRoute({ databasePath }),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'application/json');

    const body = response.json as Array<{
      id: string;
      created_at: string;
      completed_at: string | null;
      status: string;
      team_count: number;
      rounds: number;
    }>;

    assert.deepEqual(body, [
      {
        id: inProgressDraftId,
        created_at: '2026-05-18T19:00:00.000Z',
        completed_at: null,
        status: 'in_progress',
        team_count: 4,
        rounds: 3,
      },
      {
        id: completedDraftId,
        created_at: '2026-05-18T18:00:00.000Z',
        completed_at: completedAt,
        status: 'completed',
        team_count: 2,
        rounds: 2,
      },
    ]);
  } finally {
    db.close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

test('GET /drafts returns an empty array when no drafts exist', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-history-empty-');
  initializeDatabase(databasePath);

  try {
    const response = await invokeRoute({
      route: createDraftHistoryRoute({ databasePath }),
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json, []);
  } finally {
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

test('GET /drafts returns 500 when the drafts table is unavailable', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-history-error-');

  try {
    const response = await invokeRoute({
      route: createDraftHistoryRoute({ databasePath }),
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json, { error: 'Internal server error.' });
  } finally {
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

test('Vite dev server proxies /drafts requests to the backend server', () => {
  const serverConfig = viteConfig.server;
  const proxyConfig = serverConfig?.proxy?.['/drafts'];

  assert.ok(serverConfig);
  assert.ok(proxyConfig && typeof proxyConfig !== 'string');
  assert.equal(proxyConfig.target, resolveApiBaseUrl());
});

test('parseCreateDraftConfig maps UI camelCase config into the service draft config shape', () => {
  const config = parseCreateDraftConfig(
    createDraftRequestBody({
      configName: 'Standard Build',
      teamCount: 8,
      rounds: 10,
      scoringFormat: 'standard',
      rosterSlots: {
        QB: 1,
        RB: 3,
        WR: 2,
        TE: 2,
        FLEX: 0,
        SF: 0,
        BN: 5,
      },
      pickPosition: 8,
      futurePickYears: 1,
    }),
  );

  assert.deepEqual(config, {
    teamCount: 8,
    rounds: 10,
    scoringFormat: 'standard',
    userPickPosition: 8,
    futurePickYears: 1,
    futurePickRounds: 10,
    rosterConfig: {
      QB: 1,
      RB: 3,
      WR: 2,
      TE: 2,
      FLEX: 0,
      SF: 0,
      bench: 5,
    },
  });
});

test('parseCreateDraftConfig rejects invalid request bodies and config values with descriptive validation errors', () => {
  assert.throws(
    () => parseCreateDraftConfig(null),
    /Invalid draft config: request body must be a JSON object\./,
  );
  assert.throws(
    () => parseCreateDraftConfig(createDraftRequestBody({ configName: 12 })),
    /Invalid draft config: configName must be a string\./,
  );
  assert.throws(
    () => parseCreateDraftConfig(createDraftRequestBody({ scoringFormat: 'dynasty' })),
    /Invalid draft config: scoringFormat must be one of ppr, half_ppr, standard\./,
  );
  assert.throws(
    () => parseCreateDraftConfig(createDraftRequestBody({ pickPosition: 13 })),
    /Invalid draft config: pickPosition must be an integer between 1 and 12\./,
  );
  assert.throws(
    () =>
      parseCreateDraftConfig(
        createDraftRequestBody({
          rosterSlots: {
            QB: 1,
            RB: 2,
            WR: 3,
            TE: 1,
            FLEX: 1,
            SF: 1,
            BN: -1,
          },
        }),
      ),
    /Invalid draft config: rosterSlots.BN must be a non-negative integer\./,
  );
  assert.throws(
    () => parseCreateDraftConfig(createDraftRequestBody({ futurePickYears: 0 })),
    /Invalid draft config: futurePickYears must be an integer between 1 and 5\./,
  );
});
