// @spec DFF-SM-050
// @spec DFF-SM-051
// @spec DFF-SM-052
// @spec DFF-SM-053
// @spec DFF-SM-054
// @spec DFF-SM-055
// @spec DFF-SM-088
import test from 'node:test';
import assert from 'node:assert/strict';

import type { LeagueContext, RosterEntry, TeamRoster } from '../src/season/context.js';
import { recommendTrades } from '../src/season/tradeRecommender.js';

function entry(
  sleeperPlayerId: string,
  name: string,
  position: string,
  age: number,
  dynastyValue: number,
  slotType: RosterEntry['slotType'] = 'starter',
): RosterEntry {
  return {
    sleeperPlayerId,
    playersId: `id-${sleeperPlayerId}`,
    name,
    position,
    age,
    dynastyValue,
    slotType,
    matched: true,
  };
}

function team(rosterId: number, players: RosterEntry[]): TeamRoster {
  return { rosterId, displayName: `Team ${rosterId}`, teamName: null, wins: 5, losses: 5, ties: 0, players };
}

// Fixture geometry (hand-computed, roster positions QB/RB/RB/WR/WR/TE/BN):
// - User (1): WR grade A with huge bench depth (surplus), QB grade B with bench depth (surplus),
//   RB grade F (need), aging bench QB q9 (31y) for value sells.
// - Team 2: RB grade A with bench depth (surplus), WR grade F and QB grade C (needs).
// - Team 3: weak WR and QB (needs, grade C or below), no surplus.
// - Team 4: WR grade B with bench depth (surplus), QB grade F (need), no pick-defying trades.
function baseTeams(): TeamRoster[] {
  return [
    team(1, [
      entry('q1', 'User QB', 'QB', 28, 3000),
      entry('q9', 'Aging QB', 'QB', 31, 1200, 'bench'),
      entry('r1', 'User RB', 'RB', 25, 1500),
      entry('w1', 'User WR1', 'WR', 24, 6000),
      entry('w2', 'User WR2', 'WR', 25, 5000),
      entry('w3', 'User Bench WR', 'WR', 23, 2600, 'bench'),
      entry('t1', 'User TE', 'TE', 27, 1000),
    ]),
    team(2, [
      entry('qb2', 'Rival QB', 'QB', 28, 2500),
      entry('rb2a', 'Rival RB1', 'RB', 24, 5500),
      entry('rb2b', 'Rival RB2', 'RB', 26, 3000),
      entry('rb2c', 'Rival Bench RB', 'RB', 25, 2400, 'bench'),
      entry('wr2a', 'Rival WR1', 'WR', 26, 1800),
      entry('wr2b', 'Rival WR2', 'WR', 27, 1500),
      entry('te2', 'Rival TE', 'TE', 29, 900),
    ]),
    team(3, [
      entry('qb3', 'Third QB', 'QB', 28, 2600),
      entry('rb3a', 'Third RB1', 'RB', 25, 3500),
      entry('rb3b', 'Third RB2', 'RB', 27, 2000),
      entry('wr3a', 'Third WR1', 'WR', 26, 1700),
      entry('wr3b', 'Third WR2', 'WR', 28, 1400),
      entry('te3', 'Third TE', 'TE', 28, 950),
    ]),
    team(4, [
      entry('qb4', 'Fourth QB', 'QB', 30, 1600),
      entry('rb4a', 'Fourth RB1', 'RB', 25, 3600),
      entry('rb4b', 'Fourth RB2', 'RB', 27, 2100),
      entry('wr4a', 'Fourth WR1', 'WR', 24, 5000),
      entry('wr4b', 'Fourth WR2', 'WR', 26, 2200),
      entry('wr4c', 'Fourth Bench WR', 'WR', 25, 900, 'bench'),
      entry('te4', 'Fourth TE', 'TE', 27, 1000),
    ]),
  ];
}

function buildContext(overrides: Partial<LeagueContext> = {}): LeagueContext {
  const allRosters = overrides.allRosters ?? baseTeams();
  const userRosterId = overrides.userRosterId ?? 1;

  return {
    league: {
      leagueId: 'L1',
      name: 'Rec League',
      season: '2026',
      totalRosters: allRosters.length,
      status: 'in_season',
      rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'BN'],
      scoringSettings: {},
      syncedAt: '2026-09-27T00:00:00.000Z',
    },
    userRosterId,
    userRoster: allRosters.find((candidate) => candidate.rosterId === userRosterId)?.players ?? [],
    allRosters,
    freeAgents: [],
    pendingOffers: [],
    leagueMedians: {},
    pickValues: {
      '2027:1': 3000,
      '2027:2': 1200,
      '2027:3': 600,
      '2027:4': 300,
      '2028:1': 2500,
      '2028:2': 1000,
      '2028:3': 500,
      '2028:4': 250,
    },
    tradedPicks: [],
    lastSyncedAt: '2026-09-27T00:00:00.000Z',
    ...overrides,
  };
}

