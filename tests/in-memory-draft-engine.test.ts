// @spec DFF-STATIC-020
// @spec DFF-STATIC-021
// @spec DFF-STATIC-022
// @spec DFF-STATIC-023
// @spec DFF-STATIC-024
// @spec DFF-STATIC-025
// @spec DFF-STATIC-026
// @spec DFF-STATIC-027
// @spec DFF-STATIC-028
// @spec DFF-STATIC-030
// @spec DFF-STATIC-031
// @spec DFF-STATIC-032
// @spec DFF-STATIC-033
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import type { DraftConfig, Snapshot } from '../src/ui/types.js';
import { availablePlayers, createDraft, currentTeam, submitPick, type InMemoryDraftState } from '../src/draft/engine.js';
import { selectBotPick } from '../src/draft/bot.js';
import { InvariantError } from '../src/draft/invariant.js';

const PLAYERS: Snapshot['players'] = [
  {
    id: 'player-qb-1',
    name: 'Alpha QB',
    position: 'QB',
    nflTeam: 'BUF',
    age: 24,
    isRookie: false,
    dynastyValue: 9000,
    adp: 10,
  },
  {
    id: 'player-rb-1',
    name: 'Bravo RB',
    position: 'RB',
    nflTeam: 'DET',
    age: 23,
    isRookie: false,
    dynastyValue: 8700,
    adp: 14,
  },
  {
    id: 'player-wr-1',
    name: 'Charlie WR',
    position: 'WR',
    nflTeam: 'HOU',
    age: 22,
    isRookie: false,
    dynastyValue: 9100,
    adp: 9,
  },
  {
    id: 'player-te-1',
    name: 'Delta TE',
    position: 'TE',
    nflTeam: 'KC',
    age: 25,
    isRookie: false,
    dynastyValue: 7500,
    adp: 30,
  },
];

const PICK_VALUES: Snapshot['pickValues'] = [
  { year: 2027, round: 1, dynastyValue: 6200 },
  { year: 2027, round: 2, dynastyValue: 4700 },
  { year: 2028, round: 1, dynastyValue: 5900 },
  { year: 2028, round: 2, dynastyValue: 4300 },
  { year: 2029, round: 1, dynastyValue: 5600 },
  { year: 2029, round: 2, dynastyValue: 4100 },
];

const DEFAULT_CONFIG: DraftConfig = {
  name: 'Dynasty Test League',
  teamCount: 12,
  rounds: 20,
  scoringFormat: 'ppr',
  userPickPosition: 6,
  futurePickYears: 2,
  rosterConfig: {
    QB: 1,
    RB: 2,
    WR: 3,
    TE: 1,
    FLEX: 1,
    SF: 1,
    bench: 6,
  },
};

function withMockedCrypto<T>(run: () => T): T {
  const originalCrypto = globalThis.crypto;
  let nextId = 0;

  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      randomUUID: () => `uuid-${++nextId}`,
    },
  });

  try {
    return run();
  } finally {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
  }
}

function withMockedRandom<T>(value: number, run: () => T): T {
  const originalRandom = Math.random;
  Math.random = () => value;

  try {
    return run();
  } finally {
    Math.random = originalRandom;
  }
}

function createSmallDraftState(config: Partial<DraftConfig> = {}): InMemoryDraftState {
  return withMockedCrypto(() =>
    withMockedRandom(0, () =>
      createDraft(
        {
          ...DEFAULT_CONFIG,
          teamCount: 2,
          rounds: 2,
          userPickPosition: 1,
          futurePickYears: 1,
          ...config,
        },
        PLAYERS,
        PICK_VALUES,
      ),
    ),
  );
}

