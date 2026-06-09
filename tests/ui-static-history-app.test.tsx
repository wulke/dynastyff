// @spec DFF-UI-155
// @spec DFF-UI-156
// @spec DFF-UI-060
// @spec DFF-UI-061
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { DraftApp } from '../src/ui/App.js';
import { DraftContextProvider, type DraftState, type DraftContextValue } from '../src/ui/context/DraftContext.js';
import type { Snapshot } from '../src/ui/types.js';

const fetchMock = vi.fn<typeof fetch>();

// @spec DFF-UI-155
// @spec DFF-UI-156
function createSnapshot(): Snapshot {
  return {
    exportedAt: '2026-05-22T12:00:00.000Z',
    players: [
      {
        id: 'player-1',
        name: 'Josh Allen',
        position: 'QB',
        nflTeam: 'BUF',
        age: 30,
        isRookie: false,
        dynastyValue: 9999,
        adp: 1,
      },
      {
        id: 'player-2',
        name: 'Bijan Robinson',
        position: 'RB',
        nflTeam: 'ATL',
        age: 23,
        isRookie: false,
        dynastyValue: 9500,
        adp: 2,
      },
    ],
    pickValues: [{ year: 2027, round: 1, dynastyValue: 6200 }],
  };
}

// @spec DFF-UI-155
// @spec DFF-UI-156
function createCompletedDraftState(): DraftState {
  return {
    draftId: 'static-draft-1',
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
      { id: 'team-1', name: 'Bot Alpha', isUser: false, archetype: 'win_now' },
      { id: 'team-2', name: 'Lakeview Legends', isUser: true, archetype: null },
    ],
    draftOrder: [
      { pickNumber: 1, round: 1, pickInRound: 1, teamId: 'team-1' },
      { pickNumber: 2, round: 1, pickInRound: 2, teamId: 'team-2' },
    ],
    playerCatalog: {
      'player-1': {
        id: 'player-1',
        name: 'Josh Allen',
        position: 'QB',
        nflTeam: 'BUF',
        age: 30,
        isRookie: false,
        dynastyValue: 9999,
        adp: 1,
      },
      'player-2': {
        id: 'player-2',
        name: 'Bijan Robinson',
        position: 'RB',
        nflTeam: 'ATL',
        age: 23,
        isRookie: false,
        dynastyValue: 9500,
        adp: 2,
      },
    },
    picks: [
      { pickNumber: 1, teamId: 'team-1', playerId: 'player-1', pickedAt: '2026-05-22T12:00:00.000Z' },
      { pickNumber: 2, teamId: 'team-2', playerId: 'player-2', pickedAt: '2026-05-22T12:01:00.000Z' },
    ],
    rosterPlayers: [
      { teamId: 'team-1', playerId: 'player-1' },
      { teamId: 'team-2', playerId: 'player-2' },
    ],
    teamPickAssets: [],
    startupPickValues: [],
    userQueue: [],
    availablePlayers: [],
    trades: [],
    pendingTrade: null,
    sseStatus: 'connected',
    completedAt: '2026-05-22T12:05:00.000Z',
  };
}

// @spec DFF-UI-155
// @spec DFF-UI-156
function renderStaticDraftApp() {
  const snapshot = createSnapshot();
  const value: DraftContextValue = {
    snapshot,
    draftState: createCompletedDraftState(),
    sessionHistory: [],
    startDraft: () => undefined,
    loadDraft: async () => false,
    showError: () => undefined,
    submitPick: async () => false,
    respondToTrade: async () => false,
    submitTradeOffer: async () => ({ ok: false }),
    updateQueue: () => undefined,
    newDraft: () => undefined,
  };

  render(
    <DraftContextProvider value={value}>
      <DraftApp />
    </DraftContextProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url === '/drafts' && method === 'GET') {
      return Promise.resolve(new Response('missing', { status: 404 }));
    }

    if (url === '/configs' && method === 'GET') {
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }

    return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('static completed-draft review flow', () => {
  // @spec DFF-UI-155
  // @spec DFF-UI-156
  // @spec DFF-UI-060
  // @spec DFF-UI-061
  test('shows the completion banner first, then opens full history after View Full History', async () => {
    const user = userEvent.setup();

    renderStaticDraftApp();

    const completionBanner = await screen.findByTestId('draft-completion-banner');
    expect(within(completionBanner).getByText(/you finished the draft/i)).toBeInTheDocument();
    expect(screen.getByTestId('drafting-layout')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /draft summary/i })).not.toBeInTheDocument();

    await user.click(within(completionBanner).getByRole('button', { name: /view draft grade/i }));
    await user.click(screen.getByRole('button', { name: /view full history/i }));

    expect(screen.getByRole('heading', { name: /draft summary/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /pick log/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /roster view/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /trade log/i })).toBeInTheDocument();

    const pickLogPanel = screen.getByRole('tabpanel', { name: /pick log/i });
    expect(within(pickLogPanel).getByText(/josh allen/i)).toBeInTheDocument();
    expect(within(pickLogPanel).getByText(/bijan robinson/i)).toBeInTheDocument();
  });
});
