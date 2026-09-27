// @spec DFF-SM-010
// @spec DFF-SM-018
// @spec DFF-SM-030
// @spec DFF-SM-031
// @spec DFF-SM-043
// @spec DFF-SM-081
// @spec DFF-SM-083
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, RequestHandler, Response } from 'express';

import { createDraftErrorHandler } from '../src/server/app.js';
import {
  createSeasonOverviewRoute,
  createSeasonTradeAnalyzeRoute,
  createSeasonTradesPendingRoute,
} from '../src/server/season-routes.js';
import type { SeasonAdvisor } from '../src/season/seasonAdvisor.js';
import { createSeasonFixture, seasonLeagueId } from './season-fixture.js';

async function invokeRoute({
  route,
  params,
  body,
}: {
  route: RequestHandler;
  params?: Record<string, string>;
  body?: unknown;
}): Promise<{ statusCode: number; json: unknown }> {
  const request = { params, body } as Request;
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

// @spec DFF-SM-030
test('GET /season/:league_id/trades/pending returns only offers involving the user', async () => {
  const fixture = createSeasonFixture();
  const route = createSeasonTradesPendingRoute({ databasePath: fixture.dbPath });

  try {
    // A pending offer between two other teams must not surface.
    fixture.db
      .prepare(
        "INSERT INTO sleeper_trade_offers (id, league_id, transaction_id, status, proposer_roster_id, responder_roster_ids, adds, drops, draft_picks, created_at, updated_at) VALUES ('t3', ?, 557, 'pending', 3, ?, '{}', '{}', '[]', '2026-09-26T19:00:00.000Z', '2026-09-26T19:00:00.000Z')",
      )
      .run(seasonLeagueId, JSON.stringify([4]));

    const { statusCode, json } = await invokeRoute({ route, params: { league_id: seasonLeagueId } });

    assert.equal(statusCode, 200);
    const trades = (json as { trades: { transactionId: string; verdict: string }[] }).trades;

    assert.deepEqual(
      trades.map((trade) => trade.transactionId),
      ['555'],
    );
    assert.ok(['win', 'loss', 'neutral'].includes(trades[0].verdict));
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SM-031
test('POST /season/:league_id/trades/analyze returns the score plus reasoning', async () => {
  const fixture = createSeasonFixture();
  const advisor: SeasonAdvisor = {
    explainTrade: async () => ({ narrative: '**Verdict:** Neutral', claudeUnavailable: false }),
  };
  const route = createSeasonTradeAnalyzeRoute({ databasePath: fixture.dbPath, advisor });

  try {
    const { statusCode, json } = await invokeRoute({
      route,
      params: { league_id: seasonLeagueId },
      body: { transaction_id: 555 },
    });

    assert.equal(statusCode, 200);
    const payload = json as {
      transactionId: string;
      score: { verdict: string; compositeScore: number };
      narrative: string | null;
      claudeUnavailable: boolean;
    };

    assert.equal(payload.transactionId, '555');
    assert.ok(['win', 'loss', 'neutral'].includes(payload.score.verdict));
    assert.equal(payload.narrative, '**Verdict:** Neutral');
    assert.equal(payload.claudeUnavailable, false);
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SM-043
test('POST /trades/analyze surfaces claudeUnavailable when the advisor fails', async () => {
  const fixture = createSeasonFixture();
  const advisor: SeasonAdvisor = {
    explainTrade: async () => ({ narrative: null, claudeUnavailable: true }),
  };
  const route = createSeasonTradeAnalyzeRoute({ databasePath: fixture.dbPath, advisor });

  try {
    const { statusCode, json } = await invokeRoute({
      route,
      params: { league_id: seasonLeagueId },
      body: { transaction_id: '555' },
    });

    assert.equal(statusCode, 200);
    const payload = json as { claudeUnavailable: boolean; score: unknown; narrative: string | null };

    assert.equal(payload.claudeUnavailable, true);
    assert.equal(payload.narrative, null);
    assert.ok(payload.score, 'the raw score is still returned');
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SM-031
test('POST /trades/analyze rejects unknown or third-party transactions', async () => {
  const fixture = createSeasonFixture();
  const advisor: SeasonAdvisor = {
    explainTrade: async () => ({ narrative: null, claudeUnavailable: true }),
  };
  const route = createSeasonTradeAnalyzeRoute({ databasePath: fixture.dbPath, advisor });

  try {
    const unknown = await invokeRoute({
      route,
      params: { league_id: seasonLeagueId },
      body: { transaction_id: 999 },
    });
    assert.equal(unknown.statusCode, 404);

    const missingBody = await invokeRoute({ route, params: { league_id: seasonLeagueId }, body: {} });
    assert.equal(missingBody.statusCode, 400);

    const unconnected = await invokeRoute({
      route,
      params: { league_id: 'other' },
      body: { transaction_id: 555 },
    });
    assert.equal(unconnected.statusCode, 404);
  } finally {
    fixture.cleanup();
  }
});