// @spec DFF-SM-051
// @spec DFF-SM-052
// @spec DFF-SM-054
test('candidates pair user surplus with counterparty needs and group by the addressed need', () => {
  const recommendations = recommendTrades(buildContext());

  // User surplus: WR (grade A, bench depth 2600 > median 450) and QB (grade B, bench 1200 > 0).
  // Team 2 surplus: RB. So the only player swap is WR→RB against team 2.
  const rb = recommendations.groups.rb.candidates;

  assert.equal(rb.length, 1);
  assert.equal(rb[0].teamRosterId, 2);
  assert.equal(rb[0].teamName, 'Team 2');
  assert.match(rb[0].rationale, /surplus WR/);

  // Outbound: most valuable non-starter WR (w3). Inbound: non-starter RB closest in value (rb2c).
  assert.deepEqual(
    rb[0].score.assetsOut.map((asset) => asset.label),
    ['User Bench WR'],
  );
  assert.deepEqual(
    rb[0].score.assetsIn.map((asset) => asset.label),
    ['Rival Bench RB'],
  );

  // No team has surplus at a position the user needs besides RB; WR/QB/TE target groups stay empty.
  assert.equal(recommendations.groups.wr.candidates.length, 0);
  assert.equal(recommendations.groups.qb.candidates.length, 0);
  assert.equal(recommendations.groups.te.candidates.length, 0);
});

// @spec DFF-SM-088
test('pick acquisitions convert surplus depth into the counterparty best future pick', () => {
  const recommendations = recommendTrades(buildContext());

  const picks = recommendations.groups.picks.candidates;
  const counterparties = picks.map((candidate) => candidate.teamRosterId).sort();

  // Teams 2, 3, and 4 all need WR (grade C or below).
  assert.deepEqual(counterparties, [2, 3, 4]);

  for (const candidate of picks) {
    assert.deepEqual(
      candidate.score.assetsOut.map((asset) => asset.label),
      ['User Bench WR'],
    );
    assert.deepEqual(
      candidate.score.assetsIn.map((asset) => asset.label),
      ['2027 Round 1'],
    );
  }
});

// @spec DFF-SM-088
test('value sells ship the aging asset (30+) and cap each group at three candidates', () => {
  const recommendations = recommendTrades(buildContext());
  const sell = recommendations.groups.sell.candidates;

  // Five aging-QB candidates exist (player swap + best pick against each QB-needy team);
  // only the top three by composite survive (DFF-SM-055).
  assert.ok(sell.length <= 3, `expected at most 3 sell candidates, got ${sell.length}`);

  const outbound = sell.map((candidate) => candidate.score.assetsOut.map((asset) => asset.label).join(','));

  assert.ok(outbound.length > 0);
  assert.ok(outbound.every((label) => label === 'Aging QB'), 'sell candidates must ship the 31-year-old QB');

  const composites = sell.map((candidate) => candidate.score.compositeScore);
  assert.deepEqual(composites, [...composites].sort((a, b) => b - a));
});

// @spec DFF-SM-053
test('only candidates with a positive composite are surfaced', () => {
  for (const group of Object.values(recommendTrades(buildContext()).groups)) {
    for (const candidate of group.candidates) {
      assert.ok(
        candidate.score.compositeScore > 0,
        `candidate vs ${candidate.teamName} must have a positive composite`,
      );
    }
  }
});

// @spec DFF-SM-088
test('hypothetical offers carry synthetic IDs and direction-correct legs', () => {
  const recommendations = recommendTrades(buildContext());
  const candidates = Object.values(recommendations.groups).flatMap((group) => group.candidates);

  // Asset labels → the Sleeper player IDs the offer legs must be keyed by.
  const sleeperId: Record<string, string> = {
    'User Bench WR': 'w3',
    'Aging QB': 'q9',
    'Rival Bench RB': 'rb2c',
  };

  assert.ok(candidates.length > 0);

  for (const candidate of candidates) {
    const offer = candidate.offer;

    assert.ok(offer.transactionId < 0, 'synthetic transaction IDs must be negative');
    assert.equal(offer.proposerRosterId, candidate.teamRosterId);
    assert.deepEqual(offer.responderRosterIds, [1]);
    assert.equal(offer.status, 'hypothetical');

    for (const asset of candidate.score.assetsOut) {
      assert.equal(offer.adds[sleeperId[asset.label]], candidate.teamRosterId);
      assert.equal(offer.drops[sleeperId[asset.label]], 1);
    }

    for (const asset of candidate.score.assetsIn) {
      if (asset.kind === 'player') {
        assert.equal(offer.adds[sleeperId[asset.label]], 1);
        assert.equal(offer.drops[sleeperId[asset.label]], candidate.teamRosterId);
      } else {
        const pick = offer.draftPicks[0] as { owner_id: number; previous_owner_id: number };

        assert.equal(pick.owner_id, 1);
        assert.equal(pick.previous_owner_id, candidate.teamRosterId);
      }
    }
  }
});

// @spec DFF-SM-050
test('a league with no exploitable imbalances yields empty groups', () => {
  const balanced = buildContext({
    allRosters: [
      team(1, [
        entry('q1', 'User QB', 'QB', 27, 3000),
        entry('r1', 'User RB', 'RB', 25, 3000),
        entry('w1', 'User WR', 'WR', 25, 3000),
        entry('t1', 'User TE', 'TE', 26, 1000),
      ]),
      team(2, [
        entry('q2', 'Rival QB', 'QB', 27, 3000),
        entry('r2', 'Rival RB', 'RB', 25, 3000),
        entry('w2', 'Rival WR', 'WR', 25, 3000),
        entry('t2', 'Rival TE', 'TE', 26, 1000),
      ]),
    ],
  });

  const recommendations = recommendTrades(balanced);

  for (const group of Object.values(recommendations.groups)) {
    assert.equal(group.candidates.length, 0);
  }
});
