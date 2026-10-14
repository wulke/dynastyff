// @spec DFF-SM-010
// @spec DFF-SM-018
// @spec DFF-SM-030
// @spec DFF-SM-031
// @spec DFF-SM-043
// @spec DFF-SM-081
// @spec DFF-SM-083
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Request, RequestHandler, Response } from 'express';

import { createDraftErrorHandler } from '../src/server/app.js';
import {
  createSeasonDevyClaimsRoute,
  createSeasonDevyOwnershipRoute,
  createSeasonOverviewRoute,
  createSeasonTradeAnalyzeRoute,
  createSeasonTradeRecommendationsRoute,
  createSeasonTradesPendingRoute,
  createSeasonWaiverAnalyzeRoute,
  createSeasonWaiversRoute,
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
    explainWaiver: async () => ({ narrative: null, claudeUnavailable: true }),
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
    explainWaiver: async () => ({ narrative: null, claudeUnavailable: true }),
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
    explainWaiver: async () => ({ narrative: null, claudeUnavailable: true }),
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

// @spec DFF-SM-050
// @spec DFF-SM-055
// @spec DFF-SM-085
test('GET /season/:league_id/trades/recommendations returns grouped candidates recomputed per request', async () => {
  const fixture = createSeasonFixture();
  const fixedNow = () => new Date('2026-09-27T12:00:00.000Z');
  const route = createSeasonTradeRecommendationsRoute({ databasePath: fixture.dbPath, now: fixedNow });

  try {
    const { statusCode, json } = await invokeRoute({ route, params: { league_id: seasonLeagueId } });

    assert.equal(statusCode, 200);
    const payload = json as {
      groups: Record<string, { label: string; candidates: unknown[] }>;
      lastComputedAt: string;
    };

    assert.deepEqual(Object.keys(payload.groups).sort(), ['picks', 'qb', 'rb', 'sell', 'te', 'wr']);

    for (const group of Object.values(payload.groups)) {
      assert.ok(group.candidates.length <= 3, 'groups cap at three candidates');
    }

    assert.equal(payload.lastComputedAt, '2026-09-27T12:00:00.000Z');
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SM-031
test('POST /trades/analyze accepts a hypothetical trade_offer payload', async () => {
  const fixture = createSeasonFixture();
  const seen: unknown[] = [];
  const advisor: SeasonAdvisor = {
    explainTrade: async (_context, score, offer) => {
      seen.push({ score, offer });
      return { narrative: '**Verdict:** Win', claudeUnavailable: false };
    },
    explainWaiver: async () => ({ narrative: null, claudeUnavailable: true }),
  };
  const route = createSeasonTradeAnalyzeRoute({ databasePath: fixture.dbPath, advisor });

  try {
    const { statusCode, json } = await invokeRoute({
      route,
      params: { league_id: seasonLeagueId },
      body: {
        trade_offer: {
          transactionId: -5,
          status: 'hypothetical',
          proposerRosterId: 2,
          responderRosterIds: [1],
          adds: { 's-p2-qb': 1 },
          drops: { 's-p2-qb': 2, 's-wr2': 1 },
          draftPicks: [],
          createdAt: '2026-09-27T00:00:00.000Z',
        },
      },
    });

    assert.equal(statusCode, 200);
    const payload = json as { transactionId: string; score: { verdict: string }; narrative: string | null };

    assert.equal(payload.transactionId, '-5');
    assert.ok(['win', 'loss', 'neutral'].includes(payload.score.verdict));
    assert.equal(payload.narrative, '**Verdict:** Win');

    // The advisor receives the hypothetical offer so it can resolve the counterparty roster.
    const observed = seen[0] as { offer: { proposerRosterId: number } };
    assert.equal(observed.offer.proposerRosterId, 2);
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SM-031
test('POST /trades/analyze rejects trade_offer payloads that do not involve the user', async () => {
  const fixture = createSeasonFixture();
  const route = createSeasonTradeAnalyzeRoute({ databasePath: fixture.dbPath, advisor: {
    explainTrade: async () => ({ narrative: null, claudeUnavailable: true }),
    explainWaiver: async () => ({ narrative: null, claudeUnavailable: true }),
  } });

  try {
    const thirdParty = await invokeRoute({
      route,
      params: { league_id: seasonLeagueId },
      body: {
        trade_offer: {
          proposerRosterId: 3,
          responderRosterIds: [4],
          adds: {},
          drops: {},
          draftPicks: [],
        },
      },
    });
    assert.equal(thirdParty.statusCode, 400);

    const malformed = await invokeRoute({
      route,
      params: { league_id: seasonLeagueId },
      body: { trade_offer: { proposerRosterId: 'two' } },
    });
    assert.equal(malformed.statusCode, 400);
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SM-031
test('POST /trades/analyze rejects malformed trade_offer payloads with 400s', async () => {
  const fixture = createSeasonFixture();
  const route = createSeasonTradeAnalyzeRoute({ databasePath: fixture.dbPath, advisor: {
    explainTrade: async () => ({ narrative: null, claudeUnavailable: true }),
    explainWaiver: async () => ({ narrative: null, claudeUnavailable: true }),
  } });

  const base = { proposerRosterId: 2, responderRosterIds: [1], adds: {}, drops: {} };

  try {
    const cases: Array<{ trade_offer: Record<string, unknown> }> = [
      { trade_offer: { ...base, draftPicks: [null] } },
      { trade_offer: { ...base, draftPicks: [{ season: '2027', round: 'one' }] } },
      { trade_offer: { ...base, draftPicks: [{ round: 1 }] } },
      { trade_offer: { ...base, draftPicks: [{ season: '2027', round: 0 }] } },
      { trade_offer: { ...base, draftPicks: [{ season: '2027', round: 1, owner_id: 'one' }] } },
      { trade_offer: { ...base, responderRosterIds: ['one'] } },
      { trade_offer: { ...base, adds: { 's-wr2': 'one' } } },
    ];

    for (const body of cases) {
      const { statusCode } = await invokeRoute({ route, params: { league_id: seasonLeagueId }, body });

      assert.equal(statusCode, 400, `expected 400 for ${JSON.stringify(body.trade_offer)}`);
    }
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SM-060
test('GET /season/:league_id/waivers returns ranked no-drop pairs for the fixture league', async () => {
  const fixture = createSeasonFixture();
  const fixedNow = () => new Date('2026-09-27T12:00:00.000Z');
  const route = createSeasonWaiversRoute({ databasePath: fixture.dbPath, now: fixedNow });

  try {
    const { statusCode, json } = await invokeRoute({ route, params: { league_id: seasonLeagueId } });

    assert.equal(statusCode, 200);
    const payload = json as {
      pairs: { add: { name: string }; drop: unknown; valueDelta: number; score: { rankScore: number } }[];
      lastComputedAt: string;
    };

    // Fixture: 7 non-IR players vs 8 league slots — under the limit, so no drops.
    assert.equal(payload.lastComputedAt, '2026-09-27T12:00:00.000Z');
    assert.ok(payload.pairs.length >= 2);
    assert.ok(payload.pairs.every((pair) => pair.drop === null));
    assert.equal(payload.pairs[0].add.name, 'Free Agent QB');

    const ranks = payload.pairs.map((pair) => pair.score.rankScore);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => b - a));
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SM-061
// @spec DFF-SM-067
test('POST /waivers/analyze re-derives the pair server-side and returns Claude reasoning', async () => {
  const fixture = createSeasonFixture();
  const seen: unknown[] = [];
  const advisor: SeasonAdvisor = {
    explainTrade: async () => ({ narrative: null, claudeUnavailable: true }),
    explainWaiver: async (_context, pair) => {
      seen.push(pair);
      return { narrative: '**Verdict:** Win', claudeUnavailable: false };
    },
  };
  const route = createSeasonWaiverAnalyzeRoute({ databasePath: fixture.dbPath, advisor });

  try {
    const { statusCode, json } = await invokeRoute({
      route,
      params: { league_id: seasonLeagueId },
      body: { add_player_id: 'p-fa2' },
    });

    assert.equal(statusCode, 200);
    const payload = json as {
      add: { id: string; name: string };
      drop: unknown;
      valueDelta: number;
      score: { rankScore: number };
      narrative: string | null;
      claudeUnavailable: boolean;
    };

    assert.equal(payload.add.id, 'p-fa2');
    assert.equal(payload.drop, null);
    assert.ok(payload.valueDelta > 0);
    assert.equal(payload.narrative, '**Verdict:** Win');
    assert.equal(payload.claudeUnavailable, false);

    const pair = seen[0] as { add: { id: string } };
    assert.equal(pair.add.id, 'p-fa2');
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SM-061
test('POST /waivers/analyze rejects fabricated pairs', async () => {
  const fixture = createSeasonFixture();
  const advisor: SeasonAdvisor = {
    explainTrade: async () => ({ narrative: null, claudeUnavailable: true }),
    explainWaiver: async () => ({ narrative: null, claudeUnavailable: true }),
  };
  const route = createSeasonWaiverAnalyzeRoute({ databasePath: fixture.dbPath, advisor });

  try {
    const cases: Array<{ statusCode: number; body: Record<string, unknown> }> = [
      { statusCode: 400, body: {} },
      { statusCode: 400, body: { add_player_id: 5 } },
      { statusCode: 404, body: { add_player_id: 'p-nope' } },
      { statusCode: 404, body: { add_player_id: 'p-qb1' } }, // rostered — not a free agent
      { statusCode: 404, body: { add_player_id: 'p-fa1', drop_player_id: 'p-fa2' } }, // drop not on roster
      { statusCode: 400, body: { add_player_id: 'p-fa1', drop_player_id: 7 } },
    ];

    for (const expected of cases) {
      const { statusCode } = await invokeRoute({
        route,
        params: { league_id: seasonLeagueId },
        body: expected.body,
      });

      assert.equal(statusCode, expected.statusCode, `expected ${expected.statusCode} for ${JSON.stringify(expected.body)}`);
    }
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-DVC-005
test('season overview carries devy claim names with board matches on taxi rows', async () => {
  const fixture = createSeasonFixture({
    devyPlayers: [
      { name: 'Jadan Baugh', position: 'RB', school: 'Florida Gators', draftYear: 2027, value: 6364 },
      { name: "Trey'Dez Green", position: 'WR', school: 'LSU Tigers', draftYear: 2027, value: 4900 },
    ],
    devyClaims: [
      {
        rosterId: 1,
        sleeperPlayerId: 's-devy-1',
        devyName: 'Jadan Baugh',
        placeholderName: 'Kyler Baugh',
        placeholderPosition: 'DL',
      },
    ],
  });

  try {
    const route = createSeasonOverviewRoute({ databasePath: fixture.dbPath });
    const { statusCode, json } = await invokeRoute({ route, params: { league_id: seasonLeagueId } });
    const body = json as { roster: Array<{ name: string; slotType: string; devyName: string | null; devyMatch: Record<string, unknown> | null }> };

    assert.equal(statusCode, 200);
    const claim = body.roster.find((entry) => entry.devyName === 'Jadan Baugh');
    assert.ok(claim, 'expected a roster entry with devyName Jadan Baugh');
    assert.equal(claim.slotType, 'taxi');
    assert.deepEqual(claim.devyMatch, {
      matched: true,
      position: 'RB',
      school: 'Florida Gators',
      draftYear: 2027,
      dynastyValue: 6364,
    });

    // Non-claim rows carry no devy data.
    const regular = body.roster.find((entry) => entry.name === 'Josh Allen');
    assert.ok(regular);
    assert.equal(regular.devyName, null);
    assert.equal(regular.devyMatch, null);
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-DVC-011
test('season overview loads the devy board matcher once for a roster with several claims', async () => {
  const fixture = createSeasonFixture({
    devyPlayers: [
      { name: 'Jadan Baugh', position: 'RB', school: 'Florida Gators', draftYear: 2027, value: 6364 },
      { name: 'Kewan Lacy', position: 'RB', school: 'Ole Miss Rebels', draftYear: 2027, value: 6651 },
    ],
    devyClaims: [
      { rosterId: 1, sleeperPlayerId: 's-devy-1', devyName: 'Jadan Baugh', placeholderName: 'Kyler Baugh', placeholderPosition: 'DL' },
      { rosterId: 1, sleeperPlayerId: 's-devy-2', devyName: 'Kewan Lacy', placeholderName: 'Kavon Frazier', placeholderPosition: 'DB' },
    ],
  });
  const aliasesPath = path.join(os.tmpdir(), `dff-aliases-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(aliasesPath, '[]');
  const readFileSync = mock.method(fs, 'readFileSync');

  try {
    const route = createSeasonOverviewRoute({ databasePath: fixture.dbPath, aliasesPath });
    const { statusCode, json } = await invokeRoute({ route, params: { league_id: seasonLeagueId } });
    const body = json as { roster: Array<{ devyName: string | null; devyMatch: { matched: boolean } | null }> };

    assert.equal(statusCode, 200);
    const claims = body.roster.filter((entry) => entry.devyName !== null);
    assert.equal(claims.length, 2);
    assert.ok(claims.every((entry) => entry.devyMatch?.matched));

    const aliasReads = readFileSync.mock.calls.filter((call) => call.arguments[0] === aliasesPath);
    assert.equal(aliasReads.length, 1);
  } finally {
    readFileSync.mock.restore();
    fs.rmSync(aliasesPath, { force: true });
    fixture.cleanup();
  }
});

// @spec DFF-DVC-003
// @spec DFF-DVC-004
// @spec DFF-DVC-006
// @spec DFF-DVC-012
test('devy claims route returns league claims, unmatched claims, and the unclaimed board', async () => {
  const fixture = createSeasonFixture({
    devyPlayers: [
      { name: 'Jadan Baugh', position: 'RB', school: 'Florida Gators', draftYear: 2027, value: 6364 },
      { name: 'Kewan Lacy', position: 'RB', school: 'Ole Miss Rebels', draftYear: 2027, value: 6651 },
      { name: "Trey'Dez Green", position: 'WR', school: 'LSU Tigers', draftYear: 2027, value: 4900 },
    ],
    devyClaims: [
      {
        rosterId: 1,
        sleeperPlayerId: 's-devy-1',
        devyName: 'Jadan Baugh',
        placeholderName: 'Kyler Baugh',
        placeholderPosition: 'DL',
      },
      {
        rosterId: 2,
        sleeperPlayerId: 's-devy-2',
        devyName: 'Tristen Keys',
        placeholderName: 'Kavon Frazier',
        placeholderPosition: 'DB',
      },
    ],
  });

  try {
    const route = createSeasonDevyClaimsRoute({ databasePath: fixture.dbPath });
    const { statusCode, json } = await invokeRoute({ route, params: { league_id: seasonLeagueId } });
    const body = json as {
      season: string;
      claims: Array<{ rosterId: number; sleeperPlayerId: string; teamName: string; devyName: string; devyMatch: Record<string, unknown> }>;
      available: Array<{ name: string; dynastyValue: number }>;
    };

    assert.equal(statusCode, 200);
    assert.equal(body.season, '2026');
    assert.equal(body.claims.length, 2);

    const baugh = body.claims.find((claim) => claim.devyName === 'Jadan Baugh');
    assert.ok(baugh);
    assert.equal(baugh.rosterId, 1);
    assert.equal(baugh.sleeperPlayerId, 's-devy-1');
    assert.equal(baugh.teamName, 'Trev Squad');
    assert.equal(baugh.devyMatch.matched, true);

    // A claim absent from the devy board is returned unmatched, not dropped.
    const keys = body.claims.find((claim) => claim.devyName === 'Tristen Keys');
    assert.ok(keys);
    assert.deepEqual(keys.devyMatch, {
      matched: false,
      position: null,
      school: null,
      draftYear: null,
      dynastyValue: null,
    });

    // Claimed names are excluded from the available board; value-ranked.
    assert.equal(body.available.some((row) => row.name === 'Jadan Baugh'), false);
    assert.deepEqual(
      body.available.map((row) => row.name),
      ['Kewan Lacy', "Trey'Dez Green"],
    );
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-DVC-003
test('devy claim matching normalizes quote variants in claim and board names', async () => {
  const fixture = createSeasonFixture({
    devyPlayers: [
      { name: "Trey'Dez Green", position: 'WR', school: 'LSU Tigers', draftYear: 2027, value: 4900 },
    ],
    devyClaims: [
      {
        rosterId: 1,
        sleeperPlayerId: 's-devy-1',
        devyName: 'Trey’Dez Green',
        placeholderName: 'Mike Green',
        placeholderPosition: 'DL',
      },
    ],
  });

  try {
    const route = createSeasonDevyClaimsRoute({ databasePath: fixture.dbPath });
    const { statusCode, json } = await invokeRoute({ route, params: { league_id: seasonLeagueId } });
    const body = json as { claims: Array<{ devyMatch: { matched: boolean; dynastyValue: number | null } }> };

    assert.equal(statusCode, 200);
    assert.equal(body.claims.length, 1);
    assert.equal(body.claims[0].devyMatch.matched, true);
    assert.equal(body.claims[0].devyMatch.dynastyValue, 4900);
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-DVC-007
test('devy claims route returns no claims and the full board for a synced league without claims', async () => {
  const fixture = createSeasonFixture({
    devyPlayers: [
      { name: 'Jadan Baugh', position: 'RB', school: 'Florida Gators', draftYear: 2027, value: 6364 },
      { name: 'Kewan Lacy', position: 'RB', school: 'Ole Miss Rebels', draftYear: 2027, value: 6651 },
    ],
  });

  try {
    const route = createSeasonDevyClaimsRoute({ databasePath: fixture.dbPath });
    const { statusCode, json } = await invokeRoute({ route, params: { league_id: seasonLeagueId } });
    const body = json as { claims: unknown[]; available: Array<{ name: string }> };

    assert.equal(statusCode, 200);
    assert.deepEqual(body.claims, []);
    assert.deepEqual(
      body.available.map((row) => row.name),
      ['Kewan Lacy', 'Jadan Baugh'],
    );
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-DVC-007
test('devy claims route returns the shared context error for an unsynced league', async () => {
  const fixture = createSeasonFixture();

  try {
    const route = createSeasonDevyClaimsRoute({ databasePath: fixture.dbPath });
    const { statusCode, json } = await invokeRoute({ route, params: { league_id: 'unknown-league' } });

    assert.equal(statusCode, 404);
    assert.equal((json as { code: string }).code, 'NOT_FOUND');
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-DVC-003 — the board itself can store a non-canonical alias; the claim on the
// canonical name must still match, and the claimed name must still be excluded from
// available. Uses a temporary aliases file instead of the repo-wide one.
test('devy claim matching resolves through alias families in both directions', async () => {
  const aliasDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-aliases-'));
  const aliasesPath = path.join(aliasDir, 'aliases.json');
  fs.writeFileSync(
    aliasesPath,
    JSON.stringify({ aliases: [{ canonical: 'Ryan Williams', variants: ['Ray Ray Williams'] }] }),
  );

  const fixture = createSeasonFixture({
    devyPlayers: [
      // The board stores the NON-canonical variant.
      { name: 'Ray Ray Williams', position: 'WR', school: 'Alabama Crimson Tide', draftYear: 2027, value: 5000 },
    ],
    devyClaims: [
      {
        rosterId: 1,
        sleeperPlayerId: 's-devy-1',
        devyName: 'Ryan Williams',
        placeholderName: 'C.J. Williams',
        placeholderPosition: 'WR',
      },
    ],
  });

  try {
    const route = createSeasonDevyClaimsRoute({ databasePath: fixture.dbPath, aliasesPath });
    const { statusCode, json } = await invokeRoute({ route, params: { league_id: seasonLeagueId } });
    const body = json as {
      claims: Array<{ devyMatch: { matched: boolean; dynastyValue: number | null } }>;
      available: Array<{ name: string }>;
    };

    assert.equal(statusCode, 200);
    assert.equal(body.claims.length, 1);
    assert.equal(body.claims[0].devyMatch.matched, true);
    assert.equal(body.claims[0].devyMatch.dynastyValue, 5000);

    // The claimed variant is excluded from available even though the claim used the canonical name.
    assert.equal(body.available.some((row) => row.name === 'Ray Ray Williams'), false);
  } finally {
    fixture.cleanup();
    fs.rmSync(aliasDir, { recursive: true, force: true });
  }
});

// @spec DFF-DVC-004
test('season overview leaves claims unmatched without crashing on an empty devy board', async () => {
  const fixture = createSeasonFixture({
    devyPlayers: [],
    devyClaims: [
      {
        rosterId: 1,
        sleeperPlayerId: 's-devy-1',
        devyName: 'Jadan Baugh',
        placeholderName: 'Kyler Baugh',
        placeholderPosition: 'DL',
      },
    ],
  });

  try {
    const route = createSeasonOverviewRoute({ databasePath: fixture.dbPath });
    const { statusCode, json } = await invokeRoute({ route, params: { league_id: seasonLeagueId } });
    const body = json as {
      roster: Array<{ devyName: string | null; devyMatch: Record<string, unknown> | null }>;
    };

    assert.equal(statusCode, 200);
    const claim = body.roster.find((entry) => entry.devyName === 'Jadan Baugh');
    assert.ok(claim);
    assert.deepEqual(claim.devyMatch, {
      matched: false,
      position: null,
      school: null,
      draftYear: null,
      dynastyValue: null,
    });
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-DVC-006
test('two teams claiming the same devy name both surface and the name leaves the available board', async () => {
  const fixture = createSeasonFixture({
    devyPlayers: [
      { name: 'Jadan Baugh', position: 'RB', school: 'Florida Gators', draftYear: 2027, value: 6364 },
    ],
    devyClaims: [
      {
        rosterId: 1,
        sleeperPlayerId: 's-devy-1',
        devyName: 'Jadan Baugh',
        placeholderName: 'Kyler Baugh',
        placeholderPosition: 'DL',
      },
      {
        rosterId: 2,
        sleeperPlayerId: 's-devy-2',
        devyName: 'Jadan Baugh',
        placeholderName: 'Eric Wilson',
        placeholderPosition: 'LB',
      },
    ],
  });

  try {
    const route = createSeasonDevyClaimsRoute({ databasePath: fixture.dbPath });
    const { statusCode, json } = await invokeRoute({ route, params: { league_id: seasonLeagueId } });
    const body = json as {
      claims: Array<{ rosterId: number; devyName: string }>;
      available: Array<{ name: string }>;
    };

    assert.equal(statusCode, 200);
    assert.equal(body.claims.length, 2);
    assert.deepEqual(
      body.claims.map((claim) => claim.rosterId).sort(),
      [1, 2],
    );
    assert.equal(body.available.length, 0);
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-DVR-001
// @spec DFF-DVR-003
test('devy ownership route maps claimed board rows to team names by player id', async () => {
  const fixture = createSeasonFixture({
    devyPlayers: [
      { name: 'Jadan Baugh', position: 'RB', school: 'Florida Gators', draftYear: 2027, value: 6364 },
      { name: 'Kewan Lacy', position: 'RB', school: 'Ole Miss Rebels', draftYear: 2027, value: 6651 },
    ],
    devyClaims: [
      {
        rosterId: 1,
        sleeperPlayerId: 's-devy-1',
        devyName: 'Jadan Baugh',
        placeholderName: 'Kyler Baugh',
        placeholderPosition: 'DL',
      },
      {
        rosterId: 2,
        sleeperPlayerId: 's-devy-2',
        devyName: 'Tristen Keys',
        placeholderName: 'Kavon Frazier',
        placeholderPosition: 'DB',
      },
    ],
  });

  try {
    const route = createSeasonDevyOwnershipRoute({ databasePath: fixture.dbPath });
    const { statusCode, json } = await invokeRoute({ route, params: { league_id: seasonLeagueId } });
    const body = json as { ownership: Record<string, string> };

    assert.equal(statusCode, 200);
    // Only board-matched claims appear; 'Tristen Keys' is not on the board.
    assert.deepEqual(body.ownership, { 'devy-1': 'Trev Squad' });
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-DVR-001
// @spec DFF-DVR-002
test('devy ownership route resolves quote variants and breaks team ties deterministically', async () => {
  const fixture = createSeasonFixture({
    devyPlayers: [
      { name: "Trey'Dez Green", position: 'WR', school: 'LSU Tigers', draftYear: 2027, value: 4900 },
    ],
    devyClaims: [
      {
        rosterId: 2,
        sleeperPlayerId: 's-devy-1',
        devyName: 'Trey’Dez Green', // curly-quote variant of the board name
        placeholderName: 'Mike Green',
        placeholderPosition: 'DL',
      },
      {
        rosterId: 1,
        sleeperPlayerId: 's-devy-2',
        devyName: 'TreyDez Green', // stripped-quote variant, claimed by two teams
        placeholderName: 'Ace Green',
        placeholderPosition: 'DL',
      },
    ],
  });

  try {
    const route = createSeasonDevyOwnershipRoute({ databasePath: fixture.dbPath });
    const { statusCode, json } = await invokeRoute({ route, params: { league_id: seasonLeagueId } });
    const body = json as { ownership: Record<string, string> };

    assert.equal(statusCode, 200);
    // 'Rival Squad' < 'Trev Squad' lexicographically.
    assert.deepEqual(body.ownership, { 'devy-1': 'Rival Squad' });
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-DVR-003
test('devy ownership route returns an empty mapping for a league without claims and 404 for unknown leagues', async () => {
  const fixture = createSeasonFixture();

  try {
    const route = createSeasonDevyOwnershipRoute({ databasePath: fixture.dbPath });
    const empty = await invokeRoute({ route, params: { league_id: seasonLeagueId } });
    assert.equal(empty.statusCode, 200);
    assert.deepEqual((empty.json as { ownership: Record<string, string> }).ownership, {});

    const unknown = await invokeRoute({ route, params: { league_id: 'other' } });
    assert.equal(unknown.statusCode, 404);
  } finally {
    fixture.cleanup();
  }
});
