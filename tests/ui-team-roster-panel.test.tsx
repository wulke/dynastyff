// @spec DFF-UI-187
// @spec DFF-UI-188
// @spec DFF-UI-189
// @spec DFF-UI-190
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

// @spec DFF-UI-187
// @spec DFF-UI-188
// @spec DFF-UI-189
// @spec DFF-UI-190
function mockAppBootstrapAndDraftCreation(draftId = 'draft-roster-123') {
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

    throw new Error(`Unhandled fetch in ui-team-roster-panel test: ${method} ${url}`);
  });
}

async function renderAppToDraft() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('heading', { name: /config screen/i });
  await user.click(screen.getByRole('button', { name: /start draft/i }));
  return user;
}

// @spec DFF-UI-187
// @spec DFF-UI-188
// @spec DFF-UI-189
function emitStateSync(overrides: Partial<Record<string, unknown>> = {}) {
  act(() => {
    MockEventSource.instances[0]?.emit('state_sync', {
      draft_id: 'draft-roster-123',
      status: 'in_progress',
      current_pick_number: 6,
      teams: [
        { id: 'team-1', name: 'Bot Alpha', is_user: false, archetype: 'win_now' },
        { id: 'team-2', name: 'Your Team', is_user: true, archetype: null },
        { id: 'team-3', name: 'Bot Gamma', is_user: false, archetype: 'productive_struggle' },
      ],
      draft_order: [
        { pick_number: 1, round: 1, pick_in_round: 1, team_id: 'team-1' },
        { pick_number: 2, round: 1, pick_in_round: 2, team_id: 'team-2' },
        { pick_number: 3, round: 1, pick_in_round: 3, team_id: 'team-3' },
        { pick_number: 4, round: 2, pick_in_round: 1, team_id: 'team-3' },
        { pick_number: 5, round: 2, pick_in_round: 2, team_id: 'team-2' },
        { pick_number: 6, round: 2, pick_in_round: 3, team_id: 'team-1' },
      ],
      picks: [
        { pick_number: 5, team_id: 'team-2', player_id: 'player-2', picked_at: '2026-06-30T12:05:00.000Z' },
        { pick_number: 2, team_id: 'team-2', player_id: 'player-1', picked_at: '2026-06-30T12:02:00.000Z' },
        { pick_number: 1, team_id: 'team-1', player_id: 'player-3', picked_at: '2026-06-30T12:01:00.000Z' },
      ],
      roster_players: [
        { team_id: 'team-2', player_id: 'player-1' },
        { team_id: 'team-2', player_id: 'player-2' },
        { team_id: 'team-1', player_id: 'player-3' },
      ],
      team_pick_assets: [],
      user_queue: [],
      available_players: [
        {
          id: 'player-4',
          name: 'Trey Benson',
          position: 'RB',
          nfl_team: 'ARI',
          age: 22,
          is_rookie: false,
          dynasty_value: 4700,
          adp: 44,
        },
        {
          id: 'player-5',
          name: 'Caleb Williams',
          position: 'QB',
          nfl_team: 'CHI',
          age: 24,
          is_rookie: false,
          dynasty_value: 8300,
          adp: 8,
        },
      ],
      drafted_players: [
        {
          id: 'player-1',
          name: 'CeeDee Lamb',
          position: 'WR',
          nfl_team: 'DAL',
          age: 27,
          is_rookie: false,
          dynasty_value: 9100,
          adp: 2,
        },
        {
          id: 'player-2',
          name: 'Brock Bowers',
          position: 'TE',
          nfl_team: 'LV',
          age: 23,
          is_rookie: false,
          dynasty_value: 7800,
          adp: 14,
        },
        {
          id: 'player-3',
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

// @spec DFF-UI-190
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

describe('TeamRosterPanel', () => {
  // @spec DFF-UI-187
  // @spec DFF-UI-188
  // @spec DFF-UI-189
  test('renders in the Roster tab with the user team preselected and chronological pick rows', async () => {
    mockAppBootstrapAndDraftCreation();
    const user = await renderAppToDraft();

    emitStateSync();

    await user.click(screen.getByRole('tab', { name: /^roster$/i }));

    const rosterPanel = screen.getByTestId('team-roster-panel');
    const teamSelect = within(rosterPanel).getByRole('combobox', { name: /team/i });
    expect(teamSelect).toHaveValue('team-2');

    const options = within(teamSelect).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Bot Alpha', 'Your Team', 'Bot Gamma']);

    const rosterRows = within(rosterPanel).getAllByTestId(/team-roster-entry-/);
    expect(rosterRows).toHaveLength(2);
    expect(rosterRows[0]).toHaveTextContent('1.02');
    expect(rosterRows[0]).toHaveTextContent('CeeDee Lamb');
    expect(rosterRows[0]).toHaveTextContent('WR');
    expect(rosterRows[0]).toHaveTextContent('9100');
    expect(rosterRows[1]).toHaveTextContent('2.02');
    expect(rosterRows[1]).toHaveTextContent('Brock Bowers');
    expect(rosterRows[1]).toHaveTextContent('TE');
    expect(rosterRows[1]).toHaveTextContent('7800');
  });

  // @spec DFF-UI-188
  // @spec DFF-UI-189
  test('switches teams immediately and shows the empty state when the selected team has no picks', async () => {
    mockAppBootstrapAndDraftCreation();
    const user = await renderAppToDraft();

    emitStateSync();

    await user.click(screen.getByRole('tab', { name: /^roster$/i }));

    const rosterPanel = screen.getByTestId('team-roster-panel');
    const teamSelect = within(rosterPanel).getByRole('combobox', { name: /team/i });

    await user.selectOptions(teamSelect, 'team-3');

    expect(within(rosterPanel).getByText('No picks yet')).toBeInTheDocument();
    expect(within(rosterPanel).queryByTestId(/team-roster-entry-/)).not.toBeInTheDocument();
  });

  // @spec DFF-UI-189
  // @spec DFF-UI-190
  test('updates in real time for the selected team and ignores other-team picks in the visible roster list', async () => {
    mockAppBootstrapAndDraftCreation();
    const user = await renderAppToDraft();

    emitStateSync();

    await user.click(screen.getByRole('tab', { name: /^roster$/i }));

    const rosterPanel = screen.getByTestId('team-roster-panel');
    expect(within(rosterPanel).getAllByTestId(/team-roster-entry-/)).toHaveLength(2);

    emitPickMade(6, 'team-1', 'player-5');
    expect(within(rosterPanel).getAllByTestId(/team-roster-entry-/)).toHaveLength(2);
    expect(within(rosterPanel).queryByText('Caleb Williams')).not.toBeInTheDocument();

    emitPickMade(4, 'team-2', 'player-4');
    const rosterRows = within(rosterPanel).getAllByTestId(/team-roster-entry-/);

    expect(rosterRows).toHaveLength(3);
    expect(rosterRows[1]).toHaveTextContent('2.01');
    expect(rosterRows[1]).toHaveTextContent('Trey Benson');
    expect(rosterRows[2]).toHaveTextContent('2.02');
  });
});
