import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';

import { TradeBalanceSummary } from '../src/ui/components/TradeBalanceSummary.js';
import type { DraftState } from '../src/ui/context/DraftContext.js';
import { computeDerivedPickValues } from '../src/ui/utils/draftUtils.js';

function createDraftState(overrides: Partial<DraftState> = {}): DraftState {
  return {
    draftId: 'draft-balance-1',
    status: 'in_progress',
    isHydrating: false,
    currentPickNumber: 2,
    rosterConfig: null,
    teams: [
      { id: 'team-1', name: 'Bot Alpha', isUser: false, archetype: 'balanced' },
      { id: 'team-2', name: 'User Team', isUser: true, archetype: null },
    ],
    draftOrder: [
      { pickNumber: 1, round: 1, pickInRound: 1, teamId: 'team-1' },
      { pickNumber: 2, round: 1, pickInRound: 2, teamId: 'team-2' },
      { pickNumber: 3, round: 1, pickInRound: 3, teamId: 'team-1' },
    ],
    playerCatalog: {
      'player-user': {
        id: 'player-user',
        name: 'User Player',
        position: 'WR',
        nflTeam: 'AAA',
        age: 24,
        isRookie: false,
        dynastyValue: 7000,
        adp: 12,
      },
    },
    picks: [
      {
        pickNumber: 1,
        teamId: 'team-1',
        playerId: 'picked-player-1',
        pickedAt: '2026-06-12T12:00:00.000Z',
      },
    ],
    rosterPlayers: [],
    teamPickAssets: [],
    startupPickValues: [
      { globalPickNumber: 2, dynastyValue: 9000 },
      { globalPickNumber: 3, dynastyValue: 8900 },
    ],
    userQueue: [],
    availablePlayers: [
      {
        id: 'player-1',
        name: 'Top Available',
        position: 'QB',
        nflTeam: 'BBB',
        age: 23,
        isRookie: false,
        dynastyValue: 9999,
        adp: 1,
      },
      {
        id: 'player-2',
        name: 'Second Available',
        position: 'RB',
        nflTeam: 'CCC',
        age: 22,
        isRookie: false,
        dynastyValue: 8500,
        adp: 2,
      },
    ],
    trades: [],
    pendingTrade: null,
    sseStatus: 'connected',
    completedAt: null,
    ...overrides,
  };
}

describe('TradeBalanceSummary', () => {
  afterEach(() => {
    cleanup();
  });

  // @spec DFF-UI-173
  test('renders the zero-asset edge case as 0 / 0 / 0 with a muted net delta', () => {
    const draftState = createDraftState();

    render(
      <TradeBalanceSummary
        assetsSent={[]}
        assetsReceived={[]}
        draftState={draftState}
        derivedPickValues={computeDerivedPickValues(draftState)}
      />,
    );

    const summary = screen.getByRole('region', { name: /trade balance summary/i });

    expect(within(summary).getByText(/^sent$/i)).toBeInTheDocument();
    expect(within(summary).getByText(/^received$/i)).toBeInTheDocument();
    expect(within(summary).getByText(/^net$/i)).toBeInTheDocument();
    expect(within(summary).getAllByText('0')).toHaveLength(3);
    expect(within(summary).getAllByText('0')[2]).toHaveClass('text-muted');
  });

  // @spec DFF-UI-175
  test('uses derived pick values for startup pick slots during an in-progress draft', () => {
    const draftState = createDraftState({ currentPickNumber: 1, picks: [] });

    render(
      <TradeBalanceSummary
        assetsSent={[{ type: 'pick_slot', pick_number: 2 }]}
        assetsReceived={[]}
        draftState={draftState}
        derivedPickValues={computeDerivedPickValues(draftState)}
      />,
    );

    const summary = screen.getByRole('region', { name: /trade balance summary/i });
    expect(within(summary).getByText('9,999')).toBeInTheDocument();
    expect(within(summary).getByText('-9,999')).toHaveClass('text-negative');
  });

  // @spec DFF-UI-175
  test('falls back to ETL startup pick values when the draft is not in progress', () => {
    const draftState = createDraftState({
      status: 'completed',
      currentPickNumber: null,
      completedAt: '2026-06-12T12:30:00.000Z',
    });

    render(
      <TradeBalanceSummary
        assetsSent={[{ type: 'pick_slot', pick_number: 2 }]}
        assetsReceived={[]}
        draftState={draftState}
        derivedPickValues={computeDerivedPickValues(draftState)}
      />,
    );

    const summary = screen.getByRole('region', { name: /trade balance summary/i });
    expect(within(summary).getByText('9,000')).toBeInTheDocument();
    expect(within(summary).getByText('-9,000')).toHaveClass('text-negative');
  });
});
