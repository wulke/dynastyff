// @spec DFF-SM-011
// @spec DFF-SM-012
// @spec DFF-SM-013
// @spec DFF-SM-014
// @spec DFF-SM-015
// @spec DFF-SM-016
// @spec DFF-SM-017
// @spec DFF-SM-025
// @spec DFF-SM-084
import test from 'node:test';
import assert from 'node:assert/strict';

import type { LeagueContext, RosterEntry, TeamRoster } from '../src/season/context.js';
import { classifyTeamContext, evaluateRoster, toLetterGrade } from '../src/season/rosterEvaluator.js';

const rosterPositions = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE'];

function entry(position: string, value: number, age: number | null, slotType: RosterEntry['slotType'] = 'starter'): RosterEntry {
  return {
    sleeperPlayerId: `${position}-${value}-${age}-${slotType}`,
    playersId: null,
    name: `${position} ${value}`,
    position,
    age,
    dynastyValue: value,
    slotType,
    matched: true,
  };
}

function team(rosterId: number, players: RosterEntry[], wins = 5, losses = 5, ties = 0): TeamRoster {
  return {
    rosterId,
    displayName: `Team ${rosterId}`,
    teamName: null,
    wins,
    losses,
    ties,
    players,
  };
}

function contextFor(allRosters: TeamRoster[], userRosterId = 1): LeagueContext {
  return {
    league: {
      leagueId: 'L',
      name: 'Eval League',
      season: '2026',
      totalRosters: allRosters.length,
      status: 'in_season',
      rosterPositions,
      scoringSettings: {},
      syncedAt: '2026-09-27T00:00:00.000Z',
    },
    userRosterId,
    userRoster: allRosters.find((candidate) => candidate.rosterId === userRosterId)?.players ?? [],
    allRosters,
    freeAgents: [],
    pendingOffers: [],
    leagueMedians: {},
    pickValues: {},
    tradedPicks: [],
    lastSyncedAt: '2026-09-27T00:00:00.000Z',
  };
}

// Six identical teams; the user upgrades QB.
function balancedLeague(userQbValue = 6000, userQbAge = 27): TeamRoster[] {
  const roster = (rosterId: number): RosterEntry[] => [
    entry('QB', rosterId === 1 ? userQbValue : 4000, rosterId === 1 ? userQbAge : 27),
    entry('RB', 3000, 24),
    entry('RB', 3000, 24),
    entry('WR', 3000, 25),
    entry('WR', 3000, 25),
    entry('TE', 3000, 26),
  ];

  return [1, 2, 3, 4, 5, 6].map((rosterId) => team(rosterId, roster(rosterId)));
}

// @spec DFF-SM-016
test('toLetterGrade maps composite bands to letters', () => {
  assert.equal(toLetterGrade(100), 'A');
  assert.equal(toLetterGrade(85), 'A');
  assert.equal(toLetterGrade(84.9), 'B');
  assert.equal(toLetterGrade(70), 'B');
  assert.equal(toLetterGrade(69.9), 'C');
  assert.equal(toLetterGrade(55), 'C');
  assert.equal(toLetterGrade(54.9), 'D');
  assert.equal(toLetterGrade(40), 'D');
  assert.equal(toLetterGrade(39.9), 'F');
  assert.equal(toLetterGrade(0), 'F');
});

test('evaluateRoster grades a league-leading QB room at the top', () => {
  const overview = evaluateRoster(contextFor(balancedLeague()));

  // QB: value 100 (league max), depth 6000/4000 → 75, age 50 → composite 82.5 → B.
  assert.equal(overview.positions.QB.grade, 'B');
  assert.equal(overview.positions.QB.valueScore, 100);
  assert.equal(overview.positions.QB.rawStarterValue, 6000);
  assert.equal(overview.positions.QB.depthScore, 75);
  assert.equal(overview.positions.QB.ageCurveScore, 50);
  assert.equal(overview.positions.QB.percentile, 100);
  assert.equal(overview.positions.QB.starters.length, 1);

  // Identical rooms: max value (100), median depth (50), prime ages (50) → 75 → B, no teams strictly below.
  assert.equal(overview.positions.RB.grade, 'B');
  assert.equal(overview.positions.RB.percentile, 0);

  // Overall: (82.5×1 + 75×5) / 6 = 76.25 → B; user leads every overall composite → top percentile.
  assert.equal(overview.overallGrade, 'B');
  assert.equal(overview.overallPercentile, 100);
});

// @spec DFF-SM-011
test('value score normalizes against the league best and uses starters only', () => {
  const rosters = balancedLeague();
  rosters[1].players.push(entry('QB', 2000, 27, 'bench'));

  const overview = evaluateRoster(contextFor(rosters));

  assert.equal(overview.positions.QB.rawStarterValue, 6000);
  assert.equal(overview.positions.QB.valueScore, 100);
});

