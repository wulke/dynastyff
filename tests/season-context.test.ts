// @spec DFF-SM-070
// @spec DFF-SM-071
// @spec DFF-SM-080
// @spec DFF-SM-083
import test from 'node:test';
import assert from 'node:assert/strict';

import { assembleLeagueContext, LeagueContextError } from '../src/season/context.js';
import { createSeasonFixture, seasonLeagueId } from './season-fixture.js';

// @spec DFF-SM-070
test('assembleLeagueContext assembles league, rosters, free agents, offers, and medians', () => {
  const fixture = createSeasonFixture();

  try {
    const context = assembleLeagueContext(fixture.db, seasonLeagueId);

    assert.equal(context.league.leagueId, seasonLeagueId);
    assert.equal(context.league.name, 'Season Fixture League');
    assert.deepEqual(context.league.rosterPositions, ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN']);
    assert.deepEqual(context.league.scoringSettings, { pass_td: 4 });

    assert.equal(context.userRosterId, 1);
    assert.equal(context.allRosters.length, 4);

    const userTeam = context.allRosters.find((team) => team.rosterId === 1);
    assert.ok(userTeam);
    assert.equal(userTeam.players.length, 8);
    assert.equal(userTeam.displayName, 'Trev');

    const jefferson = userTeam.players.find((entry) => entry.playersId === 'p-wr1');
    assert.ok(jefferson);
    assert.equal(jefferson.name, 'Justin Jefferson');
    assert.equal(jefferson.dynastyValue, 6100);
    assert.equal(jefferson.slotType, 'starter');
    assert.equal(jefferson.matched, true);

    const freeAgentIds = context.freeAgents.map((player) => player.id);
    assert.ok(freeAgentIds.includes('p-fa1'));
    assert.ok(freeAgentIds.includes('p-fa2'));
    assert.ok(!freeAgentIds.includes('p-qb1'));
    assert.ok(!freeAgentIds.includes('p-taxi'));
    assert.deepEqual(
      context.freeAgents.map((player) => player.dynastyValue),
      [...context.freeAgents.map((player) => player.dynastyValue)].sort((a, b) => b - a),
    );

    assert.equal(context.pendingOffers.length, 1);
    assert.equal(context.pendingOffers[0].transactionId, 555);
    assert.equal(context.pendingOffers[0].proposerRosterId, 2);
    assert.deepEqual(context.pendingOffers[0].responderRosterIds, [1]);
    assert.deepEqual(context.pendingOffers[0].adds, { 's-p2-qb': 1 });

    // WR totals: 9500, 3300, 0, 0 → median 1650; QB totals: 6500, 3800, 2900, 0 → median 3350.
    assert.equal(context.leagueMedians.WR, 1650);
    assert.equal(context.leagueMedians.QB, 3350);

    assert.equal(context.lastSyncedAt, '2026-09-27T11:30:00.000Z');
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SM-080
test('unmatched Sleeper players keep Sleeper metadata and score zero value', () => {
  const fixture = createSeasonFixture();

  try {
    const context = assembleLeagueContext(fixture.db, seasonLeagueId);
    const unmatched = context.userRoster.find((entry) => entry.sleeperPlayerId === 's-unmatched');

    assert.ok(unmatched);
    assert.equal(unmatched.matched, false);
    assert.equal(unmatched.playersId, null);
    assert.equal(unmatched.name, 'Rookie Unknown');
    assert.equal(unmatched.position, 'QB');
    assert.equal(unmatched.dynastyValue, 0);
    assert.equal(unmatched.slotType, 'bench');
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SM-071
test('assembleLeagueContext assembles fresh objects on every call', () => {
  const fixture = createSeasonFixture();

  try {
    const first = assembleLeagueContext(fixture.db, seasonLeagueId);
    const second = assembleLeagueContext(fixture.db, seasonLeagueId);

    assert.notEqual(first, second);
    assert.notEqual(first.allRosters, second.allRosters);
    assert.notEqual(first.userRoster, second.userRoster);
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SM-083
test('fewer than 4 synced teams raises an insufficient-data error', () => {
  const fixture = createSeasonFixture({ teamCount: 3 });

  try {
    assert.throws(
      () => assembleLeagueContext(fixture.db, seasonLeagueId),
      (error: unknown) =>
        error instanceof LeagueContextError && error.code === 'INSUFFICIENT_DATA' && error.statusCode === 422,
    );
  } finally {
    fixture.cleanup();
  }
});

test('unknown leagues and missing connections raise mapped errors', () => {
  const fixture = createSeasonFixture();

  try {
    assert.throws(
      () => assembleLeagueContext(fixture.db, 'nope'),
      (error: unknown) => error instanceof LeagueContextError && error.code === 'NOT_FOUND' && error.statusCode === 404,
    );

    fixture.db.prepare('DELETE FROM sleeper_connections').run();

    assert.throws(
      () => assembleLeagueContext(fixture.db, seasonLeagueId),
      (error: unknown) => error instanceof LeagueContextError && error.code === 'NOT_CONNECTED' && error.statusCode === 404,
    );
  } finally {
    fixture.cleanup();
  }
});
