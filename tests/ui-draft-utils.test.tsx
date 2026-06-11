import { describe, expect, test } from 'vitest';

import type { DraftState } from '../src/ui/context/DraftContext.js';
import { computeDerivedPickValues } from '../src/ui/utils/draftUtils.js';

function createDraftState(overrides: Partial<DraftState> = {}): DraftState {
  return {
    draftId: 'draft-utility-1',
    status: 'in_progress',
    isHydrating: false,
    currentPickNumber: 2,
    rosterConfig: null,
    teams: [],
    draftOrder: [
      { pickNumber: 1, round: 1, pickInRound: 1, teamId: 'team-1' },
      { pickNumber: 2, round: 1, pickInRound: 2, teamId: 'team-2' },
      { pickNumber: 3, round: 1, pickInRound: 3, teamId: 'team-3' },
      { pickNumber: 4, round: 1, pickInRound: 4, teamId: 'team-4' },
    ],
    playerCatalog: {},
    picks: [
      {
        pickNumber: 1,
        teamId: 'team-1',
        playerId: 'picked-player-1',
        pickedAt: '2026-06-11T12:00:00.000Z',
      },
    ],
    rosterPlayers: [],
    teamPickAssets: [],
    startupPickValues: [],
    userQueue: [],
    availablePlayers: [
      {
        id: 'player-1',
        name: 'Player One',
        position: 'WR',
        nflTeam: 'AAA',
        age: 23,
        isRookie: false,
        dynastyValue: 9100,
        adp: 1,
      },
      {
        id: 'player-2',
        name: 'Player Two',
        position: 'RB',
        nflTeam: 'BBB',
        age: 24,
        isRookie: false,
        dynastyValue: 8700,
        adp: 2,
      },
      {
        id: 'player-3',
        name: 'Player Three',
        position: 'QB',
        nflTeam: 'CCC',
        age: 25,
        isRookie: false,
        dynastyValue: 8300,
        adp: 3,
      },
    ],
    trades: [],
    pendingTrade: null,
    sseStatus: 'connected',
    completedAt: null,
    ...overrides,
  };
}

describe('computeDerivedPickValues', () => {
  // @spec DFF-UI-170
  test('maps every unfilled pick slot to the estimated available player dynasty value', () => {
    const draftState = createDraftState();

    expect(Array.from(computeDerivedPickValues(draftState).entries())).toEqual([
      [2, 9100],
      [3, 9100],
      [4, 8700],
    ]);
  });

  // @spec DFF-UI-170
  test('returns an empty map when the available player pool is empty', () => {
    const draftState = createDraftState({ availablePlayers: [] });

    expect(computeDerivedPickValues(draftState)).toEqual(new Map());
  });

  // @spec DFF-UI-170
  test('returns an empty map when the draft is not in progress or the current pick number is missing', () => {
    expect(computeDerivedPickValues(createDraftState({ status: 'completed' }))).toEqual(new Map());
    expect(computeDerivedPickValues(createDraftState({ currentPickNumber: null }))).toEqual(new Map());
  });

  // @spec DFF-UI-170
  test('clamps negative estimated ranks to zero defensively', () => {
    const draftState = createDraftState({
      currentPickNumber: 4,
      picks: [],
      draftOrder: [
        { pickNumber: 1, round: 1, pickInRound: 1, teamId: 'team-1' },
        { pickNumber: 2, round: 1, pickInRound: 2, teamId: 'team-2' },
      ],
    });

    expect(Array.from(computeDerivedPickValues(draftState).entries())).toEqual([
      [1, 9100],
      [2, 9100],
    ]);
  });
});
