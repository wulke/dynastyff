// @spec DFF-SLS-010
// @spec DFF-SLS-011
// @spec DFF-SLS-012
// @spec DFF-SLS-013
// @spec DFF-SLS-014
// @spec DFF-SLS-020
// @spec DFF-SLS-021
// @spec DFF-SLS-022
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import DatabaseConstructor from 'better-sqlite3';
import type { Request, RequestHandler, Response } from 'express';

import { initializeDatabase } from '../src/db/init.js';
import { createDraftErrorHandler } from '../src/server/app.js';
import {
  createSleeperConnectionsCreateRoute,
  createSleeperConnectionsDeleteRoute,
  createSleeperConnectionsListRoute,
  createSleeperLeaguePreviewRoute,
  createSleeperSyncRoute,
  createSleeperSyncStatusRoute,
  createSleeperUserRoute,
  maybeRunStartupSleeperSync,
  shouldSyncOnStartup,
} from '../src/server/sleeper-routes.js';
import type { FetchLike } from '../src/etl/sleeper/types.js';

function createFixture(): { dbPath: string; cleanup: () => void } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-sleeper-routes-'));
  const dbPath = path.join(tempDir, 'test.sqlite');
  initializeDatabase(dbPath);

  return { dbPath, cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }) };
}

function openDb(dbPath: string): Database.Database {
  const db = new DatabaseConstructor(dbPath);
  db.pragma('foreign_keys = ON');
  return db;
}

async function invokeRoute({
  route,
  body,
  params,
}: {
  route: RequestHandler;
  body?: unknown;
  params?: Record<string, string>;
}): Promise<{ statusCode: number; json: unknown }> {
  const request = { body, params } as Request;
  const errorHandler = createDraftErrorHandler();
  let statusCode = 200;
  let responseBody: unknown;
  let forwardedError: unknown;
  const response = {
    statusCode: 200,
    status(code: number) {
      statusCode = code;
      this.statusCode = code;
      return this;
    },
    json(bodyJson: unknown) {
      responseBody = bodyJson;
      return this;
    },
    end() {
      return this;
    },
  } as Response;

  await Promise.resolve(
    route(request, response, (error?: unknown) => {
      forwardedError = error;
    }),
  );

  if (forwardedError !== undefined) {
    errorHandler(forwardedError, request, response, () => undefined);
  }

  return { statusCode, json: responseBody };
}

function createFakeSleeperFetch(routes: Record<string, () => unknown>): FetchLike {
  return async (url: string) => {
    const pathname = new URL(url).pathname;

    for (const [route, handler] of Object.entries(routes)) {
      if (pathname.endsWith(route)) {
        return new Response(JSON.stringify(handler()), { status: 200 });
      }
    }

    return new Response(JSON.stringify(null), { status: 404 });
  };
}

const fixedNow = () => new Date('2026-09-27T12:00:00.000Z');

function userRoutes(): Record<string, () => unknown> {
  return {
    '/user/trev': () => ({ user_id: 'u1', username: 'trev', display_name: 'Trev' }),
    '/user/u1/leagues/nfl/2026': () => [
      { league_id: '111', name: 'Dynasty A', season: '2026', total_rosters: 12, status: 'in_season', settings: { type: 'dynasty' } },
      { league_id: '222', name: 'Redraft B', season: '2026', total_rosters: 10, status: 'in_season', settings: { type: 'redraft' } },
      { league_id: '333', name: 'Legacy C', season: '2026', total_rosters: 14, status: 'in_season' },
    ],
  };
}

