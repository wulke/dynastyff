// @spec DFF-UI-020
// @spec DFF-UI-021
// @spec DFF-UI-022
// @spec DFF-UI-023
// @spec DFF-UI-024
// @spec DFF-UI-024b
// @spec DFF-UI-025
// @spec DFF-UI-026
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
