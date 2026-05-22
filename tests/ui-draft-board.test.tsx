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
function emitDraftState() {
  act(() => {
    MockEventSource.instances[0]?.emit('state_sync', {
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
    });
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
    MockEventSource.instances[0]?.emit('state_sync', {
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
      ...overrides,
    });
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

describe('draft board UI', () => {
  // @spec DFF-UI-020
  // @spec DFF-UI-021
  // @spec DFF-UI-023
  // @spec DFF-UI-024
  // @spec DFF-UI-026
  test('renders the draft board grid with round headers, snake slots, a highlighted user row, a bot skeleton, and horizontal scroll', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-board-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    render(<App />);

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
  });

  // @spec DFF-UI-022
  // @spec DFF-UI-024
  // @spec DFF-UI-025
  test('fills the correct board cell on pick_made without re-fetching and clears the bot skeleton when the next pick is the user turn', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-board-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    render(<App />);

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

    expect(fetchMock).toHaveBeenCalledTimes(1);

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
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-board-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    render(<App />);

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
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-board-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    render(<App />);

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

  // @spec DFF-UI-024
  // @spec DFF-UI-024b
  test('does not render a skeleton when the current pick belongs to the user team', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-board-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    render(<App />);

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitStateSync({ current_pick_number: 2 });

    expect(screen.queryByTestId('draft-slot-skeleton')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('draft-slot-2')).getByText(/waiting for selection/i)).toBeInTheDocument();
  });

  // @spec DFF-UI-088
  // @spec DFF-UI-089
  test('renders a layout toggle button in the draft board header that switches between row and column mode', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-board-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    render(<App />);

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
    expect(screen.getByRole('rowheader', { name: /round 1/i })).toBeInTheDocument();
  });

  // @spec DFF-UI-088
  // @spec DFF-UI-089
  test('layout mode persists to localStorage and is restored on page load', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-board-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    // Set localStorage to column mode before render
    localStorage.setItem('draftBoardLayout', 'column');

    render(<App />);

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitDraftState();

    // Should start in column mode
    expect(screen.getByRole('rowheader', { name: /round 1/i })).toBeInTheDocument();

    // Switch to row mode
    await user.click(screen.getByTestId('layout-toggle'));
    expect(localStorage.getItem('draftBoardLayout')).toBe('row');

    // Switch back to column mode
    await user.click(screen.getByTestId('layout-toggle'));
    expect(localStorage.getItem('draftBoardLayout')).toBe('column');
  });

  // @spec DFF-UI-088
  // @spec DFF-UI-090
  test('column mode renders rounds as rows and teams as columns with sticky team-name header row', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-board-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    render(<App />);

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

  // @spec DFF-UI-092
  test('position badges are color-coded by position', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-board-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    render(<App />);

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

    // Verify QB badge has amber color classes
    const qbBadge = within(screen.getByTestId('draft-slot-1')).getByText('QB');
    expect(qbBadge.className).toContain('amber');
    expect(qbBadge.className).not.toContain('emerald');

    // Verify RB badge has blue color classes
    const rbBadge = within(screen.getByTestId('draft-slot-2')).getByText('RB');
    expect(rbBadge.className).toContain('blue');
    expect(rbBadge.className).not.toContain('emerald');

    // Verify WR badge has emerald color classes
    const wrBadge = within(screen.getByTestId('draft-slot-3')).getByText('WR');
    expect(wrBadge.className).toContain('emerald');
  });

  // @spec DFF-UI-020
  // @spec DFF-UI-021
  test('renders an empty cell when a team has no slot in a round', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-board-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    render(<App />);

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

    const cells = userRow.querySelectorAll('td');
    expect(cells).toHaveLength(2);
    expect(cells[1]?.textContent?.trim()).toBe('');
  });
});
