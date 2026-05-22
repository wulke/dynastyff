// @spec DFF-UI-060
// @spec DFF-UI-061
// @spec DFF-UI-062
// @spec DFF-UI-063
// @spec DFF-UI-064
// @spec DFF-UI-065
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

// @spec DFF-UI-060
// @spec DFF-UI-061
// @spec DFF-UI-062
// @spec DFF-UI-063
// @spec DFF-UI-064
// @spec DFF-UI-065
function emitStateSyncWithHistoryData() {
  act(() => {
    MockEventSource.instances[0]?.emit('state_sync', {
      draft_id: 'history-draft-1',
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
        { id: 'player-1', name: 'Josh Allen', position: 'QB', nfl_team: 'BUF', age: 30, is_rookie: false, dynasty_value: 9999, adp: 1 },
        { id: 'player-2', name: 'Bijan Robinson', position: 'RB', nfl_team: 'ATL', age: 23, is_rookie: false, dynasty_value: 9500, adp: 2 },
        { id: 'player-3', name: 'Justin Jefferson', position: 'WR', nfl_team: 'MIN', age: 26, is_rookie: false, dynasty_value: 9700, adp: 3 },
        { id: 'player-4', name: 'Brock Bowers', position: 'TE', nfl_team: 'LV', age: 22, is_rookie: false, dynasty_value: 8800, adp: 10 },
      ],
    });
  });
}

