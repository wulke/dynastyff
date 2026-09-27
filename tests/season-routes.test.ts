// @spec DFF-SM-010
// @spec DFF-SM-018
// @spec DFF-SM-081
// @spec DFF-SM-083
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, RequestHandler, Response } from 'express';

import { createDraftErrorHandler } from '../src/server/app.js';
import { createSeasonOverviewRoute } from '../src/server/season-routes.js';
import { createSeasonFixture, seasonLeagueId } from './season-fixture.js';

async function invokeRoute({
  route,
  params,
}: {
  route: RequestHandler;
  params?: Record<string, string>;
}): Promise<{ statusCode: number; json: unknown }> {
  const request = { params } as Request;
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

const freshNow = () => new Date('2026-09-27T12:00:00.000Z');

// @spec DFF-SM-010
// @spec DFF-SM-018
test('GET /season/:league_id/overview returns pure algorithm output', async () => {
  const fixture = createSeasonFixture();
  const route = createSeasonOverviewRoute({ databasePath: fixture.dbPath, now: freshNow });

  try {
    const { statusCode, json } = await invokeRoute({ route, params: { league_id: seasonLeagueId } });

    assert.equal(statusCode, 200);
    const overview = json as {
      overallGrade: string;
      overallPercentile: number;
      teamContext: { classification: string };
      positions: Record<string, unknown>;
      roster: unknown[];
      staleSince: string | null;
      lastSyncedAt: string;
    };

    assert.ok(['A', 'B', 'C', 'D', 'F'].includes(overview.overallGrade));
    assert.ok(overview.overallPercentile >= 0 && overview.overallPercentile <= 100);
    assert.ok(['contender', 'rebuilder'].includes(overview.teamContext.classification));
    assert.deepEqual(Object.keys(overview.positions).sort(), ['QB', 'RB', 'TE', 'WR']);
    assert.ok(overview.roster.length > 0);
    assert.equal(overview.staleSince, null);
    assert.equal(overview.lastSyncedAt, '2026-09-27T11:30:00.000Z');
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SM-081
test('overview flags stale data when the last sync is older than one hour', async () => {
  const fixture = createSeasonFixture();
  const route = createSeasonOverviewRoute({ databasePath: fixture.dbPath, now: freshNow });

  try {
    fixture.db.prepare('UPDATE sleeper_connections SET last_synced_at = ?').run('2026-09-27T09:00:00.000Z');

    const { statusCode, json } = await invokeRoute({ route, params: { league_id: seasonLeagueId } });

    assert.equal(statusCode, 200);
    assert.equal((json as { staleSince: string | null }).staleSince, '2026-09-27T09:00:00.000Z');
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SM-083
test('overview returns 422 when fewer than 4 teams have data', async () => {
  const fixture = createSeasonFixture({ teamCount: 3 });
  const route = createSeasonOverviewRoute({ databasePath: fixture.dbPath, now: freshNow });

  try {
    const { statusCode, json } = await invokeRoute({ route, params: { league_id: seasonLeagueId } });

    assert.equal(statusCode, 422);
    assert.equal((json as { code: string }).code, 'INSUFFICIENT_DATA');
  } finally {
    fixture.cleanup();
  }
});

test('overview returns 404 for unknown leagues and unconnected leagues', async () => {
  const fixture = createSeasonFixture();
  const route = createSeasonOverviewRoute({ databasePath: fixture.dbPath, now: freshNow });

  try {
    const unknown = await invokeRoute({ route, params: { league_id: 'missing' } });
    assert.equal(unknown.statusCode, 404);
    assert.equal((unknown.json as { code: string }).code, 'NOT_FOUND');

    fixture.db.prepare('DELETE FROM sleeper_connections').run();

    const unconnected = await invokeRoute({ route, params: { league_id: seasonLeagueId } });
    assert.equal(unconnected.statusCode, 404);
    assert.equal((unconnected.json as { code: string }).code, 'NOT_CONNECTED');
  } finally {
    fixture.cleanup();
  }
});
