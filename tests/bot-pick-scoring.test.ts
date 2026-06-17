// @spec DFF-BOT-020
// @spec DFF-BOT-021
// @spec DFF-BOT-022
// @spec DFF-BOT-023
// @spec DFF-BOT-024
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadArchetypeConfigFile } from '../src/draft/archetype-config.js';
import {
  calculateSlotNeed,
  scoreBotPickCandidate,
  SLOT_ELIGIBILITY,
} from '../src/draft/bot-pick-scoring.js';
import type { DraftRosterConfig } from '../src/draft/roster-config.js';

const defaultRosterConfig: DraftRosterConfig = {
  QB: 1,
  RB: 2,
  WR: 3,
  TE: 1,
  FLEX: 1,
  SF: 1,
  bench: 2,
};

// @spec DFF-BOT-023
test('SLOT_ELIGIBILITY matches the documented roster slot eligibility map', () => {
  assert.deepEqual(SLOT_ELIGIBILITY, {
    QB: ['QB'],
    RB: ['RB'],
    WR: ['WR'],
    TE: ['TE'],
    FLEX: ['RB', 'WR', 'TE'],
    SF: ['QB', 'RB', 'WR', 'TE'],
    bench: ['QB', 'RB', 'WR', 'TE'],
  });
});

// @spec DFF-BOT-021
// @spec DFF-BOT-024
test('calculateSlotNeed sums fractional eligibility across all unfilled slots for a position', () => {
  const slotNeed = calculateSlotNeed({
    position: 'RB',
    rosterConfig: defaultRosterConfig,
    rosteredPositions: [],
  });

  assert.equal(slotNeed, 2 + 1 / 3 + 1 / 4 + 2 / 4);
});

// @spec DFF-BOT-021
test('calculateSlotNeed falls back to the 0.3 saturation floor once all eligible slots are filled', () => {
  assert.equal(
    calculateSlotNeed({
      position: 'QB',
      rosterConfig: {
        QB: 1,
        RB: 0,
        WR: 0,
        TE: 0,
        FLEX: 0,
        SF: 0,
        bench: 0,
      },
      rosteredPositions: ['QB'],
    }),
    0.3,
  );
});

// @spec DFF-BOT-020
// @spec DFF-BOT-022
// @spec DFF-BOT-024
test('scoreBotPickCandidate produces different archetype preferences for the same player pool', () => {
  const archetypeConfig = loadArchetypeConfigFile();
  const qbPlayer = {
    id: 'player-qb',
    name: 'Quarterback',
    position: 'QB',
    nfl_team: 'CIN',
    age: 24,
    is_rookie: false,
    dynasty_value: 100,
    adp: 1,
  };
  const rbPlayer = {
    id: 'player-rb',
    name: 'Running Back',
    position: 'RB',
    nfl_team: 'DAL',
    age: 23,
    is_rookie: false,
    dynasty_value: 60,
    adp: 2,
  };

  const bpaQuarterbackScore = scoreBotPickCandidate({
    player: qbPlayer,
    archetype: 'bpa',
    archetypeConfig,
    rosterConfig: defaultRosterConfig,
    rosteredPlayers: [],
    round: 1,
    randomness: 0,
    random: () => 0,
  });
  const bpaRunningBackScore = scoreBotPickCandidate({
    player: rbPlayer,
    archetype: 'bpa',
    archetypeConfig,
    rosterConfig: defaultRosterConfig,
    rosteredPlayers: [],
    round: 1,
    randomness: 0,
    random: () => 0,
  });
  const rbHeavyQuarterbackScore = scoreBotPickCandidate({
    player: qbPlayer,
    archetype: 'rb_heavy',
    archetypeConfig,
    rosterConfig: defaultRosterConfig,
    rosteredPlayers: [],
    round: 1,
    randomness: 0,
    random: () => 0,
  });
  const rbHeavyRunningBackScore = scoreBotPickCandidate({
    player: rbPlayer,
    archetype: 'rb_heavy',
    archetypeConfig,
    rosterConfig: defaultRosterConfig,
    rosteredPlayers: [],
    round: 1,
    randomness: 0,
    random: () => 0,
  });

  assert.ok(bpaQuarterbackScore > bpaRunningBackScore);
  assert.ok(rbHeavyRunningBackScore > rbHeavyQuarterbackScore);
});

// @spec DFF-BOT-022
test('scoreBotPickCandidate applies the qb_early quarterback boost only through round 3', () => {
  const archetypeConfig = loadArchetypeConfigFile();
  const quarterback = {
    id: 'player-qb',
    name: 'Quarterback',
    position: 'QB',
    nfl_team: 'CIN',
    age: 24,
    is_rookie: false,
    dynasty_value: 100,
    adp: 1,
  };

  const roundThreeScore = scoreBotPickCandidate({
    player: quarterback,
    archetype: 'qb_early',
    archetypeConfig,
    rosterConfig: defaultRosterConfig,
    rosteredPlayers: [],
    round: 3,
    randomness: 0,
    random: () => 0,
  });
  const roundFourScore = scoreBotPickCandidate({
    player: quarterback,
    archetype: 'qb_early',
    archetypeConfig,
    rosterConfig: defaultRosterConfig,
    rosteredPlayers: [],
    round: 4,
    randomness: 0,
    random: () => 0,
  });

  assert.ok(roundThreeScore > roundFourScore);
});