// @spec DFF-UI-060
// @spec DFF-UI-061
// @spec DFF-UI-062
// @spec DFF-UI-063
// @spec DFF-UI-064
// @spec DFF-UI-065
function simulateCompleteDraft() {
  // Simulate all picks being made
  const picks = [
    { pick_number: 1, team_id: 'team-1', player_id: 'player-1', is_bot: true },
    { pick_number: 2, team_id: 'team-2', player_id: 'player-2', is_bot: false },
    { pick_number: 3, team_id: 'team-3', player_id: 'player-3', is_bot: true },
    { pick_number: 4, team_id: 'team-3', player_id: 'player-4', is_bot: true },
  ];

  for (const pick of picks) {
    act(() => {
      MockEventSource.instances[0]?.emit('pick_made', pick);
    });
  }

  // Emit trade offered and resolved
  act(() => {
    MockEventSource.instances[0]?.emit('trade_offered', {
      trade_id: 'trade-1',
      initiating_team_id: 'team-1',
      receiving_team_id: 'team-3',
      assets_sent: [{ type: 'player', player_id: 'player-1' }],
      assets_received: [{ type: 'future_pick', year: 2027, round: 1 }],
      is_bot_to_bot: true,
    });
  });

  act(() => {
    MockEventSource.instances[0]?.emit('trade_resolved', {
      trade_id: 'trade-1',
      status: 'accepted',
      assets_sent: [{ type: 'player', player_id: 'player-1' }],
      assets_received: [{ type: 'future_pick', year: 2027, round: 1 }],
    });
  });

  // Emit draft complete
  act(() => {
    MockEventSource.instances[0]?.emit('draft_complete', {
      draft_id: 'history-draft-1',
      completed_at: '2026-05-22T18:00:00.000Z',
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

describe('draft history view', () => {
  // @spec DFF-UI-060
  // @spec DFF-UI-065
  test('renders history view after draft_complete with three tab pills and a New Draft button', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'history-draft-1' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(<App />);

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitStateSyncWithHistoryData();
    simulateCompleteDraft();
    await user.click(screen.getByRole('button', { name: /view full history/i }));

    // @spec DFF-UI-060 - three tab pills
    expect(screen.getByRole('tab', { name: /pick log/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /roster view/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /trade log/i })).toBeInTheDocument();

    // @spec DFF-UI-065 - New Draft button
    expect(screen.getByRole('button', { name: /new draft/i })).toBeInTheDocument();
  });

  // @spec DFF-UI-060
  // @spec DFF-UI-061
  test('pick log tab shows all picks in chronological order with round, pick number, team, player, position, and value', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'history-draft-1' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(<App />);

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitStateSyncWithHistoryData();
    simulateCompleteDraft();
    await user.click(screen.getByRole('button', { name: /view full history/i }));

    // The Pick Log tab should be visible by default
    const pickLogTab = screen.getByRole('tab', { name: /pick log/i });
    expect(pickLogTab).toBeInTheDocument();

    // Check that picks are listed
    const pickLogPanel = screen.getByRole('tabpanel', { name: /pick log/i });

    // First pick: Round 1, Pick 1, Bob, Josh Allen, QB, 9999
    const firstPickRow = within(pickLogPanel).getByTestId('history-pick-1');
    const firstPickCells = firstPickRow.querySelectorAll('td');
    expect(firstPickCells[0]?.textContent).toBe('1');
    expect(firstPickCells[1]?.textContent).toBe('1');
    expect(firstPickCells[2]?.textContent).toBe('Bob');
    expect(firstPickCells[3]?.textContent).toBe('Josh Allen');
    expect(firstPickCells[4]?.textContent).toContain('QB');
    expect(firstPickCells[5]?.textContent).toContain('9,999');

    // Second pick: Round 1, Pick 2, You, Bijan Robinson, RB, 9500
    const secondPickRow = within(pickLogPanel).getByTestId('history-pick-2');
    const secondPickCells = secondPickRow.querySelectorAll('td');
    expect(secondPickCells[2]?.textContent).toBe('You');
    expect(secondPickCells[3]?.textContent).toBe('Bijan Robinson');
    expect(secondPickCells[4]?.textContent).toContain('RB');
    expect(secondPickCells[5]?.textContent).toContain('9,500');

    // Fourth pick should be round 2, pick_in_round 1
    const fourthPickRow = within(pickLogPanel).getByTestId('history-pick-4');
    const fourthPickCells = fourthPickRow.querySelectorAll('td');
    expect(fourthPickCells[0]?.textContent).toBe('2');
  });

  // @spec DFF-UI-060
  // @spec DFF-UI-062
  // @spec DFF-UI-063
  test('roster view tab shows one card per team with players grouped by position and user team highlighted', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'history-draft-1' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(<App />);

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitStateSyncWithHistoryData();
    simulateCompleteDraft();
    await user.click(screen.getByRole('button', { name: /view full history/i }));

    // Switch to Roster View tab
    await user.click(screen.getByRole('tab', { name: /roster view/i }));

    const rosterPanel = screen.getByRole('tabpanel', { name: /roster view/i });

    // Check team cards exist
    expect(within(rosterPanel).getByTestId('history-team-card-team-1')).toBeInTheDocument();
    expect(within(rosterPanel).getByTestId('history-team-card-team-2')).toBeInTheDocument();
    expect(within(rosterPanel).getByTestId('history-team-card-team-3')).toBeInTheDocument();

    // User team (team-2) is highlighted
    const userCard = within(rosterPanel).getByTestId('history-team-card-team-2');
    expect(userCard.getAttribute('data-user-team')).toBe('true');

    // Team-1 (Bob) has Josh Allen (QB) — Rd 1 drafted, value 9,999
    const bobCard = within(rosterPanel).getByTestId('history-team-card-team-1');
    expect(within(bobCard).getByText('Josh Allen')).toBeInTheDocument();
    expect(within(bobCard).getByText('Rd 1')).toBeInTheDocument();
    expect(within(bobCard).getByText('9,999')).toBeInTheDocument();
    expect(within(bobCard).getByText('QB')).toBeInTheDocument();

    // Team-2 (You) has Bijan Robinson (RB) — Rd 1 drafted, value 9,500
    const youCard = within(rosterPanel).getByTestId('history-team-card-team-2');
    expect(within(youCard).getByText('Bijan Robinson')).toBeInTheDocument();
    expect(within(youCard).getByText('Rd 1')).toBeInTheDocument();
    expect(within(youCard).getByText('9,500')).toBeInTheDocument();
    expect(within(youCard).getByText('RB')).toBeInTheDocument();

    // Team-3 (Sue) has Justin Jefferson (WR) — Rd 1 drafted, and Brock Bowers (TE) — Rd 2 drafted
    const sueCard = within(rosterPanel).getByTestId('history-team-card-team-3');
    expect(within(sueCard).getByText('Justin Jefferson')).toBeInTheDocument();
    expect(within(sueCard).getByText('Brock Bowers')).toBeInTheDocument();
    expect(within(sueCard).getByText('Rd 1')).toBeInTheDocument();
    expect(within(sueCard).getByText('Rd 2')).toBeInTheDocument();
    expect(within(sueCard).getByText('9,700')).toBeInTheDocument();
    expect(within(sueCard).getByText('8,800')).toBeInTheDocument();
    expect(within(sueCard).getByText('WR')).toBeInTheDocument();
    expect(within(sueCard).getByText('TE')).toBeInTheDocument();
  });

  // @spec DFF-UI-060
  // @spec DFF-UI-064
  test('trade log tab shows trades with teams, assets exchanged, and outcome', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'history-draft-1' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(<App />);

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitStateSyncWithHistoryData();
    simulateCompleteDraft();
    await user.click(screen.getByRole('button', { name: /view full history/i }));

    // Switch to Trade Log tab
    await user.click(screen.getByRole('tab', { name: /trade log/i }));

    const tradePanel = screen.getByRole('tabpanel', { name: /trade log/i });

    // Trade should show round, initiating team, receiving team, resolved assets, and outcome
    const tradeRow = within(tradePanel).getByTestId('history-trade-trade-1');
    expect(tradeRow).toBeInTheDocument();

    // Round derived from currentPickNumber at trade time
    expect(within(tradeRow).getByText('2')).toBeInTheDocument();

    // Team names
    expect(within(tradeRow).getByText('Bob')).toBeInTheDocument();
    expect(within(tradeRow).getByText('Sue')).toBeInTheDocument();

    // Assets sent: player name resolved via catalog
    expect(within(tradeRow).getByText('Josh Allen')).toBeInTheDocument();

    // Assets received: future pick formatted
    expect(within(tradeRow).getByText('2027 Rd 1')).toBeInTheDocument();

    // Outcome badge
    expect(within(tradeRow).getByText(/accepted/i)).toBeInTheDocument();
  });

  // @spec DFF-UI-065
  test('new draft button transitions back to config screen', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'history-draft-1' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(<App />);

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitStateSyncWithHistoryData();
    simulateCompleteDraft();
    await user.click(screen.getByRole('button', { name: /view full history/i }));

    // Click New Draft button
    await user.click(screen.getByRole('button', { name: /new draft/i }));

    // Should be back on config screen
    expect(screen.getByRole('heading', { name: /config screen/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start draft/i })).toBeInTheDocument();
  });

  // @spec DFF-UI-060
  // @spec DFF-UI-061
  test('pick log tab is the default active tab', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'history-draft-1' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(<App />);

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    emitStateSyncWithHistoryData();
    simulateCompleteDraft();
    await user.click(screen.getByRole('button', { name: /view full history/i }));

    // Pick Log tabpanel should be visible by default
    expect(screen.getByRole('tabpanel', { name: /pick log/i })).toBeInTheDocument();
    expect(screen.queryByRole('tabpanel', { name: /roster view/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tabpanel', { name: /trade log/i })).not.toBeInTheDocument();
  });

  // @spec DFF-UI-060
  // @spec DFF-UI-061
  // @spec DFF-UI-062
  // @spec DFF-UI-064
  test('renders empty-state messages in all three tabs when no data exists', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'history-empty-1' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(<App />);

    await user.click(screen.getByRole('button', { name: /start draft/i }));

    // Emit state_sync with no picks, no roster players, no trades
    act(() => {
      MockEventSource.instances[0]?.emit('state_sync', {
        draft_id: 'history-empty-1',
        status: 'in_progress',
        current_pick_number: null,
        teams: [
          { id: 'team-1', name: 'You', is_user: true, archetype: null },
        ],
        draft_order: [],
        picks: [],
        roster_players: [],
        team_pick_assets: [],
        user_queue: [],
        available_players: [],
      });
    });

    act(() => {
      MockEventSource.instances[0]?.emit('draft_complete', {
        draft_id: 'history-empty-1',
        completed_at: '2026-05-22T19:00:00.000Z',
      });
    });

    await user.click(screen.getByRole('button', { name: /view full history/i }));

    // Pick Log — empty state
    expect(screen.getByText('No picks recorded for this draft.')).toBeInTheDocument();

    // Roster View — team card exists but has no roster players; all positions show em dash
    await user.click(screen.getByRole('tab', { name: /roster view/i }));
    const rosterPanel = screen.getByRole('tabpanel', { name: /roster view/i });
    const teamCard = within(rosterPanel).getByTestId('history-team-card-team-1');
    expect(teamCard).toBeInTheDocument();
    // Each empty position group shows em dash — verify across all four positions
    expect(within(teamCard).getAllByText('—')).toHaveLength(4);

    // Trade Log — empty state
    await user.click(screen.getByRole('tab', { name: /trade log/i }));
    expect(screen.getByText('No trades occurred during this draft.')).toBeInTheDocument();
  });
});
