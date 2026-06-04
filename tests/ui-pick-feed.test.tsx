// @spec DFF-UI-100
// @spec DFF-UI-101
// @spec DFF-UI-102
// @spec DFF-UI-103
// @spec DFF-UI-104
// @spec DFF-UI-144
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

// @spec DFF-UI-101
// @spec DFF-UI-102
// @spec DFF-UI-103
function emitStateSync(overrides: Partial<Record<string, unknown>> = {}) {
  act(() => {
    MockEventSource.instances[0]?.emit('state_sync', {
      draft_id: 'draft-pick-feed-123',
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
      ],
      drafted_players: [],
      trades: [],
      ...overrides,
    });
  });
}

// @spec DFF-UI-102
function emitPickMade(pickNumber: number, teamId: string, playerId: string) {
  act(() => {
    MockEventSource.instances[0]?.emit('pick_made', {
      pick_number: pickNumber,
      team_id: teamId,
      player_id: playerId,
      is_bot: true,
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

function mockAppBootstrapAndDraftCreation(draftId = 'draft-pick-feed-123') {
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url === '/drafts' && method === 'GET') {
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );
    }

    if (url === '/configs' && method === 'GET') {
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );
    }

    if (url === '/drafts' && method === 'POST') {
      return Promise.resolve(
        new Response(JSON.stringify({ draftId }), {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );
    }

    throw new Error(`Unhandled fetch in ui-pick-feed test: ${method} ${url}`);
  });
}

async function renderAppToConfig() {
  render(<App />);
  await screen.findByRole('heading', { name: /config screen/i });
}

describe('pick feed panel', () => {
  // @spec DFF-UI-100
  // @spec DFF-UI-104
  // @spec DFF-UI-144
  test('renders a pick feed panel alongside the draft board with full-column scroll behavior and empty state', async () => {
    const user = userEvent.setup();
    mockAppBootstrapAndDraftCreation();

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitStateSync();

    // Pick feed panel should be rendered alongside the draft board
    const pickFeed = screen.getByTestId('pick-feed-panel');
    expect(screen.getByTestId('pick-feed-column').className).toContain('flex');
    expect(pickFeed).toBeInTheDocument();
    expect(pickFeed.className).toContain('h-full');
    expect(pickFeed.className).toContain('flex-col');

    // Panel should fill its column and retain independent scroll without a fixed max height
    const scrollContainer = within(pickFeed).getByTestId('pick-feed-scroll-container');
    expect(scrollContainer.className).not.toContain('max-h-[28rem]');
    expect(scrollContainer.className).toContain('flex-1');
    expect(scrollContainer.className).toContain('min-h-0');
    expect(scrollContainer.className).toContain('overflow-y-auto');

    // Empty state should show when no picks exist
    expect(within(pickFeed).getByText('No picks yet')).toBeInTheDocument();
  });

  // @spec DFF-UI-101
  test('hydrates from existing picks in draft state on load, ordered most recent at top', async () => {
    const user = userEvent.setup();
    mockAppBootstrapAndDraftCreation();

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));

    // Seed with existing picks via state_sync
    emitStateSync({
      current_pick_number: 4,
      picks: [
        { pick_number: 1, team_id: 'team-1', player_id: 'player-1', picked_at: '2026-05-22T18:00:00.000Z' },
        { pick_number: 2, team_id: 'team-2', player_id: 'player-2', picked_at: '2026-05-22T18:01:00.000Z' },
        { pick_number: 3, team_id: 'team-3', player_id: 'player-3', picked_at: '2026-05-22T18:02:00.000Z' },
      ],
      roster_players: [
        { team_id: 'team-1', player_id: 'player-1' },
        { team_id: 'team-2', player_id: 'player-2' },
        { team_id: 'team-3', player_id: 'player-3' },
      ],
    });

    const pickFeed = screen.getByTestId('pick-feed-panel');

    // All three picks should be rendered
    expect(within(pickFeed).getByText('1.1 - Josh Allen')).toBeInTheDocument();
    expect(within(pickFeed).getByText('1.2 - Bijan Robinson')).toBeInTheDocument();
    expect(within(pickFeed).getByText('1.3 - Justin Jefferson')).toBeInTheDocument();

    // Most recent pick (pick 3, Justin Jefferson) should be at the top
    const feedEntries = within(pickFeed).getAllByTestId(/^pick-feed-entry-/);
    expect(feedEntries).toHaveLength(3);

    // feeds are rendered most-recent-first: pick 3, pick 2, pick 1
    const firstEntry = feedEntries[0];
    expect(firstEntry).toHaveAttribute('data-testid', 'pick-feed-entry-3');
    expect(within(firstEntry).getByText('1.3 - Justin Jefferson')).toBeInTheDocument();

    const lastEntry = feedEntries[2];
    expect(lastEntry).toHaveAttribute('data-testid', 'pick-feed-entry-1');
    expect(within(lastEntry).getByText('1.1 - Josh Allen')).toBeInTheDocument();
  });

  // @spec DFF-UI-101
  // @spec DFF-UI-103
  test('hydrates historical pick names from drafted player metadata when resume state has no available players left', async () => {
    const user = userEvent.setup();
    mockAppBootstrapAndDraftCreation();

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));

    emitStateSync({
      current_pick_number: 4,
      picks: [
        { pick_number: 1, team_id: 'team-1', player_id: 'player-1', picked_at: '2026-05-22T18:00:00.000Z' },
        { pick_number: 2, team_id: 'team-2', player_id: 'player-2', picked_at: '2026-05-22T18:01:00.000Z' },
        { pick_number: 3, team_id: 'team-3', player_id: 'player-3', picked_at: '2026-05-22T18:02:00.000Z' },
      ],
      roster_players: [
        { team_id: 'team-1', player_id: 'player-1' },
        { team_id: 'team-2', player_id: 'player-2' },
        { team_id: 'team-3', player_id: 'player-3' },
      ],
      available_players: [],
      drafted_players: [
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
      ],
    });

    const pickFeed = screen.getByTestId('pick-feed-panel');
    expect(within(pickFeed).getByText('1.1 - Josh Allen')).toBeInTheDocument();
    expect(within(pickFeed).getByText('1.2 - Bijan Robinson')).toBeInTheDocument();
    expect(within(pickFeed).getByText('1.3 - Justin Jefferson')).toBeInTheDocument();
  });

  // @spec DFF-UI-102
  // @spec DFF-UI-103
  test('prepends a new entry on pick_made SSE event as a concise round-pick line', async () => {
    const user = userEvent.setup();
    mockAppBootstrapAndDraftCreation();

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitStateSync();

    // No picks initially
    const pickFeed = screen.getByTestId('pick-feed-panel');
    expect(within(pickFeed).getByText('No picks yet')).toBeInTheDocument();

    // Emit a pick_made event
    emitPickMade(1, 'team-1', 'player-1');

    // Feed should now show one entry
    const feedEntries1 = within(pickFeed).getAllByTestId(/^pick-feed-entry-/);
    expect(feedEntries1).toHaveLength(1);

    const entry1 = feedEntries1[0];
    expect(within(entry1).getByText('1.1 - Josh Allen')).toBeInTheDocument();
    expect(within(entry1).queryByText('QB')).not.toBeInTheDocument();
    expect(within(entry1).queryByText('Bob')).not.toBeInTheDocument();
    expect(within(entry1).queryByText('Rd 1, Pick 1')).not.toBeInTheDocument();

    // Emit a second pick
    emitPickMade(2, 'team-2', 'player-2');

    // Feed should now have two entries, most recent first
    const feedEntries2 = within(pickFeed).getAllByTestId(/^pick-feed-entry-/);
    expect(feedEntries2).toHaveLength(2);

    // Most recent (pick 2) at top
    expect(feedEntries2[0]).toHaveAttribute('data-testid', 'pick-feed-entry-2');
    expect(within(feedEntries2[0]).getByText('1.2 - Bijan Robinson')).toBeInTheDocument();
    expect(within(feedEntries2[0]).queryByText('RB')).not.toBeInTheDocument();
    expect(within(feedEntries2[0]).queryByText('You')).not.toBeInTheDocument();
    expect(within(feedEntries2[0]).queryByText('Rd 1, Pick 2')).not.toBeInTheDocument();

    // Older pick (pick 1) at bottom
    expect(feedEntries2[1]).toHaveAttribute('data-testid', 'pick-feed-entry-1');
    expect(within(feedEntries2[1]).getByText('1.1 - Josh Allen')).toBeInTheDocument();
  });

  // @spec DFF-UI-103
  test('falls back to raw playerId when player absent from catalog', async () => {
    const user = userEvent.setup();
    mockAppBootstrapAndDraftCreation();

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitStateSync({ available_players: [] });

    emitPickMade(1, 'team-1', 'unknown-player-X');

    const pickFeed = screen.getByTestId('pick-feed-panel');
    expect(within(pickFeed).getByText('1.1 - unknown-player-X')).toBeInTheDocument();
    expect(within(pickFeed).queryByText('NA')).not.toBeInTheDocument();
  });

  // @spec DFF-UI-103
  test('renders em dash for round/pick when pick number is absent from draftOrder', async () => {
    const user = userEvent.setup();
    mockAppBootstrapAndDraftCreation();

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));

    // Emit a state_sync where draft_order does NOT include pick_number 1
    emitStateSync({
      current_pick_number: 1,
      draft_order: [
        { pick_number: 2, round: 1, pick_in_round: 2, team_id: 'team-2' },
        { pick_number: 3, round: 1, pick_in_round: 3, team_id: 'team-3' },
      ],
    });

    // Emit a pick_made for pick 1 which has no corresponding draft_order entry
    emitPickMade(1, 'team-1', 'player-1');

    const pickFeed = screen.getByTestId('pick-feed-panel');
    const entry = within(pickFeed).getByTestId('pick-feed-entry-1');

    // Entry should show the player name but em dash for round/pick
    expect(within(entry).getByText('— - Josh Allen')).toBeInTheDocument();
    expect(within(entry).queryByText(/rd 0/i)).not.toBeInTheDocument();
  });

  // @spec DFF-UI-103
  test('renders duplicate entries when the same player is picked twice (two pick_made events with same player_id)', async () => {
    const user = userEvent.setup();
    mockAppBootstrapAndDraftCreation();

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitStateSync();

    // First pick_made for player-1
    emitPickMade(1, 'team-1', 'player-1');

    // Second pick_made for the same player-1 at a different pick number
    emitPickMade(4, 'team-3', 'player-1');

    const pickFeed = screen.getByTestId('pick-feed-panel');
    const feedEntries = within(pickFeed).getAllByTestId(/^pick-feed-entry-/);

    // Both entries should exist
    expect(feedEntries).toHaveLength(2);

    // Both entries should reference Josh Allen
    expect(within(pickFeed).getByTestId('pick-feed-entry-1')).toBeInTheDocument();
    expect(within(pickFeed).getByTestId('pick-feed-entry-4')).toBeInTheDocument();

    // Each entry has the player name
    const nameElements = within(pickFeed).getAllByText(/Josh Allen/);
    expect(nameElements).toHaveLength(2);
  });

  // @spec DFF-UI-100
  test('pick feed panel renders alongside the draft board without replacing it', async () => {
    const user = userEvent.setup();
    mockAppBootstrapAndDraftCreation();

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitStateSync();

    // Both draft board and pick feed should be visible
    expect(screen.getByRole('heading', { name: /draft board/i })).toBeInTheDocument();
    expect(screen.getByTestId('pick-feed-panel')).toBeInTheDocument();

    const pickFeed = screen.getByTestId('pick-feed-panel');
    const scrollContainer = within(pickFeed).getByTestId('pick-feed-scroll-container');
    expect(scrollContainer.className).toContain('overflow-y-auto');
  });
});
