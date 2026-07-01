// @spec DFF-UI-020
// @spec DFF-UI-021
// @spec DFF-UI-022
// @spec DFF-UI-023
// @spec DFF-UI-024
// @spec DFF-UI-024b
// @spec DFF-UI-025
// @spec DFF-UI-026
// @spec DFF-UI-088
// @spec DFF-UI-089
// @spec DFF-UI-090
// @spec DFF-UI-091
// @spec DFF-UI-092
// @spec DFF-UI-093
// @spec DFF-UI-092
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { App } from '../src/ui/App.js';

const fetchMock = vi.fn<typeof fetch>();

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly url: string;
  readonly listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>();
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const callback =
      typeof listener === 'function'
        ? (listener as (event: MessageEvent<string>) => void)
        : (event: MessageEvent<string>) => listener.handleEvent(event);
    const current = this.listeners.get(type) ?? new Set<(event: MessageEvent<string>) => void>();
    current.add(callback);
    this.listeners.set(type, current);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const current = this.listeners.get(type);

    if (!current) {
      return;
    }

    const callback =
      typeof listener === 'function'
        ? (listener as (event: MessageEvent<string>) => void)
        : (event: MessageEvent<string>) => listener.handleEvent(event);
    current.delete(callback);

    if (current.size === 0) {
      this.listeners.delete(type);
    }
  }

  close(): void {
    return;
  }

  emit(type: string, data: unknown): void {
    const event = new MessageEvent(type, {
      data: JSON.stringify(data),
    });

    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

// @spec DFF-UI-020
// @spec DFF-UI-021
// @spec DFF-UI-022
// @spec DFF-UI-023
// @spec DFF-UI-024
// @spec DFF-UI-025
// @spec DFF-UI-026
function createDraftStatePayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    draft_id: 'draft-board-123',
    status: 'in_progress',
    current_pick_number: 1,
    teams: [
      { id: 'team-1', name: 'Bob', is_user: false, archetype: 'win_now' },
      { id: 'team-2', name: 'You', is_user: true, archetype: null },
      { id: 'team-3', name: 'Sue', is_user: false, archetype: 'productive_struggle' },
    ],
    draft_order: [
      { pick_number: 1, round: 1, pick_in_round: 1, team_id: 'team-1' },
      { pick_number: 2, round: 1, pick_in_round: 2, team_id: 'team-2' },
      { pick_number: 3, round: 1, pick_in_round: 3, team_id: 'team-3' },
      { pick_number: 4, round: 2, pick_in_round: 1, team_id: 'team-3' },
      { pick_number: 5, round: 2, pick_in_round: 2, team_id: 'team-2' },
      { pick_number: 6, round: 2, pick_in_round: 3, team_id: 'team-1' },
    ],
    picks: [],
    roster_players: [],
    team_pick_assets: [],
    user_queue: [],
    available_players: [
      {
        id: 'player-1',
        name: 'Josh Allen',
        position: 'QB',
        nfl_team: 'BUF',
        age: 30,
        is_rookie: false,
        dynasty_value: 9999,
        adp: 1,
      },
    ],
    drafted_players: [],
    trades: [],
    ...overrides,
  };
}

// @spec DFF-UI-020
// @spec DFF-UI-021
// @spec DFF-UI-022
// @spec DFF-UI-023
// @spec DFF-UI-024
// @spec DFF-UI-025
// @spec DFF-UI-026
function emitDraftState() {
  act(() => {
    MockEventSource.instances[0]?.emit('state_sync', createDraftStatePayload());
  });
}

// @spec DFF-UI-020
// @spec DFF-UI-021
// @spec DFF-UI-022
// @spec DFF-UI-023
// @spec DFF-UI-024
// @spec DFF-UI-024b
// @spec DFF-UI-025
// @spec DFF-UI-026
function emitStateSync(overrides: Partial<Record<string, unknown>> = {}) {
  act(() => {
    MockEventSource.instances[0]?.emit('state_sync', createDraftStatePayload(overrides));
  });
}