// @spec DFF-STATIC-020
// @spec DFF-STATIC-030
test('engine and bot modules avoid server-only imports', () => {
  const engineSource = fs.readFileSync(path.resolve(process.cwd(), 'src/draft/engine.ts'), 'utf8');
  const botSource = fs.readFileSync(path.resolve(process.cwd(), 'src/draft/bot.ts'), 'utf8');

  assert.doesNotMatch(engineSource, /from ['"]node:/);
  assert.doesNotMatch(engineSource, /from ['"]better-sqlite3['"]/);
  assert.doesNotMatch(engineSource, /from ['"]drizzle-orm['"]/);
  assert.doesNotMatch(botSource, /from ['"]node:/);
  assert.doesNotMatch(botSource, /from ['"]better-sqlite3['"]/);
  assert.doesNotMatch(botSource, /from ['"]drizzle-orm['"]/);
});

// @spec DFF-STATIC-021
// @spec DFF-STATIC-022
test('createDraft returns a complete in-memory draft state with snake order and team pick assets', () => {
  const state = withMockedCrypto(() =>
    withMockedRandom(0, () => createDraft(DEFAULT_CONFIG, PLAYERS, PICK_VALUES)),
  );

  assert.equal(state.draftId, 'uuid-1');
  assert.equal(state.status, 'in_progress');
  assert.equal(state.teams.length, 12);
  assert.equal(state.picks.length, 0);
  assert.equal(state.rosterPlayers.length, 0);
  assert.equal(state.userQueue.length, 0);
  assert.equal(state.draftOrder.length, 240);

  const userTeams = state.teams.filter((team) => team.isUser);
  assert.equal(userTeams.length, 1);
  assert.equal(userTeams[0]?.name, 'Dynasty Test League');
  assert.equal(state.teams[5]?.isUser, true);

  for (const team of state.teams.filter((entry) => !entry.isUser)) {
    assert.ok(team.archetype);
    assert.equal(
      ['win_now', 'punt', 'rb_heavy', 'qb_early', 'bpa', 'balanced'].includes(team.archetype),
      true,
    );
  }

  const teamIdByPickPosition = state.teams.map((team) => team.id);
  const firstTwoRounds = state.draftOrder.slice(0, 24).map((slot) => ({
    pickNumber: slot.pickNumber,
    round: slot.round,
    pickInRound: slot.pickInRound,
    teamId: slot.teamId,
  }));

  assert.deepEqual(firstTwoRounds, [
    ...teamIdByPickPosition.map((teamId, index) => ({
      pickNumber: index + 1,
      round: 1,
      pickInRound: index + 1,
      teamId,
    })),
    ...[...teamIdByPickPosition].reverse().map((teamId, index) => ({
      pickNumber: index + 13,
      round: 2,
      pickInRound: index + 1,
      teamId,
    })),
  ]);

  assert.equal(state.teamPickAssets.length, 48);
  assert.deepEqual(
    state.teamPickAssets
      .filter((asset) => asset.teamId === state.teams[0]?.id)
      .map((asset) => ({ year: asset.year, round: asset.round })),
    [
      { year: 2027, round: 1 },
      { year: 2027, round: 2 },
      { year: 2028, round: 1 },
      { year: 2028, round: 2 },
    ],
  );
});

// @spec DFF-STATIC-023
// @spec DFF-STATIC-024
// @spec DFF-STATIC-025
test('submitPick appends a pick, records roster ownership, removes queue entries, and leaves prior state untouched', () => {
  const initialState = createSmallDraftState();
  const stateWithQueue: InMemoryDraftState = {
    ...initialState,
    userQueue: [
      { playerId: 'player-wr-1', rank: 1 },
      { playerId: 'player-qb-1', rank: 2 },
    ],
  };

  const snapshotBeforePick = structuredClone(stateWithQueue);
  const nextState = submitPick(stateWithQueue, 'player-wr-1');

  assert.deepEqual(stateWithQueue, snapshotBeforePick);
  assert.equal(nextState.picks.length, 1);
  assert.deepEqual(nextState.picks[0], {
    pickNumber: 1,
    teamId: initialState.teams[0]?.id,
    playerId: 'player-wr-1',
    pickedAt: nextState.picks[0]?.pickedAt,
  });
  assert.match(nextState.picks[0]?.pickedAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(nextState.rosterPlayers, [
    {
      teamId: initialState.teams[0]?.id,
      playerId: 'player-wr-1',
    },
  ]);
  assert.deepEqual(nextState.userQueue, [{ playerId: 'player-qb-1', rank: 2 }]);
});

// @spec DFF-STATIC-023
test('submitPick throws when the player is already drafted and does not mutate the original state', () => {
  const initialState = createSmallDraftState();
  const afterFirstPick = submitPick(initialState, 'player-wr-1');
  const snapshotBeforeDuplicate = structuredClone(afterFirstPick);

  assert.throws(() => submitPick(afterFirstPick, 'player-wr-1'), InvariantError);
  assert.deepEqual(afterFirstPick, snapshotBeforeDuplicate);
});

// @spec DFF-STATIC-023
test('submitPick throws for a completed draft and does not mutate the original state', () => {
  const initialState = createSmallDraftState({ rounds: 1 });
  const afterFirstPick = submitPick(initialState, 'player-wr-1');
  const completedState = submitPick(afterFirstPick, 'player-qb-1');
  const snapshotBeforeInvalidPick = structuredClone(completedState);

  assert.throws(() => submitPick(completedState, 'player-rb-1'), InvariantError);
  assert.deepEqual(completedState, snapshotBeforeInvalidPick);
});

// @spec DFF-STATIC-026
// @spec DFF-STATIC-027
test('submitPick marks the draft completed on the final slot and currentTeam returns null afterward', () => {
  const state = createSmallDraftState({ rounds: 1 });
  const afterFirstPick = submitPick(state, 'player-wr-1');

  assert.equal(currentTeam(afterFirstPick)?.id, state.teams[1]?.id);

  const completedState = submitPick(afterFirstPick, 'player-qb-1');

  assert.equal(completedState.status, 'completed');
  assert.equal(currentTeam(completedState), null);
});

// @spec DFF-STATIC-028
test('availablePlayers excludes drafted players and sorts the remaining pool by dynasty value descending', () => {
  const state = createSmallDraftState();
  const nextState = submitPick(state, 'player-rb-1');

  assert.deepEqual(
    availablePlayers(nextState, PLAYERS).map((player) => player.id),
    ['player-wr-1', 'player-qb-1', 'player-te-1'],
  );
});

// @spec DFF-STATIC-031
// @spec DFF-STATIC-032
test('selectBotPick returns the highest-scoring player when noise is zero', () => {
  const botTeam = {
    id: 'team-bot',
    name: 'Bot Team',
    isUser: false,
    archetype: 'rb_heavy' as const,
  };

  const playerId = withMockedRandom(0.5, () =>
    selectBotPick(
      [
        {
          id: 'player-qb',
          name: 'Quarterback',
          position: 'QB',
          nflTeam: 'CIN',
          age: 24,
          isRookie: false,
          dynastyValue: 100,
          adp: 1,
        },
        {
          id: 'player-rb',
          name: 'Running Back',
          position: 'RB',
          nflTeam: 'DAL',
          age: 23,
          isRookie: false,
          dynastyValue: 70,
          adp: 2,
        },
      ],
      botTeam,
      [],
      0,
    ),
  );

  assert.equal(playerId, 'player-rb');
});

// @spec DFF-STATIC-033
test('selectBotPick throws InvariantError when no players are available', () => {
  const botTeam = {
    id: 'team-bot',
    name: 'Bot Team',
    isUser: false,
    archetype: 'balanced' as const,
  };

  assert.throws(() => selectBotPick([], botTeam, [], 0.1), InvariantError);
});
