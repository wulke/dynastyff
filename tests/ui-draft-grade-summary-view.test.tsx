import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { DraftGradeSummaryView } from '../src/ui/components/DraftGradeSummaryView.js';
import type { DraftState } from '../src/ui/context/DraftContext.js';

function createCompletedDraftState(overrides: Partial<DraftState> = {}): DraftState {
  return {
    draftId: 'draft-grade-1',
    status: 'completed',
    isHydrating: false,
    currentPickNumber: null,
    rosterConfig: {
      QB: 1,
      RB: 1,
      WR: 1,
      TE: 1,
      FLEX: 0,
      SF: 0,
      bench: 0,
    },
    teams: [
      { id: 'team-user', name: 'Your Team', isUser: true, archetype: null },
      { id: 'team-b', name: 'Team Beta', isUser: false, archetype: 'balanced' },
      { id: 'team-c', name: 'Team Gamma', isUser: false, archetype: 'win_now' },
    ],
    draftOrder: [
      { pickNumber: 1, round: 1, pickInRound: 1, teamId: 'team-user' },
      { pickNumber: 2, round: 1, pickInRound: 2, teamId: 'team-b' },
      { pickNumber: 3, round: 1, pickInRound: 3, teamId: 'team-c' },
      { pickNumber: 4, round: 2, pickInRound: 1, teamId: 'team-user' },
      { pickNumber: 5, round: 2, pickInRound: 2, teamId: 'team-b' },
      { pickNumber: 6, round: 2, pickInRound: 3, teamId: 'team-c' },
      { pickNumber: 7, round: 3, pickInRound: 1, teamId: 'team-user' },
      { pickNumber: 8, round: 3, pickInRound: 2, teamId: 'team-b' },
    ],
    playerCatalog: {
      'user-qb': {
        id: 'user-qb',
        name: 'User QB',
        position: 'QB',
        nflTeam: 'AAA',
        age: 25,
        isRookie: false,
        dynastyValue: 9000,
        adp: 1,
      },
      'beta-rb': {
        id: 'beta-rb',
        name: 'Beta RB',
        position: 'RB',
        nflTeam: 'BBB',
        age: 24,
        isRookie: false,
        dynastyValue: 8200,
        adp: 2,
      },
      'gamma-wr': {
        id: 'gamma-wr',
        name: 'Gamma WR',
        position: 'WR',
        nflTeam: 'CCC',
        age: 23,
        isRookie: false,
        dynastyValue: 8100,
        adp: 3,
      },
      'user-te': {
        id: 'user-te',
        name: 'User TE',
        position: 'TE',
        nflTeam: 'DDD',
        age: 22,
        isRookie: false,
        dynastyValue: 7300,
        adp: 4,
      },
      'beta-qb': {
        id: 'beta-qb',
        name: 'Beta QB',
        position: 'QB',
        nflTeam: 'EEE',
        age: 27,
        isRookie: false,
        dynastyValue: 7000,
        adp: 5,
      },
      'gamma-te': {
        id: 'gamma-te',
        name: 'Gamma TE',
        position: 'TE',
        nflTeam: 'FFF',
        age: 26,
        isRookie: false,
        dynastyValue: 6500,
        adp: 6,
      },
      'user-rb': {
        id: 'user-rb',
        name: 'User RB',
        position: 'RB',
        nflTeam: 'GGG',
        age: 24,
        isRookie: false,
        dynastyValue: 6200,
        adp: 7,
      },
    },
    picks: [
      { pickNumber: 1, teamId: 'team-user', playerId: 'user-qb', pickedAt: '2026-06-12T12:00:00.000Z' },
      { pickNumber: 2, teamId: 'team-b', playerId: 'beta-rb', pickedAt: '2026-06-12T12:01:00.000Z' },
      { pickNumber: 3, teamId: 'team-c', playerId: 'gamma-wr', pickedAt: '2026-06-12T12:02:00.000Z' },
      { pickNumber: 4, teamId: 'team-user', playerId: 'user-te', pickedAt: '2026-06-12T12:03:00.000Z' },
      { pickNumber: 5, teamId: 'team-b', playerId: 'beta-qb', pickedAt: '2026-06-12T12:04:00.000Z' },
      { pickNumber: 6, teamId: 'team-c', playerId: 'gamma-te', pickedAt: '2026-06-12T12:05:00.000Z' },
      { pickNumber: 7, teamId: 'team-user', playerId: 'user-rb', pickedAt: '2026-06-12T12:06:00.000Z' },
    ],
    rosterPlayers: [
      { teamId: 'team-user', playerId: 'user-qb' },
      { teamId: 'team-user', playerId: 'user-te' },
      { teamId: 'team-user', playerId: 'user-rb' },
      { teamId: 'team-b', playerId: 'beta-rb' },
      { teamId: 'team-b', playerId: 'beta-qb' },
      { teamId: 'team-c', playerId: 'gamma-wr' },
      { teamId: 'team-c', playerId: 'gamma-te' },
    ],
    teamPickAssets: [],
    startupPickValues: [
      { globalPickNumber: 3, dynastyValue: 7800 },
      { globalPickNumber: 8, dynastyValue: 5200 },
    ],
    userQueue: [],
    availablePlayers: [],
    trades: [],
    pendingTrade: null,
    sseStatus: 'connected',
    completedAt: '2026-06-12T12:30:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('DraftGradeSummaryView', () => {
  // @spec DFF-UI-176
  test('does not render a trade activity section when the user has no accepted trades', () => {
    render(
      <DraftGradeSummaryView
        draftState={createCompletedDraftState({
          trades: [
            {
              id: 'trade-declined',
              round: 2,
              initiatingTeamId: 'team-user',
              receivingTeamId: 'team-b',
              assetsSent: [{ type: 'player', player_id: 'user-rb' }],
              assetsReceived: [{ type: 'pick_slot', pick_number: 8 }],
              status: 'declined',
              createdAt: '2026-06-12T12:10:00.000Z',
            },
            {
              id: 'trade-other-teams',
              round: 2,
              initiatingTeamId: 'team-b',
              receivingTeamId: 'team-c',
              assetsSent: [{ type: 'player', player_id: 'beta-rb' }],
              assetsReceived: [{ type: 'player', player_id: 'gamma-wr' }],
              status: 'accepted',
              createdAt: '2026-06-12T12:11:00.000Z',
            },
          ],
        })}
        onNewDraft={vi.fn()}
        onViewHistory={vi.fn()}
      />,
    );

    expect(screen.queryByRole('heading', { name: /trade activity/i })).not.toBeInTheDocument();
  });

  // @spec DFF-UI-177
  // @spec DFF-UI-178
  // @spec DFF-UI-179
  test('renders accepted user trades with resolved asset values and positive net delta styling', () => {
    render(
      <DraftGradeSummaryView
        draftState={createCompletedDraftState({
          trades: [
            {
              id: 'trade-user-positive',
              round: 3,
              initiatingTeamId: 'team-user',
              receivingTeamId: 'team-b',
              assetsSent: [{ type: 'player', player_id: 'missing-player' }],
              assetsReceived: [
                { type: 'pick_slot', pick_number: 3 },
                { type: 'pick_slot', pick_number: 8 },
              ],
              status: 'accepted',
              createdAt: '2026-06-12T12:12:00.000Z',
            },
            {
              id: 'trade-declined',
              round: 3,
              initiatingTeamId: 'team-user',
              receivingTeamId: 'team-c',
              assetsSent: [{ type: 'player', player_id: 'user-rb' }],
              assetsReceived: [{ type: 'player', player_id: 'gamma-wr' }],
              status: 'declined',
              createdAt: '2026-06-12T12:13:00.000Z',
            },
            {
              id: 'trade-other-teams',
              round: 3,
              initiatingTeamId: 'team-b',
              receivingTeamId: 'team-c',
              assetsSent: [{ type: 'player', player_id: 'beta-rb' }],
              assetsReceived: [{ type: 'player', player_id: 'gamma-wr' }],
              status: 'accepted',
              createdAt: '2026-06-12T12:14:00.000Z',
            },
          ],
        })}
        onNewDraft={vi.fn()}
        onViewHistory={vi.fn()}
      />,
    );

    const section = screen.getByTestId('grade-summary-trade-activity');
    const row = within(section).getByTestId('trade-activity-row-trade-user-positive');

    expect(within(section).getByRole('heading', { name: /trade activity/i })).toBeInTheDocument();
    expect(within(row).getByText('Round 3')).toBeInTheDocument();
    expect(within(row).getByText('Your Team -> Team Beta')).toBeInTheDocument();
    expect(within(row).getByText('Startup 1.03')).toBeInTheDocument();
    expect(within(row).getByText('+8,100')).toHaveClass('text-positive');
    expect(within(row).getByText('8,100')).toBeInTheDocument();
    expect(within(row).getAllByText('0')).toHaveLength(2);
    expect(within(section).queryByTestId('trade-activity-row-trade-declined')).not.toBeInTheDocument();
    expect(within(section).queryByTestId('trade-activity-row-trade-other-teams')).not.toBeInTheDocument();
  });

  // @spec DFF-UI-177
  test('renders zero net deltas with muted styling', () => {
    render(
      <DraftGradeSummaryView
        draftState={createCompletedDraftState({
          trades: [
            {
              id: 'trade-user-even',
              round: 2,
              initiatingTeamId: 'team-b',
              receivingTeamId: 'team-user',
              assetsSent: [{ type: 'pick_slot', pick_number: 3 }],
              assetsReceived: [{ type: 'player', player_id: 'gamma-wr' }],
              status: 'accepted',
              createdAt: '2026-06-12T12:15:00.000Z',
            },
          ],
        })}
        onNewDraft={vi.fn()}
        onViewHistory={vi.fn()}
      />,
    );

    const row = screen.getByTestId('trade-activity-row-trade-user-even');
    expect(within(row).getByText('0')).toHaveClass('text-muted');
  });

  // @spec DFF-UI-177
  test('renders negative net deltas with negative styling', () => {
    render(
      <DraftGradeSummaryView
        draftState={createCompletedDraftState({
          trades: [
            {
              id: 'trade-user-negative',
              round: 2,
              initiatingTeamId: 'team-user',
              receivingTeamId: 'team-c',
              assetsSent: [{ type: 'player', player_id: 'user-qb' }],
              assetsReceived: [{ type: 'pick_slot', pick_number: 8 }],
              status: 'accepted',
              createdAt: '2026-06-12T12:16:00.000Z',
            },
          ],
        })}
        onNewDraft={vi.fn()}
        onViewHistory={vi.fn()}
      />,
    );

    const row = screen.getByTestId('trade-activity-row-trade-user-negative');
    expect(within(row).getByText('-9,000')).toHaveClass('text-negative');
  });
});