function mockDraftStartFetches(stateOverrides: Partial<Record<string, unknown>> = {}) {
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);

    if (url === '/drafts' && !init?.method) {
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );
    }

    if (url === '/drafts' && init?.method === 'POST') {
      return Promise.resolve(
        new Response(JSON.stringify({ draftId: 'draft-board-123' }), {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );
    }

    if (url === '/drafts/draft-board-123/state') {
      return Promise.resolve(
        new Response(JSON.stringify(createDraftStatePayload(stateOverrides)), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );
    }

    if (url === '/drafts/draft-board-123/queue') {
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );
    }

    throw new Error(`Unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  MockEventSource.instances = [];
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderAppToConfig() {
  render(<App />);
  await screen.findByRole('heading', { name: /config screen/i });
}

describe('draft board UI', () => {
  // @spec DFF-UI-020
  // @spec DFF-UI-021
  // @spec DFF-UI-023
  // @spec DFF-UI-024
  // @spec DFF-UI-026
  test(
    'renders the draft board grid with round headers, snake slots, a highlighted user row, a bot skeleton, and horizontal scroll',
    async () => {
      const user = userEvent.setup();
      mockDraftStartFetches();

      await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitDraftState();

    expect(screen.getByRole('heading', { name: /draft board/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /round 1/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /round 2/i })).toBeInTheDocument();

    const boardScroller = screen.getByTestId('draft-board-scroller');
    expect(boardScroller.className).toContain('overflow-x-auto');

    const userRow = screen.getByTestId('draft-board-row-team-2');
    expect(userRow.getAttribute('data-user-team')).toBe('true');

    expect(screen.getByTestId('draft-slot-1')).toHaveAttribute('data-round', '1');
    expect(screen.getByTestId('draft-slot-1')).toHaveAttribute('data-team-id', 'team-1');
    expect(screen.getByTestId('draft-slot-4')).toHaveAttribute('data-round', '2');
    expect(screen.getByTestId('draft-slot-4')).toHaveAttribute('data-team-id', 'team-3');
    expect(screen.getByTestId('draft-slot-6')).toHaveAttribute('data-round', '2');
    expect(screen.getByTestId('draft-slot-6')).toHaveAttribute('data-team-id', 'team-1');

      expect(within(screen.getByTestId('draft-slot-1')).getByTestId('draft-slot-skeleton')).toHaveClass('animate-pulse');
    },
    10_000,
  );

  // @spec DFF-UI-022
  // @spec DFF-UI-024
  // @spec DFF-UI-025
  test('fills the correct board cell on pick_made without re-fetching and clears the bot skeleton when the next pick is the user turn', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);

      if (url === '/drafts' && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }

      if (url === '/drafts' && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ draftId: 'draft-board-123' }), {
            status: 201,
            headers: {
              'Content-Type': 'application/json',
            },
          }),
        );
      }

      if (url === '/drafts/draft-board-123/state') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              draft_id: 'draft-board-123',
              status: 'in_progress',
              current_pick_number: 1,
              teams: [
                { id: 'team-1', name: 'Bob', is_user: false, archetype: 'win_now' },
                { id: 'team-2', name: 'You', is_user: true, archetype: null },
                { id: 'team-3', name: 'Sue', is_user: false, archetype: 'productive_struggle' },
              ],
              draft_order: [
                { pick_number: 1, round: 1, pick_in_round: 1, team_id: 'team-1' },
                { pick_number: 2, round: 1, pick_in_round: 2, team_id: 'team-2' },
                { pick_number: 3, round: 1, pick_in_round: 3, team_id: 'team-3' },
                { pick_number: 4, round: 2, pick_in_round: 1, team_id: 'team-3' },
                { pick_number: 5, round: 2, pick_in_round: 2, team_id: 'team-2' },
                { pick_number: 6, round: 2, pick_in_round: 3, team_id: 'team-1' },
              ],
              picks: [],
              roster_players: [],
              team_pick_assets: [],
              user_queue: [],
              available_players: [
                {
                  id: 'player-1',
                  name: 'Josh Allen',
                  position: 'QB',
                  nfl_team: 'BUF',
                  age: 30,
                  is_rookie: false,
                  dynasty_value: 9999,
                  adp: 1,
                },
              ],
              trades: [],
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitDraftState();
    const fetchCountBeforePick = fetchMock.mock.calls.length;

    act(() => {
      MockEventSource.instances[0]?.emit('pick_made', {
        pick_number: 1,
        team_id: 'team-1',
        player_id: 'player-1',
        is_bot: true,
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(fetchCountBeforePick);

    const pickedCell = screen.getByTestId('draft-slot-1');
    expect(within(pickedCell).getByText('Josh Allen')).toBeInTheDocument();
    expect(within(pickedCell).getByText('QB')).toBeInTheDocument();
    expect(within(pickedCell).getByText('Bob')).toBeInTheDocument();
    expect(screen.queryByTestId('draft-slot-skeleton')).not.toBeInTheDocument();
  });

  // @spec DFF-UI-022
  // @spec DFF-UI-025
  test('falls back to the raw player id and NA badge when a picked player is absent from the catalog', async () => {
    const user = userEvent.setup();
    mockDraftStartFetches();

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitStateSync({ available_players: [] });

    act(() => {
      MockEventSource.instances[0]?.emit('pick_made', {
        pick_number: 1,
        team_id: 'team-1',
        player_id: 'player-X',
        is_bot: true,
      });
    });

    const pickedCell = screen.getByTestId('draft-slot-1');
    expect(within(pickedCell).getByText('player-X')).toBeInTheDocument();
    expect(within(pickedCell).getByText('NA')).toBeInTheDocument();
  });

  // @spec DFF-UI-022
  // @spec DFF-UI-025
  test('keeps drafted player metadata after reconnect when a later state_sync omits that player from available_players', async () => {
    const user = userEvent.setup();
    mockDraftStartFetches();

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitDraftState();

    act(() => {
      MockEventSource.instances[0]?.emit('pick_made', {
        pick_number: 1,
        team_id: 'team-1',
        player_id: 'player-1',
        is_bot: true,
      });
    });

    emitStateSync({
      current_pick_number: 2,
      picks: [
        {
          pick_number: 1,
          team_id: 'team-1',
          player_id: 'player-1',
          picked_at: '2026-05-22T18:00:00.000Z',
        },
      ],
      roster_players: [{ team_id: 'team-1', player_id: 'player-1' }],
      available_players: [],
    });

    const pickedCell = screen.getByTestId('draft-slot-1');
    expect(within(pickedCell).getByText('Josh Allen')).toBeInTheDocument();
    expect(within(pickedCell).getByText('QB')).toBeInTheDocument();
    expect(within(pickedCell).getByText('Bob')).toBeInTheDocument();
  });

  // @spec DFF-UI-163
  // @spec DFF-UI-164
  test('keeps a traded startup slot in its original board position while updating ownership and pick attribution', async () => {
    const user = userEvent.setup();
    mockDraftStartFetches({
      startup_pick_values: [
        { global_pick_number: 1, dynasty_value: 9999 },
        { global_pick_number: 2, dynasty_value: 9800 },
      ],
    });

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitStateSync({
      startup_pick_values: [
        { global_pick_number: 1, dynasty_value: 9999 },
        { global_pick_number: 2, dynasty_value: 9800 },
      ],
    });

    act(() => {
      MockEventSource.instances[0]?.emit('trade_offered', {
        trade_id: 'trade-slot-1',
        initiating_team_id: 'team-1',
        receiving_team_id: 'team-2',
        assets_sent: [{ type: 'pick_slot', pick_number: 1, round: 1, pick_in_round: 1 }],
        assets_received: [{ type: 'pick_slot', pick_number: 2, round: 1, pick_in_round: 2 }],
        is_bot_to_bot: false,
      });
      MockEventSource.instances[0]?.emit('trade_resolved', {
        trade_id: 'trade-slot-1',
        status: 'accepted',
        created_at: '2026-05-22T18:05:00.000Z',
        assets_sent: [{ type: 'pick_slot', pick_number: 1, round: 1, pick_in_round: 1 }],
        assets_received: [{ type: 'pick_slot', pick_number: 2, round: 1, pick_in_round: 2 }],
      });
    });

    const originalRow = screen.getByTestId('draft-board-row-team-1');
    const tradedSlot = within(originalRow).getByTestId('draft-slot-1');

    expect(tradedSlot).toHaveAttribute('data-team-id', 'team-2');
    expect(within(tradedSlot).getByText('Owned by You')).toBeInTheDocument();

    act(() => {
      MockEventSource.instances[0]?.emit('pick_made', {
        pick_number: 1,
        team_id: 'team-2',
        player_id: 'player-1',
        is_bot: false,
      });
    });

    expect(within(tradedSlot).getByText('Josh Allen')).toBeInTheDocument();
    expect(within(tradedSlot).getByText('You')).toBeInTheDocument();
    expect(within(tradedSlot).getByText('Owned by You')).toBeInTheDocument();
  });

  // @spec DFF-UI-163
  test('updates traded startup slot ownership when the trade asset is identified by draft_order_id', async () => {
    const user = userEvent.setup();
    mockDraftStartFetches({
      draft_order: [
        { id: 'slot-1', pick_number: 1, round: 1, pick_in_round: 1, team_id: 'team-1' },
        { id: 'slot-2', pick_number: 2, round: 1, pick_in_round: 2, team_id: 'team-2' },
        { id: 'slot-3', pick_number: 3, round: 1, pick_in_round: 3, team_id: 'team-3' },
        { id: 'slot-4', pick_number: 4, round: 2, pick_in_round: 1, team_id: 'team-3' },
        { id: 'slot-5', pick_number: 5, round: 2, pick_in_round: 2, team_id: 'team-2' },
        { id: 'slot-6', pick_number: 6, round: 2, pick_in_round: 3, team_id: 'team-1' },
      ],
    });

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitStateSync({
      draft_order: [
        { id: 'slot-1', pick_number: 1, round: 1, pick_in_round: 1, team_id: 'team-1' },
        { id: 'slot-2', pick_number: 2, round: 1, pick_in_round: 2, team_id: 'team-2' },
        { id: 'slot-3', pick_number: 3, round: 1, pick_in_round: 3, team_id: 'team-3' },
        { id: 'slot-4', pick_number: 4, round: 2, pick_in_round: 1, team_id: 'team-3' },
        { id: 'slot-5', pick_number: 5, round: 2, pick_in_round: 2, team_id: 'team-2' },
        { id: 'slot-6', pick_number: 6, round: 2, pick_in_round: 3, team_id: 'team-1' },
      ],
    });

    act(() => {
      MockEventSource.instances[0]?.emit('trade_offered', {
        trade_id: 'trade-slot-by-id',
        initiating_team_id: 'team-1',
        receiving_team_id: 'team-2',
        assets_sent: [{ type: 'pick_slot', draft_order_id: 'slot-1', pick_number: 1 }],
        assets_received: [{ type: 'pick_slot', draft_order_id: 'slot-2', pick_number: 2 }],
        is_bot_to_bot: false,
      });
      MockEventSource.instances[0]?.emit('trade_resolved', {
        trade_id: 'trade-slot-by-id',
        status: 'accepted',
        created_at: '2026-05-22T18:06:00.000Z',
        assets_sent: [{ type: 'pick_slot', draft_order_id: 'slot-1', pick_number: 1 }],
        assets_received: [{ type: 'pick_slot', draft_order_id: 'slot-2', pick_number: 2 }],
      });
    });

    const tradedSlot = within(screen.getByTestId('draft-board-row-team-1')).getByTestId('draft-slot-1');
    expect(tradedSlot).toHaveAttribute('data-team-id', 'team-2');
    expect(within(tradedSlot).getByText('Owned by You')).toBeInTheDocument();
  });

  // @spec DFF-UI-024
  // @spec DFF-UI-024b
  test('does not render a skeleton when the current pick belongs to the user team', async () => {
    const user = userEvent.setup();
    mockDraftStartFetches();

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitStateSync({ current_pick_number: 2 });

    expect(screen.queryByTestId('draft-slot-skeleton')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('draft-slot-2')).getByText(/^waiting$/i)).toBeInTheDocument();
  });

  // @spec DFF-UI-088
  // @spec DFF-UI-089
  test('renders a layout toggle button in the draft board header that switches between row and column mode', async () => {
    const user = userEvent.setup();
    mockDraftStartFetches();

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitDraftState();

    // Toggle button exists in the header
    const toggle = screen.getByTestId('layout-toggle');
    expect(toggle).toBeInTheDocument();

    // Default is row mode: teams as rows, rounds as columns
    expect(screen.getByRole('columnheader', { name: /team/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /round 1/i })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /bob/i })).toBeInTheDocument();

    // Click toggle to switch to column mode
    await user.click(toggle);

    // Column mode: rounds as rows, teams as columns
    expect(screen.getByRole('columnheader', { name: /bob/i })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /rd 1/i })).toBeInTheDocument();
  });

  // @spec DFF-UI-088
  // @spec DFF-UI-089
  test('layout mode persists to localStorage and is restored on page load', async () => {
    const user = userEvent.setup();
    mockDraftStartFetches();

    // Set localStorage to column mode before render
    localStorage.setItem('draftBoardLayout', 'column');

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitDraftState();

    // Should start in column mode
    expect(screen.getByRole('rowheader', { name: /rd 1/i })).toBeInTheDocument();

    // Switch to row mode
    await user.click(screen.getByTestId('layout-toggle'));
    expect(localStorage.getItem('draftBoardLayout')).toBe('row');

    // Switch back to column mode
    await user.click(screen.getByTestId('layout-toggle'));
    expect(localStorage.getItem('draftBoardLayout')).toBe('column');
  });

  // @spec DFF-UI-088
  // @spec DFF-UI-090
  // @spec DFF-UI-091
  test('column mode renders rounds as rows and teams as columns with sticky team-name header row', async () => {
    const user = userEvent.setup();
    mockDraftStartFetches();

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitDraftState();

    // Switch to column mode
    await user.click(screen.getByTestId('layout-toggle'));

    // Column mode: scroll container should allow vertical scroll
    const scroller = screen.getByTestId('draft-board-scroller');
    expect(scroller.className).toContain('overflow-y-auto');

    // Team name header should be sticky in column mode
    const teamHeaderCells = screen.getAllByRole('columnheader');
    const firstTeamHeader = teamHeaderCells.find((cell) => cell.textContent?.includes('Bob'));
    expect(firstTeamHeader).toBeDefined();
    expect(firstTeamHeader!.className).toContain('sticky');
  });

  // @spec DFF-UI-093
  test('column mode applies amber tint to the user team column header', async () => {
    const user = userEvent.setup();
    mockDraftStartFetches();

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitDraftState();

    // Switch to column mode
    await user.click(screen.getByTestId('layout-toggle'));

    // Find the user team column header (team-2 = 'You')
    const teamHeaderCells = screen.getAllByRole('columnheader');
    const userTeamHeader = teamHeaderCells.find((cell) => cell.textContent?.includes('You'));
    expect(userTeamHeader).toBeDefined();
    expect(userTeamHeader!.className).toContain('bg-accent/10');

    // Non-user team should not have accent tint
    const nonUserTeamHeader = teamHeaderCells.find((cell) => cell.textContent?.includes('Bob'));
    expect(nonUserTeamHeader).toBeDefined();
    expect(nonUserTeamHeader!.className).toContain('bg-app');
    expect(nonUserTeamHeader!.className).not.toContain('bg-accent/10');
  });

  // @spec DFF-UI-092
  test('position badges are color-coded by position (QB=amber, RB=blue, WR=emerald, TE=purple, PICK=yellow, RDP=yellow, other=stone)', async () => {
    const user = userEvent.setup();
    mockDraftStartFetches();

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitStateSync({
      current_pick_number: 1,
      available_players: [
        {
          id: 'player-1',
          name: 'Josh Allen',
          position: 'QB',
          nfl_team: 'BUF',
          age: 30,
          is_rookie: false,
          dynasty_value: 9999,
          adp: 1,
        },
        {
          id: 'player-2',
          name: 'Bijan Robinson',
          position: 'RB',
          nfl_team: 'ATL',
          age: 23,
          is_rookie: false,
          dynasty_value: 9500,
          adp: 3,
        },
        {
          id: 'player-3',
          name: 'Justin Jefferson',
          position: 'WR',
          nfl_team: 'MIN',
          age: 26,
          is_rookie: false,
          dynasty_value: 9800,
          adp: 2,
        },
        {
          id: 'player-4',
          name: 'Brock Bowers',
          position: 'TE',
          nfl_team: 'LV',
          age: 22,
          is_rookie: true,
          dynasty_value: 8800,
          adp: 10,
        },
      ],
    });

    // Make picks for each slot
    act(() => {
      MockEventSource.instances[0]?.emit('pick_made', {
        pick_number: 1,
        team_id: 'team-1',
        player_id: 'player-1',
        is_bot: true,
      });
    });

    act(() => {
      MockEventSource.instances[0]?.emit('pick_made', {
        pick_number: 2,
        team_id: 'team-2',
        player_id: 'player-2',
        is_bot: true,
      });
    });

    act(() => {
      MockEventSource.instances[0]?.emit('pick_made', {
        pick_number: 3,
        team_id: 'team-3',
        player_id: 'player-3',
        is_bot: true,
      });
    });

    // Verify QB badge uses pos-qb semantic classes
    const qbBadge = within(screen.getByTestId('draft-slot-1')).getByText('QB');
    expect(qbBadge.className).toContain('pos-qb');
    expect(qbBadge.className).not.toContain('pos-wr');

    // Verify RB badge uses pos-rb semantic classes
    const rbBadge = within(screen.getByTestId('draft-slot-2')).getByText('RB');
    expect(rbBadge.className).toContain('pos-rb');
    expect(rbBadge.className).not.toContain('pos-wr');

    // Verify WR badge uses pos-wr semantic classes
    const wrBadge = within(screen.getByTestId('draft-slot-3')).getByText('WR');
    expect(wrBadge.className).toContain('pos-wr');

    // Verify TE badge uses pos-te semantic classes
    act(() => {
      MockEventSource.instances[0]?.emit('pick_made', {
        pick_number: 4,
        team_id: 'team-1',
        player_id: 'player-4',
        is_bot: true,
      });
    });

    const teBadge = within(screen.getByTestId('draft-slot-4')).getByText('TE');
    expect(teBadge.className).toContain('pos-te');
  });

  // @spec DFF-UI-092
  test('position badges use yellow for PICK/RDP and stone for unknown positions', async () => {
    const user = userEvent.setup();
    mockDraftStartFetches();

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitStateSync({
      current_pick_number: 1,
      available_players: [
        {
          id: 'player-pick',
          name: 'Startup Pick',
          position: 'PICK',
          nfl_team: null,
          age: null,
          is_rookie: false,
          dynasty_value: 5000,
          adp: null,
        },
        {
          id: 'player-rdp',
          name: 'Rookie Pick',
          position: 'RDP',
          nfl_team: null,
          age: null,
          is_rookie: false,
          dynasty_value: 4000,
          adp: null,
        },
        {
          id: 'player-unknown',
          name: 'Unknown',
          position: 'K',
          nfl_team: null,
          age: null,
          is_rookie: false,
          dynasty_value: 1000,
          adp: null,
        },
      ],
    });

    // Pick the first two players so slots fill in
    act(() => {
      MockEventSource.instances[0]?.emit('pick_made', {
        pick_number: 1,
        team_id: 'team-1',
        player_id: 'player-pick',
        is_bot: true,
      });
    });

    act(() => {
      MockEventSource.instances[0]?.emit('pick_made', {
        pick_number: 2,
        team_id: 'team-2',
        player_id: 'player-rdp',
        is_bot: true,
      });
    });

    act(() => {
      MockEventSource.instances[0]?.emit('pick_made', {
        pick_number: 3,
        team_id: 'team-3',
        player_id: 'player-unknown',
        is_bot: true,
      });
    });

    // Verify PICK badge uses pos-pick semantic classes
    const pickBadge = within(screen.getByTestId('draft-slot-1')).getByText('PICK');
    expect(pickBadge.className).toContain('pos-pick');

    // Verify RDP badge uses pos-pick semantic classes
    const rdpBadge = within(screen.getByTestId('draft-slot-2')).getByText('RDP');
    expect(rdpBadge.className).toContain('pos-pick');

    // Verify unknown position (K) badge uses border-default (no position color)
    const unknownBadge = within(screen.getByTestId('draft-slot-3')).getByText('K');
    expect(unknownBadge.className).toContain('border-default');
    expect(unknownBadge.className).not.toContain('pos-qb');
    expect(unknownBadge.className).not.toContain('pos-rb');
    expect(unknownBadge.className).not.toContain('pos-wr');
    expect(unknownBadge.className).not.toContain('pos-te');
    expect(unknownBadge.className).not.toContain('pos-pick');
  });

  // @spec DFF-UI-089
  test('invalid localStorage value defaults to row mode', async () => {
    const user = userEvent.setup();
    mockDraftStartFetches();

    // Set localStorage to a corrupted value
    localStorage.setItem('draftBoardLayout', 'garbage');

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitDraftState();

    // Should start in row mode despite corrupted localStorage
    expect(screen.getByRole('columnheader', { name: /team/i })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /bob/i })).toBeInTheDocument();
  });

  // @spec DFF-UI-163
  test('keeps a canonical round cell visible when ownership moves away from the original team', async () => {
    const user = userEvent.setup();
    mockDraftStartFetches();

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitStateSync({
      draft_order: [
        { pick_number: 1, round: 1, pick_in_round: 1, team_id: 'team-1' },
        { pick_number: 2, round: 1, pick_in_round: 2, team_id: 'team-2' },
        { pick_number: 3, round: 1, pick_in_round: 3, team_id: 'team-3' },
        { pick_number: 4, round: 2, pick_in_round: 1, team_id: 'team-3' },
        { pick_number: 5, round: 2, pick_in_round: 2, team_id: 'team-1' },
      ],
    });

    const userRow = screen.getByTestId('draft-board-row-team-2');
    expect(within(userRow).getByTestId('draft-slot-2')).toBeInTheDocument();
    expect(within(userRow).getByTestId('draft-slot-5')).toBeInTheDocument();
    expect(within(userRow).getByText('Owned by Bob')).toBeInTheDocument();
  });
});
