// @spec DFF-BOT-020
// @spec DFF-BOT-021
// @spec DFF-BOT-022
// @spec DFF-BOT-023
// @spec DFF-BOT-024
// @spec DFF-BOT-025
// @spec DFF-BOT-026
// @spec DFF-BOT-028
// @spec DFF-BOT-029
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadArchetypeConfigFile } from '../src/draft/archetype-config.js';
import {
  calculateSlotNeed,
  filterBotPickCandidates,
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

const lowNeedRosterConfig: DraftRosterConfig = {
  QB: 0,
  RB: 0,
  WR: 0,
  TE: 0,
  FLEX: 0,
  SF: 0,
  bench: 0,
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
// @spec DFF-BOT-021
// @spec DFF-BOT-024
test('calculateSlotNeed assigns constrained positions before shared slots when rostered players compete for FLEX', () => {
  assert.equal(
    calculateSlotNeed({
      position: 'RB',
      rosterConfig: {
        QB: 0,
        RB: 0,
        WR: 1,
        TE: 0,
        FLEX: 1,
        SF: 0,
        bench: 0,
      },
      rosteredPositions: ['WR'],
    }),
    1 / 3,
  );

  assert.equal(
    calculateSlotNeed({
      position: 'RB',
      rosterConfig: {
        QB: 0,
        RB: 0,
        WR: 1,
        TE: 0,
        FLEX: 1,
        SF: 0,
        bench: 0,
      },
      rosteredPositions: ['RB', 'WR'],
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
    dynasty_value: 110,
    adp: 1,
  };
  const rbPlayer = {
    id: 'player-rb',
    name: 'Running Back',
    position: 'RB',
    nfl_team: 'DAL',
    age: 23,
    is_rookie: false,
    dynasty_value: 100,
    adp: 2,
  };
  const rosterConfig: DraftRosterConfig = {
    QB: 1,
    RB: 2,
    WR: 0,
    TE: 0,
    FLEX: 0,
    SF: 0,
    bench: 0,
  };
  const rosteredPlayers = [
    {
      position: 'QB',
      nfl_team: 'PHI',
    },
  ] as const;

  const bpaQuarterbackScore = scoreBotPickCandidate({
    player: qbPlayer,
    archetype: 'bpa',
    archetypeConfig,
    rosterConfig,
    rosteredPlayers: [...rosteredPlayers],
    round: 1,
    randomness: 0,
    random: () => 0,
  });
  const bpaRunningBackScore = scoreBotPickCandidate({
    player: rbPlayer,
    archetype: 'bpa',
    archetypeConfig,
    rosterConfig,
    rosteredPlayers: [...rosteredPlayers],
    round: 1,
    randomness: 0,
    random: () => 0,
  });
  const rbHeavyQuarterbackScore = scoreBotPickCandidate({
    player: qbPlayer,
    archetype: 'rb_heavy',
    archetypeConfig,
    rosterConfig,
    rosteredPlayers: [...rosteredPlayers],
    round: 1,
    randomness: 0,
    random: () => 0,
  });
  const rbHeavyRunningBackScore = scoreBotPickCandidate({
    player: rbPlayer,
    archetype: 'rb_heavy',
    archetypeConfig,
    rosterConfig,
    rosteredPlayers: [...rosteredPlayers],
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
  assert.ok(roundThreeScore <= roundFourScore * 1.5);
});

// @spec DFF-BOT-025
test('scoreBotPickCandidate lets punt prefer younger non-rookies over equal-value older players', () => {
  const archetypeConfig = loadArchetypeConfigFile();
  const youngerPlayer = {
    id: 'player-young',
    name: 'Young Receiver',
    position: 'WR',
    nfl_team: 'DET',
    age: 23,
    is_rookie: false,
    dynasty_value: 100,
    adp: 10,
  };
  const olderPlayer = {
    id: 'player-old',
    name: 'Old Receiver',
    position: 'WR',
    nfl_team: 'DET',
    age: 30,
    is_rookie: false,
    dynasty_value: 100,
    adp: 11,
  };

  const youngerScore = scoreBotPickCandidate({
    player: youngerPlayer,
    archetype: 'punt',
    archetypeConfig,
    rosterConfig: lowNeedRosterConfig,
    rosteredPlayers: [],
    round: 4,
    randomness: 0,
    random: () => 0,
  });
  const olderScore = scoreBotPickCandidate({
    player: olderPlayer,
    archetype: 'punt',
    archetypeConfig,
    rosterConfig: lowNeedRosterConfig,
    rosteredPlayers: [],
    round: 4,
    randomness: 0,
    random: () => 0,
  });

  assert.ok(youngerScore > olderScore);
});

// @spec DFF-BOT-025
test('scoreBotPickCandidate keeps punt rookie bias within the bounded archetype band', () => {
  const archetypeConfig = loadArchetypeConfigFile();
  const rookieTightEnd = {
    id: 'player-rookie',
    name: 'Rookie Tight End',
    position: 'TE',
    nfl_team: 'LV',
    age: 30,
    is_rookie: true,
    dynasty_value: 100,
    adp: 15,
  };
  const veteranTightEnd = {
    id: 'player-veteran',
    name: 'Veteran Tight End',
    position: 'TE',
    nfl_team: 'LV',
    age: 30,
    is_rookie: false,
    dynasty_value: 100,
    adp: 16,
  };

  const rookieScore = scoreBotPickCandidate({
    player: rookieTightEnd,
    archetype: 'punt',
    archetypeConfig,
    rosterConfig: lowNeedRosterConfig,
    rosteredPlayers: [],
    round: 4,
    randomness: 0,
    random: () => 0,
  });
  const veteranScore = scoreBotPickCandidate({
    player: veteranTightEnd,
    archetype: 'punt',
    archetypeConfig,
    rosterConfig: lowNeedRosterConfig,
    rosteredPlayers: [],
    round: 4,
    randomness: 0,
    random: () => 0,
  });

  assert.ok(rookieScore > veteranScore);
  assert.equal(rookieScore, 112.5);
  assert.equal(veteranScore, 74.25);
});

// @spec DFF-BOT-026
test('scoreBotPickCandidate keeps same-team running back handcuff bias within the bounded archetype band', () => {
  const archetypeConfig = loadArchetypeConfigFile();
  const runningBack = {
    id: 'player-handcuff',
    name: 'Handcuff Runner',
    position: 'RB',
    nfl_team: 'SF',
    age: 24,
    is_rookie: false,
    dynasty_value: 100,
    adp: 20,
  };

  const baselineScore = scoreBotPickCandidate({
    player: runningBack,
    archetype: 'balanced',
    archetypeConfig,
    rosterConfig: lowNeedRosterConfig,
    rosteredPlayers: [],
    round: 5,
    randomness: 0,
    random: () => 0,
  });
  const handcuffScore = scoreBotPickCandidate({
    player: runningBack,
    archetype: 'balanced',
    archetypeConfig,
    rosterConfig: lowNeedRosterConfig,
    rosteredPlayers: [
      {
        position: 'RB',
        nfl_team: 'SF',
      },
    ],
    round: 5,
    randomness: 0,
    random: () => 0,
  });

  assert.ok(handcuffScore > baselineScore);
  assert.equal(baselineScore, 66);
  assert.equal(handcuffScore, 100);
});

// @spec DFF-BOT-020
// @spec DFF-BOT-022
// @spec DFF-BOT-024a
// @spec DFF-BOT-027
test('scoreBotPickCandidate keeps need and position bias inside the archetype band so value still wins a real gap', () => {
  const archetypeConfig = loadArchetypeConfigFile();
  const highValueQuarterback = {
    id: 'player-elite-qb',
    name: 'Elite Quarterback',
    position: 'QB',
    nfl_team: 'KC',
    age: 24,
    is_rookie: false,
    dynasty_value: 115,
    adp: 1,
  };
  const lowerValueRunningBack = {
    id: 'player-need-rb',
    name: 'Need Running Back',
    position: 'RB',
    nfl_team: 'DAL',
    age: 23,
    is_rookie: false,
    dynasty_value: 74,
    adp: 2,
  };

  const quarterbackScore = scoreBotPickCandidate({
    player: highValueQuarterback,
    archetype: 'rb_heavy',
    archetypeConfig,
    rosterConfig: {
      QB: 0,
      RB: 2,
      WR: 0,
      TE: 0,
      FLEX: 0,
      SF: 0,
      bench: 0,
    },
    rosteredPlayers: [],
    round: 1,
    randomness: 0,
    random: () => 0,
  });
  const runningBackScore = scoreBotPickCandidate({
    player: lowerValueRunningBack,
    archetype: 'rb_heavy',
    archetypeConfig,
    rosterConfig: {
      QB: 0,
      RB: 2,
      WR: 0,
      TE: 0,
      FLEX: 0,
      SF: 0,
      bench: 0,
    },
    rosteredPlayers: [],
    round: 1,
    randomness: 0,
    random: () => 0,
  });

  assert.ok(quarterbackScore > runningBackScore);
});

// @spec DFF-BOT-020
// @spec DFF-BOT-024a
// @spec DFF-BOT-027
test('scoreBotPickCandidate clamps extreme slot need into the configured archetype band', () => {
  const archetypeConfig = loadArchetypeConfigFile();
  const player = {
    id: 'player-band',
    name: 'Band Player',
    position: 'RB',
    nfl_team: 'MIA',
    age: 24,
    is_rookie: false,
    dynasty_value: 100,
    adp: 1,
  };
  const neutralRosterConfig: DraftRosterConfig = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    FLEX: 0,
    SF: 0,
    bench: 0,
  };
  const maxNeedRosterConfig: DraftRosterConfig = {
    QB: 0,
    RB: 3,
    WR: 0,
    TE: 0,
    FLEX: 1,
    SF: 1,
    bench: 3,
  };

  const lowNeedScore = scoreBotPickCandidate({
    player,
    archetype: 'balanced',
    archetypeConfig,
    rosterConfig: neutralRosterConfig,
    rosteredPlayers: [],
    round: 5,
    randomness: 0,
    random: () => 0,
  });
  const highNeedScore = scoreBotPickCandidate({
    player,
    archetype: 'balanced',
    archetypeConfig,
    rosterConfig: maxNeedRosterConfig,
    rosteredPlayers: [],
    round: 5,
    randomness: 0,
    random: () => 0,
  });

  assert.equal(lowNeedScore, 66);
  assert.equal(highNeedScore, 100);
});

// @spec DFF-BOT-028
// @spec DFF-BOT-029
test('filterBotPickCandidates applies floor pre-filter first, then keeps only the top score tier', () => {
  const archetypeConfig = loadArchetypeConfigFile();
  const players = [
    {
      id: 'rb-elite',
      name: 'Elite RB',
      position: 'RB',
      nfl_team: 'ATL',
      age: 23,
      is_rookie: false,
      dynasty_value: 8000,
      adp: 1,
    },
    {
      id: 'wr-near',
      name: 'Near Tier WR',
      position: 'WR',
      nfl_team: 'ARI',
      age: 22,
      is_rookie: false,
      dynasty_value: 7900,
      adp: 2,
    },
    {
      id: 'qb-floored-out',
      name: 'Below Floor QB',
      position: 'QB',
      nfl_team: 'CHI',
      age: 24,
      is_rookie: false,
      dynasty_value: 2400,
      adp: 30,
    },
    {
      id: 'te-too-low',
      name: 'Too Low TE',
      position: 'TE',
      nfl_team: 'DET',
      age: 24,
      is_rookie: false,
      dynasty_value: 2600,
      adp: 40,
    },
  ];
  const scores = new Map([
    ['rb-elite', 100],
    ['wr-near', 92],
    ['qb-floored-out', 300],
    ['te-too-low', 60],
  ]);

  const filteredCandidates = filterBotPickCandidates({
    availablePlayers: players,
    archetype: 'bpa',
    archetypeConfig,
    scorePlayer: (player) => scores.get(player.id) ?? 0,
  });

  assert.deepEqual(
    filteredCandidates.map((candidate) => candidate.id),
    ['rb-elite', 'wr-near'],
  );
});

// @spec DFF-BOT-028
test('filterBotPickCandidates falls back to the full available player pool when all players miss the floor', () => {
  const archetypeConfig = loadArchetypeConfigFile();
  const players = [
    {
      id: 'wr-depth',
      name: 'Depth WR',
      position: 'WR',
      nfl_team: 'BUF',
      age: 26,
      is_rookie: false,
      dynasty_value: 1800,
      adp: 120,
    },
    {
      id: 'te-depth',
      name: 'Depth TE',
      position: 'TE',
      nfl_team: 'CLE',
      age: 27,
      is_rookie: false,
      dynasty_value: 1700,
      adp: 121,
    },
  ];

  const filteredCandidates = filterBotPickCandidates({
    availablePlayers: players,
    archetype: 'balanced',
    archetypeConfig,
    scorePlayer: (player) => player.dynasty_value,
  });

  assert.deepEqual(
    filteredCandidates.map((candidate) => candidate.id),
    ['wr-depth', 'te-depth'],
  );
});

// @spec DFF-BOT-029
test('filterBotPickCandidates falls back to the single top-scored player when tier filtering degenerates', () => {
  const archetypeConfig = loadArchetypeConfigFile();
  const players = [
    {
      id: 'rb-top',
      name: 'Top RB',
      position: 'RB',
      nfl_team: 'SEA',
      age: 23,
      is_rookie: false,
      dynasty_value: 6000,
      adp: 10,
    },
    {
      id: 'wr-bad-score',
      name: 'Bad Score WR',
      position: 'WR',
      nfl_team: 'LAR',
      age: 24,
      is_rookie: false,
      dynasty_value: 5900,
      adp: 11,
    },
  ];
  const scores = new Map([
    ['rb-top', 100],
    ['wr-bad-score', Number.NaN],
  ]);

  const filteredCandidates = filterBotPickCandidates({
    availablePlayers: players,
    archetype: 'balanced',
    archetypeConfig,
    scorePlayer: (player) => scores.get(player.id) ?? 0,
  });

  assert.deepEqual(filteredCandidates, [{ id: 'rb-top', score: 100 }]);
});