// @spec DFF-SM-012
test('young starters earn an age bonus and post-prime starters are penalized', () => {
  const young = evaluateRoster(contextFor(balancedLeague(6000, 23)));
  assert.equal(young.positions.QB.ageCurveScore, 100);

  const old = evaluateRoster(contextFor(balancedLeague(6000, 31)));
  assert.equal(old.positions.QB.ageCurveScore, 0);

  const prime = evaluateRoster(contextFor(balancedLeague(6000, 27)));
  assert.equal(prime.positions.QB.ageCurveScore, 50);
});

// @spec DFF-SM-012
test('age curve falls back to unweighted mean for zero-value starters', () => {
  const rosters = balancedLeague(0, 23);
  rosters[0].players[0] = entry('QB', 0, 23);

  const overview = evaluateRoster(contextFor(rosters));

  assert.equal(overview.positions.QB.ageCurveScore, 100);
});

// @spec DFF-SM-013
// @spec DFF-SM-084
test('taxi players count toward depth and IR players are excluded from grades', () => {
  const rosters = balancedLeague();
  rosters[0].players.push(entry('WR', 2000, 24, 'taxi'));
  rosters[0].players.push(entry('WR', 50000, 25, 'ir'));

  const overview = evaluateRoster(contextFor(rosters));

  // WR depth: user 8000 (6000 starters + 2000 taxi) vs median 6000 → 100 × (8/6) / 2 = 66.67; IR's 50000 is ignored.
  assert.ok(Math.abs(overview.positions.WR.depthScore - 66.67) < 0.01);
  assert.equal(overview.positions.WR.rawStarterValue, 6000);
  assert.ok(overview.roster.some((row) => row.slotType === 'ir'));
});

// @spec DFF-SM-014
test('percentile ranks against other teams with a neutral single-team fallback', () => {
  const overview = evaluateRoster(contextFor(balancedLeague()));
  assert.equal(overview.positions.QB.percentile, 100);

  const single = evaluateRoster(contextFor(balancedLeague().slice(0, 1)));
  assert.equal(single.positions.QB.percentile, 50);
  assert.equal(single.overallPercentile, 50);
});

// @spec DFF-SM-017
test('overall grade weights positions by roster slot count', () => {
  const rosters = balancedLeague();

  const weighted = evaluateRoster(contextFor(rosters));
  // Overall: QB 82.5 weighted 1, others 75 weighted 5 → 76.25 → B with slot weights.
  assert.ok(Math.abs(weighted.overallPercentile - 100) < 0.01);

  const context = contextFor(rosters);
  context.league.rosterPositions = [];
  const equalWeights = evaluateRoster(context);
  // (82.5 + 75 + 75 + 75) / 4 = 76.875 → B with equal weights.
  assert.equal(equalWeights.overallGrade, 'B');
});

// @spec DFF-SM-025
test('team context classifies top half as contender and bottom half as rebuilder', () => {
  const rosters = balancedLeague();
  rosters[0].wins = 10;
  rosters[0].losses = 2;
  rosters[5].wins = 1;
  rosters[5].losses = 11;

  const contender = classifyTeamContext(rosters[0], rosters);
  assert.equal(contender.classification, 'contender');
  assert.equal(contender.rank, 1);
  assert.ok(Math.abs(contender.winPct - 10 / 12) < 1e-9);

  const rebuilder = classifyTeamContext(rosters[5], rosters);
  assert.equal(rebuilder.classification, 'rebuilder');
  assert.equal(rebuilder.rank, 6);

  const overview = evaluateRoster(contextFor(rosters));
  assert.equal(overview.teamContext.classification, 'contender');
});

// @spec DFF-SM-025
test('odd team counts split at the ceiling of half', () => {
  const rosters = balancedLeague().slice(0, 5);
  rosters[0].wins = 10;
  rosters[0].losses = 2;
  rosters[1].wins = 9;
  rosters[1].losses = 3;
  rosters[2].wins = 5;
  rosters[2].losses = 5;
  rosters[3].wins = 3;
  rosters[3].losses = 9;
  rosters[4].wins = 2;
  rosters[4].losses = 10;

  // 5 teams: ceil(5/2) = 3 → ranks 1-3 are contenders, ranks 4-5 rebuilders.
  const rank3 = classifyTeamContext(rosters[2], rosters);
  assert.equal(rank3.rank, 3);
  assert.equal(rank3.classification, 'contender');

  const rank4 = classifyTeamContext(rosters[3], rosters);
  assert.equal(rank4.rank, 4);
  assert.equal(rank4.classification, 'rebuilder');
});
