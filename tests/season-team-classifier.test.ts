// @spec DFF-SM-100
// @spec DFF-SM-101
// @spec DFF-SM-102
// @spec DFF-SM-103
// @spec DFF-SM-104
import test from 'node:test';
import assert from 'node:assert/strict';

import type { RosterEntry, TeamRoster } from '../src/season/context.js';
import { classifyTeams } from '../src/season/teamClassifier.js';

function player(value: number): RosterEntry {
  return {
    sleeperPlayerId: `player-${value}`,
    playersId: null,
    name: `Player ${value}`,
    position: 'QB',
    age: 27,
    dynastyValue: value,
    slotType: 'starter',
    matched: true,
    devyName: null,
  };
}

function team(rosterId: number, strength: number, wins: number, losses: number, pointsFor: number | null): TeamRoster {
  return {
    rosterId,
    displayName: `Team ${rosterId}`,
    teamName: null,
    wins,
    losses,
    ties: 0,
    pointsFor,
    players: [player(strength)],
  };
}

// @spec DFF-SM-101
// @spec DFF-SM-102
// @spec DFF-SM-104
test('week 0 favors starter strength and neutralizes record percentiles', () => {
  const classifications = classifyTeams([
    team(1, 300, 0, 0, 300),
    team(2, 200, 0, 0, 200),
    team(3, 100, 0, 0, 100),
  ]);

  const leader = classifications.get(1);
  const middle = classifications.get(2);
  const last = classifications.get(3);

  assert.equal(leader?.inputs.winPct, 0.5);
  assert.equal(leader?.winNowScore, 0.9);
  assert.equal(leader?.tier, 'contender');
  assert.equal(middle?.tier, 'middle');
  assert.equal(last?.tier, 'rebuilder');
});

// @spec DFF-SM-101
// @spec DFF-SM-102
// @spec DFF-SM-103
test('mid-season blends the three percentiles with four-game weights', () => {
  const classifications = classifyTeams([
    team(1, 300, 4, 0, 300),
    team(2, 200, 2, 2, 200),
    team(3, 100, 0, 4, 100),
  ]);

  const leader = classifications.get(1);
  const middle = classifications.get(2);
  const last = classifications.get(3);

  assert.equal(leader?.inputs.gamesPlayed, 4);
  assert.equal(leader?.winNowScore, 1);
  assert.equal(leader?.tier, 'contender');
  assert.equal(middle?.winNowScore, 0.5);
  assert.equal(middle?.tier, 'middle');
  assert.equal(last?.winNowScore, 0);
  assert.equal(last?.tier, 'rebuilder');
});

// @spec DFF-SM-101
// @spec DFF-SM-102
// @spec DFF-SM-103
// @spec DFF-SM-104
test('eight games use full record weight and missing points neutralize every team', () => {
  const classifications = classifyTeams([
    team(1, 300, 8, 0, null),
    team(2, 200, 4, 4, null),
    team(3, 100, 0, 8, null),
  ]);

  const leader = classifications.get(1);
  const middle = classifications.get(2);
  const last = classifications.get(3);

  assert.ok(Math.abs((leader?.winNowScore ?? 0) - 0.85) < 1e-9);
  assert.equal(leader?.tier, 'contender');
  assert.equal(middle?.winNowScore, 0.5);
  assert.equal(middle?.tier, 'middle');
  assert.ok(Math.abs((last?.winNowScore ?? 0) - 0.15) < 1e-9);
  assert.equal(last?.tier, 'rebuilder');
  assert.equal(leader?.inputs.pointsForPct, 0.5);
  assert.equal(middle?.inputs.pointsForPct, 0.5);
  assert.equal(last?.inputs.pointsForPct, 0.5);
});