// @spec DFF-SLS-010
// @spec DFF-SLS-071
test('GET /sleeper/user/:username resolves the user and lists dynasty leagues for the derived season', async () => {
  const fixture = createFixture();

  try {
    const { statusCode, json } = await invokeRoute({
      route: createSleeperUserRoute({ databasePath: fixture.dbPath, fetchImpl: createFakeSleeperFetch(userRoutes()), now: fixedNow }),
      params: { username: 'trev' },
    });

    assert.equal(statusCode, 200);
    const payload = json as { userId: string; leagues: Array<{ leagueId: string }> };
    assert.equal(payload.userId, 'u1');
    assert.deepEqual(
      payload.leagues.map((league) => league.leagueId),
      ['111', '333'],
    );
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SLS-010
test('GET /sleeper/user/:username returns 404 for unknown users and 502 on upstream failures', async () => {
  const fixture = createFixture();

  try {
    const notFound = await invokeRoute({
      route: createSleeperUserRoute({ databasePath: fixture.dbPath, fetchImpl: createFakeSleeperFetch({ '/user/ghost': () => null }), now: fixedNow }),
      params: { username: 'ghost' },
    });
    assert.equal(notFound.statusCode, 404);

    const upstream = await invokeRoute({
      route: createSleeperUserRoute({ databasePath: fixture.dbPath, fetchImpl: createFakeSleeperFetch({}), now: fixedNow }),
      params: { username: 'trev' },
    });
    assert.equal(upstream.statusCode, 502);

    const invalid = await invokeRoute({
      route: createSleeperUserRoute({ databasePath: fixture.dbPath, fetchImpl: createFakeSleeperFetch(userRoutes()), now: fixedNow }),
      params: { username: '' },
    });
    assert.equal(invalid.statusCode, 400);
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SLS-011
test('GET /sleeper/league/:league_id previews league metadata', async () => {
  const fixture = createFixture();
  const fetchImpl = createFakeSleeperFetch({
    '/league/111111111111111111': () => ({ league_id: '111111111111111111', name: 'Gridiron Guild', season: '2026', total_rosters: 12, status: 'in_season' }),
    '/league/999999999999999999': () => null,
  });

  try {
    const ok = await invokeRoute({
      route: createSleeperLeaguePreviewRoute({ databasePath: fixture.dbPath, fetchImpl }),
      params: { league_id: '111111111111111111' },
    });
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(ok.json, {
      leagueId: '111111111111111111',
      name: 'Gridiron Guild',
      season: '2026',
      totalRosters: 12,
      status: 'in_season',
    });

    const missing = await invokeRoute({
      route: createSleeperLeaguePreviewRoute({ databasePath: fixture.dbPath, fetchImpl }),
      params: { league_id: '999999999999999999' },
    });
    assert.equal(missing.statusCode, 404);

    const invalid = await invokeRoute({
      route: createSleeperLeaguePreviewRoute({ databasePath: fixture.dbPath, fetchImpl }),
      params: { league_id: 'abc' },
    });
    assert.equal(invalid.statusCode, 400);

    const unreachable = await invokeRoute({
      route: createSleeperLeaguePreviewRoute({ databasePath: fixture.dbPath, fetchImpl: createFakeSleeperFetch({}) }),
      params: { league_id: '111111111111111111' },
    });
    assert.equal(unreachable.statusCode, 502);
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SLS-012
test('POST /sleeper/connections adds a league connection bound to the user roster', async () => {
  const fixture = createFixture();
  const fetchImpl = createFakeSleeperFetch({
    '/user/trev': () => ({ user_id: 'u1', username: 'trev' }),
    '/league/111111111111111111': () => ({ league_id: '111111111111111111', name: 'Gridiron Guild', season: '2026', total_rosters: 12, status: 'in_season' }),
    '/league/111111111111111111/rosters': () => [
      { roster_id: 1, owner_id: 'u2' },
      { roster_id: 2, owner_id: 'u1' },
    ],
  });

  try {
    const created = await invokeRoute({
      route: createSleeperConnectionsCreateRoute({
        databasePath: fixture.dbPath,
        fetchImpl,
        idGenerator: () => 'fixed-connection-id',
        now: fixedNow,
      }),
      body: { username: 'trev', league_id: '111111111111111111' },
    });

    assert.equal(created.statusCode, 201);
    assert.deepEqual(created.json, {
      id: 'fixed-connection-id',
      leagueId: '111111111111111111',
      leagueName: 'Gridiron Guild',
      season: '2026',
      userId: 'u1',
      rosterId: 2,
      connectedAt: '2026-09-27T12:00:00.000Z',
      lastSyncedAt: null,
    });

    const duplicate = await invokeRoute({
      route: createSleeperConnectionsCreateRoute({ databasePath: fixture.dbPath, fetchImpl, now: fixedNow }),
      body: { username: 'trev', league_id: '111111111111111111' },
    });
    assert.equal(duplicate.statusCode, 409);

    const invalidBody = await invokeRoute({
      route: createSleeperConnectionsCreateRoute({ databasePath: fixture.dbPath, fetchImpl, now: fixedNow }),
      body: { username: 'trev' },
    });
    assert.equal(invalidBody.statusCode, 400);

    const noRosterFetch = createFakeSleeperFetch({
      '/user/trev': () => ({ user_id: 'u1', username: 'trev' }),
      '/league/111111111111111111': () => ({ league_id: '111111111111111111', name: 'Gridiron Guild', season: '2026', total_rosters: 12, status: 'in_season' }),
      '/league/111111111111111111/rosters': () => [{ roster_id: 1, owner_id: 'u2' }],
    });
    const noRoster = await invokeRoute({
      route: createSleeperConnectionsCreateRoute({ databasePath: fixture.dbPath, fetchImpl: noRosterFetch, now: fixedNow }),
      body: { username: 'trev', league_id: '111111111111111111' },
    });
    assert.equal(noRoster.statusCode, 400);
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SLS-013
// @spec DFF-SLS-014
test('connection list and delete routes manage sleeper_connections rows', async () => {
  const fixture = createFixture();

  try {
    {
      const db = openDb(fixture.dbPath);
      try {
        db.prepare(
          `INSERT INTO sleeper_connections (id, league_id, league_name, season, user_id, roster_id, connected_at)
           VALUES ('c1', '111111111111111111', 'Gridiron Guild', '2026', 'u1', 2, '2026-09-01T00:00:00.000Z')`,
        ).run();
      } finally {
        db.close();
      }
    }

    const listed = await invokeRoute({
      route: createSleeperConnectionsListRoute({ databasePath: fixture.dbPath }),
    });
    assert.equal(listed.statusCode, 200);
    assert.deepEqual(listed.json, [
      {
        id: 'c1',
        leagueId: '111111111111111111',
        leagueName: 'Gridiron Guild',
        season: '2026',
        userId: 'u1',
        rosterId: 2,
        connectedAt: '2026-09-01T00:00:00.000Z',
        lastSyncedAt: null,
      },
    ]);

    const deleted = await invokeRoute({
      route: createSleeperConnectionsDeleteRoute({ databasePath: fixture.dbPath }),
      params: { id: 'c1' },
    });
    assert.equal(deleted.statusCode, 204);

    const missing = await invokeRoute({
      route: createSleeperConnectionsDeleteRoute({ databasePath: fixture.dbPath }),
      params: { id: 'c1' },
    });
    assert.equal(missing.statusCode, 404);

    const unknown = await invokeRoute({
      route: createSleeperConnectionsDeleteRoute({ databasePath: fixture.dbPath }),
      params: { id: 'c2' },
    });
    assert.equal(unknown.statusCode, 404);

    const invalid = await invokeRoute({
      route: createSleeperConnectionsDeleteRoute({ databasePath: fixture.dbPath }),
      params: {},
    });
    assert.equal(invalid.statusCode, 400);
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SLS-020
test('POST /sleeper/sync runs the Sleeper sync and returns the result', async () => {
  const fixture = createFixture();
  const calls: Array<{ databasePath?: string }> = [];

  try {
    const { statusCode, json } = await invokeRoute({
      route: createSleeperSyncRoute({
        databasePath: fixture.dbPath,
        runSleeperSyncImpl: async (options) => {
          calls.push({ databasePath: options.databasePath });
          return { skipped: false, attempted: ['1'], succeeded: ['1'], outcomes: [] };
        },
      }),
    });

    assert.equal(statusCode, 200);
    assert.deepEqual(calls, [{ databasePath: fixture.dbPath }]);
    assert.deepEqual(json, { skipped: false, attempted: ['1'], succeeded: ['1'], outcomes: [] });
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SLS-021
test('GET /sleeper/sync/status returns the last run per league with per-league errors', async () => {
  const fixture = createFixture();

  try {
    const db = openDb(fixture.dbPath);
    try {
      db.prepare(
        `INSERT INTO sleeper_connections (id, league_id, league_name, season, user_id, roster_id, connected_at)
         VALUES ('c1', '111', 'Guild', '2026', 'u1', 2, '2026-09-01T00:00:00.000Z'),
                ('c2', '222', 'Rivals', '2026', 'u1', 5, '2026-09-01T00:00:00.000Z')`,
      ).run();
      db.prepare(
        `INSERT INTO sleeper_sync_runs (id, started_at, completed_at, league_ids_attempted, league_ids_succeeded, error)
         VALUES ('r1', '2026-09-27T10:00:00.000Z', '2026-09-27T10:00:05.000Z', '["111","222"]', '["111"]', '{"222":"Sleeper returned 500."}')`,
      ).run();
    } finally {
      db.close();
    }

    const { statusCode, json } = await invokeRoute({
      route: createSleeperSyncStatusRoute({ databasePath: fixture.dbPath }),
    });

    assert.equal(statusCode, 200);
    const status = json as Array<{
      leagueId: string;
      lastSyncedAt: string | null;
      lastRun: { startedAt: string; completedAt: string | null; error: string | null };
    }>;

    assert.equal(status.length, 2);
    assert.equal(status[0]?.leagueId, '111');
    assert.equal(status[0]?.lastRun.error, null);
    assert.equal(status[1]?.leagueId, '222');
    assert.equal(status[1]?.lastRun.error, 'Sleeper returned 500.');
    assert.equal(status[1]?.lastRun.completedAt, '2026-09-27T10:00:05.000Z');
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SLS-022
test('shouldSyncOnStartup requires connections and a stale last run', () => {
  assert.equal(shouldSyncOnStartup({ connectionCount: 0, lastRunCompletedAt: null }), false);
  assert.equal(shouldSyncOnStartup({ connectionCount: 1, lastRunCompletedAt: null }), true);

  const now = fixedNow;
  assert.equal(
    shouldSyncOnStartup({ connectionCount: 1, lastRunCompletedAt: '2026-09-27T11:50:00.000Z', now }),
    false,
  );
  assert.equal(
    shouldSyncOnStartup({ connectionCount: 1, lastRunCompletedAt: '2026-09-27T11:44:00.000Z', now }),
    true,
  );
  assert.equal(
    shouldSyncOnStartup({ connectionCount: 1, lastRunCompletedAt: 'not-a-date', now }),
    true,
  );
});

// @spec DFF-SLS-022
test('maybeRunStartupSleeperSync triggers the background sync only when needed', async () => {
  const stale = createFixture();

  try {
    {
      const db = openDb(stale.dbPath);
      try {
        db.prepare(
          `INSERT INTO sleeper_connections (id, league_id, league_name, season, user_id, roster_id, connected_at)
           VALUES ('c1', '111', 'Guild', '2026', 'u1', 2, '2026-09-01T00:00:00.000Z')`,
        ).run();
      } finally {
        db.close();
      }
    }

    const syncCalls: number[] = [];
    const triggered = await maybeRunStartupSleeperSync({
      databasePath: stale.dbPath,
      now: fixedNow,
      runSleeperSyncImpl: async () => {
        syncCalls.push(1);
        return { skipped: false, attempted: ['111'], succeeded: ['111'], outcomes: [] };
      },
    });

    assert.equal(triggered, true);
    assert.equal(syncCalls.length, 1);

    // A fresh run row within 15 minutes must suppress the sync.
    {
      const db = openDb(stale.dbPath);
      try {
        db.prepare(
          `INSERT INTO sleeper_sync_runs (id, started_at, completed_at, league_ids_attempted, league_ids_succeeded, error)
           VALUES ('r1', '2026-09-27T11:55:00.000Z', '2026-09-27T11:55:05.000Z', '["111"]', '["111"]', NULL)`,
        ).run();
      } finally {
        db.close();
      }
    }

    const suppressed = await maybeRunStartupSleeperSync({
      databasePath: stale.dbPath,
      now: fixedNow,
      runSleeperSyncImpl: async () => {
        syncCalls.push(1);
        return { skipped: true, attempted: [], succeeded: [], outcomes: [] };
      },
    });

    assert.equal(suppressed, false);
    assert.equal(syncCalls.length, 1);
  } finally {
    stale.cleanup();
  }

  const empty = createFixture();

  try {
    const skipped = await maybeRunStartupSleeperSync({
      databasePath: empty.dbPath,
      runSleeperSyncImpl: async () => {
        throw new Error('should not run');
      },
    });

    assert.equal(skipped, false);
  } finally {
    empty.cleanup();
  }
});
