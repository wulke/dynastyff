// @spec DFF-SM-060
// @spec DFF-SM-062
// @spec DFF-SM-063
// @spec DFF-SM-064
// @spec DFF-SM-065
// @spec DFF-SM-066
import test from 'node:test';
import assert from 'node:assert/strict';

import type { LeagueContext, PlayerWithValue, RosterEntry, TeamRoster } from '../src/season/context.js';
import { scoreWaiverPairs } from '../src/season/waiverScorer.js';

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

// Roster positions QB/RB/RB/WR/WR/TE/BN = 7 slots. User has exactly 7 non-IR players,
// so the roster is over its limit and every add needs a drop.
function userTeamFull(): TeamRoster {
  return team(1, [
    entry('q1', 'User QB', 'QB', 28, 3000),
    entry('q9', 'Aging Bench QB', 'QB', 31, 1200, 'bench'),
    entry('r1', 'User RB', 'RB', 25, 1500),
    entry('w1', 'User WR1', 'WR', 24, 6000),
    entry('w2', 'User WR2', 'WR', 25, 5000),
    entry('w3', 'Bench WR', 'WR', 23, 2600, 'bench'),
    entry('t1', 'User TE', 'TE', 27, 1000),
  ]);
}

function fillerTeams(): TeamRoster[] {
  return [
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

function freeAgent(id: string, name: string, position: string, age: number, dynastyValue: number): PlayerWithValue {
  return { id, name, position, age, dynastyValue };
}

function buildContext(overrides: Partial<LeagueContext> = {}): LeagueContext {
  const allRosters = overrides.allRosters ?? [userTeamFull(), ...fillerTeams()];

  return {
    league: {
      leagueId: 'L1',
      name: 'Waiver League',
      season: '2026',
      totalRosters: allRosters.length,
      status: 'in_season',
      rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'BN'],
      scoringSettings: {},
      syncedAt: '2026-09-27T00:00:00.000Z',
    },
    userRosterId: 1,
    userRoster: allRosters[0].players,
    allRosters,
    freeAgents: [],
    pendingOffers: [],
    leagueMedians: {},
    pickValues: {},
    tradedPicks: [],
    lastSyncedAt: '2026-09-27T00:00:00.000Z',
    ...overrides,
  };
}

// @spec DFF-SM-062
// @spec DFF-SM-063
// @spec DFF-SM-064
// @spec DFF-SM-065
test('full rosters pair each add with the lowest-value bench player at the position', () => {
  const context = buildContext({
    freeAgents: [
      freeAgent('fa-qb', 'Wire QB', 'QB', 23, 1500),
      freeAgent('fa-wr-hot', 'Hot Wire WR', 'WR', 24, 2800),
      freeAgent('fa-wr-cold', 'Cold Wire WR', 'WR', 23, 1000),
      freeAgent('fa-te', 'Wire TE', 'TE', 25, 500),
      freeAgent('fa-rb', 'Wire RB', 'RB', 24, 3000),
      freeAgent('fa-k', 'Wire Kicker', 'K', 28, 900),
    ],
  });

  const { pairs } = scoreWaiverPairs(context);

  // The QB pair (drop q9) outranks the WR pair (drop w3): bigger value delta plus a need bump.
  assert.deepEqual(
    pairs.map((pair) => pair.add.id),
    ['fa-qb', 'fa-wr-hot'],
  );

  const [qbPair, wrPair] = pairs;

  assert.equal(qbPair.drop?.name, 'Aging Bench QB');
  assert.equal(qbPair.valueDelta, 300);
  assert.equal(qbPair.score.ageCurve, 1, 'adding a 23-year-old for a 31-year-old is a win');

  assert.equal(wrPair.drop?.name, 'Bench WR');
  assert.equal(wrPair.valueDelta, 200);
  assert.equal(wrPair.score.ageCurve, -1, 'adding a 24-year-old for a 23-year-old is a wash against you');

  // Ranked descending by combined value delta + positional need.
  assert.ok(qbPair.score.rankScore >= wrPair.score.rankScore);
  assert.ok(pairs.every((pair) => pair.score.rankScore > 0 || pair.score.positionalNeedScore > 0));
});

// @spec DFF-SM-065
test('pairs without a positive value delta or an eligible drop are filtered out', () => {
  const context = buildContext({
    freeAgents: [
      freeAgent('fa-wr-cold', 'Cold Wire WR', 'WR', 23, 1000), // delta -1600
      freeAgent('fa-te', 'Wire TE', 'TE', 25, 500), // no bench TE to drop
      freeAgent('fa-rb', 'Wire RB', 'RB', 24, 3000), // no bench RB to drop
      freeAgent('fa-k', 'Wire Kicker', 'K', 28, 900), // K is not graded
    ],
  });

  const { pairs } = scoreWaiverPairs(context);

  assert.equal(pairs.length, 0);
});

// @spec DFF-SM-066
test('at most five pairs per position group survive, ranked descending', () => {
  const context = buildContext({
    freeAgents: [2700, 3200, 2800, 3100, 2900, 3000].map((value, index) =>
      freeAgent(`fa-wr-${index}`, `Wire WR ${value}`, 'WR', 24, value),
    ),
  });

  const { pairs } = scoreWaiverPairs(context);

  assert.equal(pairs.length, 5);
  assert.ok(pairs.every((pair) => pair.drop?.name === 'Bench WR'));

  const deltas = pairs.map((pair) => pair.valueDelta);

  assert.deepEqual(deltas, [...deltas].sort((a, b) => b - a));
  assert.ok(deltas.includes(600), 'the 3200-value free agent (delta 600) must survive');
  assert.ok(!deltas.includes(100), 'the 2700-value free agent (delta 100) must be cut');
});

// @spec DFF-SM-063
test('rosters under the limit require no drop', () => {
  const underLimit = userTeamFull();
  underLimit.players = underLimit.players.filter((player) => player.sleeperPlayerId !== 'w3');

  const context = buildContext({
    allRosters: [underLimit, ...fillerTeams()],
    freeAgents: [
      freeAgent('fa-rb', 'Wire RB', 'RB', 24, 3000),
      freeAgent('fa-te', 'Wire TE', 'TE', 25, 500),
    ],
  });

  const { pairs } = scoreWaiverPairs(context);

  assert.equal(pairs.length, 2);
  assert.ok(pairs.every((pair) => pair.drop === null));
  assert.deepEqual(
    pairs.map((pair) => pair.valueDelta),
    [3000, 500],
  );
});
