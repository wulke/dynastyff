// @spec DFF-UI-194
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';

import { createSleeperLeagueImportRoute } from '../src/server/app.js';
import { mapSleeperLeagueSettings } from '../src/server/sleeper-config-import.js';

// @spec DFF-UI-193
// @spec DFF-UI-195
async function invokeSleeperLeagueImportRoute(
  leagueId: string,
  fetchImpl: typeof fetch,
): Promise<{ statusCode: number; json: unknown }> {
  const route = createSleeperLeagueImportRoute({ fetchImpl });
  let statusCode = 200;
  let json: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      json = body;
      return this;
    },
  } as Response;

  await route({ params: { leagueId } } as Request, response, () => undefined);

  return { statusCode, json };
}

// @spec DFF-UI-194
test('maps Sleeper scoring, TE premium, supported roster slots, and team count while ignoring draft_rounds', () => {
  const prefill = mapSleeperLeagueSettings({
    num_teams: 10,
    draft_rounds: 3,
    scoring_settings: {
      rec: 0.5,
      bonus_rec_te: 0.5,
    },
    roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN', 'BN', 'BN', 'IR', 'K'],
  });

  assert.deepEqual(prefill, {
    teamCount: 10,
    scoringFormat: 'half_ppr',
    tePremiumTier: 'tep',
    rosterConfig: {
      QB: 1,
      RB: 2,
      WR: 3,
      TE: 1,
      FLEX: 1,
      SF: 1,
      bench: 3,
    },
  });
  assert.equal('rounds' in prefill, false);
});

// @spec DFF-UI-193
// @spec DFF-UI-194
test('returns a normalized prefill through the Sleeper import route using its injected fetch implementation', async () => {
  const requestedUrls: string[] = [];
  const result = await invokeSleeperLeagueImportRoute('123456789012345678', async (input) => {
    requestedUrls.push(String(input));
    return new Response(JSON.stringify({
      num_teams: 12,
      draft_rounds: 3,
      scoring_settings: { rec: 1, bonus_rec_te: 1 },
      roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN', 'BN'],
    }), { status: 200 });
  });

  assert.deepEqual(requestedUrls, ['https://api.sleeper.app/v1/league/123456789012345678']);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.json, {
    teamCount: 12,
    scoringFormat: 'ppr',
    tePremiumTier: 'tepp',
    rosterConfig: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, SF: 1, bench: 2 },
  });
});

// @spec DFF-UI-195
test('rejects an invalid Sleeper league ID without calling the upstream API', async () => {
  let fetchWasCalled = false;
  const result = await invokeSleeperLeagueImportRoute('not-a-league-id', async () => {
    fetchWasCalled = true;
    return new Response('{}', { status: 200 });
  });

  assert.equal(fetchWasCalled, false);
  assert.equal(result.statusCode, 400);
  assert.deepEqual(result.json, { error: 'Enter a valid Sleeper league ID or URL.' });
});

// @spec DFF-UI-195
test('returns a generic import failure when Sleeper rejects the league or returns malformed settings', async () => {
  const notFound = await invokeSleeperLeagueImportRoute('123456789012345678', async () =>
    new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }),
  );
  const malformed = await invokeSleeperLeagueImportRoute('123456789012345678', async () =>
    new Response(JSON.stringify({ num_teams: 12 }), { status: 200 }),
  );

  const expected = { error: 'Could not import Sleeper league settings. Check the league ID and try again.' };
  assert.deepEqual(notFound, { statusCode: 502, json: expected });
  assert.deepEqual(malformed, { statusCode: 502, json: expected });
});
