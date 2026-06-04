// @spec DFF-UI-031
// @spec DFF-UI-032
// @spec DFF-UI-033
// @spec DFF-UI-034
// @spec DFF-UI-035
// @spec DFF-UI-036
// @spec DFF-UI-080
// @spec DFF-UI-084
// @spec DFF-UI-120
// @spec DFF-UI-121
// @spec DFF-UI-122
// @spec DFF-UI-123
// @spec DFF-UI-124
// @spec DFF-UI-125
// @spec DFF-UI-126
// @spec DFF-UI-140
// @spec DFF-UI-141
// @spec DFF-UI-142
// @spec DFF-UI-143
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

type DeferredResponse = {
  promise: Promise<Response>;
  resolve: (value: Response) => void;
};

function createDeferredResponse(): DeferredResponse {
  let resolve: (value: Response) => void = () => undefined;
  const promise = new Promise<Response>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

function createDraftState(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    draft_id: 'draft-available-123',
    status: 'in_progress',
    current_pick_number: 2,
    teams: [
      { id: 'team-1', name: 'Bob', is_user: false, archetype: 'win_now' },
      { id: 'team-2', name: 'You', is_user: true, archetype: null },
      { id: 'team-3', name: 'Sue', is_user: false, archetype: 'balanced' },
    ],
    draft_order: [
      { pick_number: 1, round: 1, pick_in_round: 1, team_id: 'team-1' },
      { pick_number: 2, round: 1, pick_in_round: 2, team_id: 'team-2' },
      { pick_number: 3, round: 1, pick_in_round: 3, team_id: 'team-3' },
      { pick_number: 4, round: 2, pick_in_round: 1, team_id: 'team-3' },
    ],
    picks: [
      {
        pick_number: 1,
        team_id: 'team-1',
        player_id: 'player-picked',
        picked_at: '2026-05-27T10:00:00.000Z',
      },
    ],
    roster_players: [{ team_id: 'team-1', player_id: 'player-picked' }],
    team_pick_assets: [],
    user_queue: [],
    available_players: [
      {
        id: 'pick-2027-1st',
        name: '2027 1st',
        position: 'PICK',
        nfl_team: null,
        age: null,
        is_rookie: false,
        dynasty_value: 9100,
        adp: null,
      },
      {
        id: 'player-wr-1',
        name: 'CeeDee Lamb',
        position: 'WR',
        nfl_team: 'DAL',
        age: 27,
        is_rookie: false,
        dynasty_value: 9800,
        adp: 2,
      },
      {
        id: 'player-rb-1',
        name: 'Bijan Robinson',
        position: 'RB',
        nfl_team: 'ATL',
        age: 23,
        is_rookie: false,
        dynasty_value: 9700,
        adp: 3,
      },
      {
        id: 'player-qb-1',
        name: 'Josh Allen',
        position: 'QB',
        nfl_team: 'BUF',
        age: 30,
        is_rookie: false,
        dynasty_value: 9600,
        adp: 1,
      },
      {
        id: 'player-te-1',
        name: 'Brock Bowers',
        position: 'TE',
        nfl_team: 'LV',
        age: 22,
        is_rookie: false,
        dynasty_value: 8900,
        adp: 12,
      },
    ],
    trades: [],
    ...overrides,
  };
}

async function renderAppToConfig() {
  render(<App />);
  await screen.findByRole('heading', { name: /config screen/i });
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

describe('available players list', () => {
  // @spec DFF-UI-031
  // @spec DFF-UI-032
  // @spec DFF-UI-033
  // @spec DFF-UI-080
  // @spec DFF-UI-140
  // @spec DFF-UI-141
  // @spec DFF-UI-143
  test('hydrates from GET /drafts/:id/state with loading skeletons, sorted rows, a compact position filter control, and live name search', async () => {
    const user = userEvent.setup();
    const deferredState = createDeferredResponse();

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);

      if (url === '/drafts' && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }

      if (url === '/drafts' && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ draftId: 'draft-available-123' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      if (url === '/drafts/draft-available-123/state') {
        return deferredState.promise;
      }

      if (url === '/drafts/draft-available-123/queue') {
        return Promise.resolve(
          new Response(JSON.stringify([{ playerId: 'player-rb-1', rank: 1 }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await renderAppToConfig();
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    expect(await screen.findByTestId('available-players-loading')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/drafts/draft-available-123/state');

    deferredState.resolve(
      new Response(JSON.stringify(createDraftState()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const panel = await screen.findByTestId('available-players-panel');
    const availableTab = screen.getByRole('button', { name: /^available$/i });
    const targetsTab = screen.getByRole('button', { name: /^targets$/i });
    const rows = within(panel).getAllByTestId(/^available-player-row-/);

    expect(availableTab).toHaveAttribute('aria-pressed', 'true');
    expect(targetsTab).toHaveAttribute('aria-pressed', 'false');
    expect(targetsTab.className).toContain('border-stone-800');
    expect(availableTab.className).toContain('border-amber-300/40');
    expect(screen.queryByTestId('targets-panel')).not.toBeInTheDocument();

    expect(rows[0]).toHaveAttribute('data-player-id', 'player-wr-1');
    expect(rows[1]).toHaveAttribute('data-player-id', 'player-rb-1');
    expect(rows[2]).toHaveAttribute('data-player-id', 'player-qb-1');
    expect(rows[3]).toHaveAttribute('data-player-id', 'pick-2027-1st');
    expect(rows[4]).toHaveAttribute('data-player-id', 'player-te-1');

    expect(within(rows[0]).getByText('WR')).toBeInTheDocument();
    expect(within(rows[0]).getByText('DAL')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Age 27')).toBeInTheDocument();
    expect(within(rows[0]).getByText('9800')).toBeInTheDocument();

    const positionFilter = within(panel).getByRole('combobox', { name: /position filter/i });
    const filterOptions = within(positionFilter).getAllByRole('option');

    expect(filterOptions.map((option) => option.textContent)).toEqual(['ALL', 'QB', 'RB', 'WR', 'TE', 'Picks']);

    await user.selectOptions(positionFilter, 'RB');
    expect(within(panel).getAllByTestId(/^available-player-row-/)).toHaveLength(1);
    expect(within(panel).getByText('Bijan Robinson')).toBeInTheDocument();

    await user.selectOptions(positionFilter, 'Picks');
    expect(within(panel).getAllByTestId(/^available-player-row-/)).toHaveLength(1);
    expect(within(panel).getByText('2027 1st')).toBeInTheDocument();

    await user.selectOptions(positionFilter, 'ALL');
    await user.type(within(panel).getByRole('searchbox', { name: /search players/i }), 'bow');
    expect(within(panel).getAllByTestId(/^available-player-row-/)).toHaveLength(1);
    expect(within(panel).getByText('Brock Bowers')).toBeInTheDocument();
  });

  // @spec DFF-UI-120
  // @spec DFF-UI-121
  // @spec DFF-UI-122
  // @spec DFF-UI-125
  // @spec DFF-UI-140
  // @spec DFF-UI-142
  // @spec DFF-UI-143
  test('hydrates the targets panel from GET /drafts/:id/queue in ascending rank order with an empty state fallback', async () => {
    const user = userEvent.setup();

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);

      if (url === '/drafts' && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }

      if (url === '/drafts' && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ draftId: 'draft-available-123' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      if (url === '/drafts/draft-available-123/state') {
        return Promise.resolve(
          new Response(JSON.stringify(createDraftState()), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      if (url === '/drafts/draft-available-123/queue') {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { playerId: 'player-qb-1', rank: 2 },
              { playerId: 'player-rb-1', rank: 1 },
            ]),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await renderAppToConfig();
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    await user.click(await screen.findByRole('button', { name: /^targets$/i }));
    const panel = await screen.findByTestId('targets-panel');
    const rows = within(panel).getAllByTestId(/^target-player-row-/);

    expect(fetchMock).toHaveBeenCalledWith('/drafts/draft-available-123/queue');
    expect(rows[0]).toHaveAttribute('data-player-id', 'player-rb-1');
    expect(rows[1]).toHaveAttribute('data-player-id', 'player-qb-1');
    expect(within(rows[0]).getByText('Bijan Robinson')).toBeInTheDocument();
    expect(within(rows[0]).getByText('RB')).toBeInTheDocument();
    expect(within(rows[0]).getByText('9700')).toBeInTheDocument();

    act(() => {
      MockEventSource.instances[0]?.emit('state_sync', createDraftState({ user_queue: [] }));
    });

    expect(within(panel).getByText('No targets added yet')).toBeInTheDocument();
  });

  // @spec DFF-UI-121
  // @spec DFF-UI-125
  // @spec DFF-UI-142
  test('keeps the draft room usable and shows an empty targets panel when queue hydration fails', async () => {
    const user = userEvent.setup();

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);

      if (url === '/drafts' && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }

      if (url === '/drafts' && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ draftId: 'draft-available-123' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      if (url === '/drafts/draft-available-123/state') {
        return Promise.resolve(
          new Response(JSON.stringify(createDraftState()), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      if (url === '/drafts/draft-available-123/queue') {
        return Promise.resolve(new Response(null, { status: 500 }));
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await renderAppToConfig();
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    const playersPanel = await screen.findByTestId('available-players-panel');
    expect(within(playersPanel).getByText('CeeDee Lamb')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^targets$/i }));
    const targetsPanel = await screen.findByTestId('targets-panel');

    expect(within(targetsPanel).getByText('No targets added yet')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load draft queue.');
  });

  // @spec DFF-UI-121
  // @spec DFF-UI-125
  // @spec DFF-UI-142
  test('omits stale queued players that are absent from available players and the player catalog', async () => {
    const user = userEvent.setup();

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);

      if (url === '/drafts' && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }

      if (url === '/drafts' && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ draftId: 'draft-available-123' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      if (url === '/drafts/draft-available-123/state') {
        return Promise.resolve(
          new Response(
            JSON.stringify(
              createDraftState({
                picks: [
                  {
                    pick_number: 1,
                    team_id: 'team-1',
                    player_id: 'player-picked',
                    picked_at: '2026-05-27T10:00:00.000Z',
                  },
                ],
              }),
            ),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        );
      }

      if (url === '/drafts/draft-available-123/queue') {
        return Promise.resolve(
          new Response(JSON.stringify([{ playerId: 'player-missing', rank: 1 }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await renderAppToConfig();
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    await user.click(screen.getByRole('button', { name: /^targets$/i }));
    const panel = await screen.findByTestId('targets-panel');
    expect(within(panel).queryAllByTestId(/^target-player-row-/)).toHaveLength(0);
    expect(within(panel).getByText('No targets added yet')).toBeInTheDocument();
    expect(within(panel).queryByText('player-missing')).not.toBeInTheDocument();
  });

  // @spec DFF-UI-034
  test('removes the picked player from the list when a pick_made SSE event arrives', async () => {
    const user = userEvent.setup();

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);

      if (url === '/drafts' && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }

      if (url === '/drafts' && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ draftId: 'draft-available-123' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      if (url === '/drafts/draft-available-123/state') {
        return Promise.resolve(
          new Response(JSON.stringify(createDraftState()), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      if (url === '/drafts/draft-available-123/queue') {
        return Promise.resolve(
          new Response(JSON.stringify([{ playerId: 'player-rb-1', rank: 1 }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await renderAppToConfig();
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    const panel = await screen.findByTestId('available-players-panel');
    expect(within(panel).getByText('Bijan Robinson')).toBeInTheDocument();

    act(() => {
      MockEventSource.instances[0]?.emit('pick_made', {
        pick_number: 2,
        team_id: 'team-2',
        player_id: 'player-rb-1',
        is_bot: false,
      });
    });

    expect(within(panel).queryByText('Bijan Robinson')).not.toBeInTheDocument();
  });

  // @spec DFF-UI-124
  // @spec DFF-UI-142
  test('removes the picked player from the targets panel when a pick_made SSE event arrives', async () => {
    const user = userEvent.setup();

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);

      if (url === '/drafts' && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }

      if (url === '/drafts' && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ draftId: 'draft-available-123' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      if (url === '/drafts/draft-available-123/state') {
        return Promise.resolve(
          new Response(JSON.stringify(createDraftState()), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      if (url === '/drafts/draft-available-123/queue') {
        return Promise.resolve(
          new Response(JSON.stringify([{ playerId: 'player-rb-1', rank: 1 }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await renderAppToConfig();
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    await user.click(screen.getByRole('button', { name: /^targets$/i }));
    const panel = await screen.findByTestId('targets-panel');
    expect(within(panel).getByText('Bijan Robinson')).toBeInTheDocument();

    act(() => {
      MockEventSource.instances[0]?.emit('pick_made', {
        pick_number: 2,
        team_id: 'team-2',
        player_id: 'player-rb-1',
        is_bot: false,
      });
    });

    expect(within(panel).queryByText('Bijan Robinson')).not.toBeInTheDocument();
    expect(within(panel).getByText('No targets added yet')).toBeInTheDocument();
  });

  // @spec DFF-UI-034
  // @spec DFF-UI-080
  test('preserves server-truth available players when pick_made arrives before hydration completes', async () => {
    const user = userEvent.setup();
    const deferredState = createDeferredResponse();

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);

      if (url === '/drafts' && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }

      if (url === '/drafts' && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ draftId: 'draft-available-123' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      if (url === '/drafts/draft-available-123/state') {
        return deferredState.promise;
      }

      if (url === '/drafts/draft-available-123/queue') {
        return Promise.resolve(
          new Response(JSON.stringify([{ playerId: 'player-rb-1', rank: 1 }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await renderAppToConfig();
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    expect(await screen.findByTestId('available-players-loading')).toBeInTheDocument();

    act(() => {
      MockEventSource.instances[0]?.emit('pick_made', {
        pick_number: 2,
        team_id: 'team-2',
        player_id: 'player-rb-1',
        is_bot: false,
      });
    });

    deferredState.resolve(
      new Response(JSON.stringify(createDraftState()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const panel = await screen.findByTestId('available-players-panel');
    expect(within(panel).getByText('Bijan Robinson')).toBeInTheDocument();
    expect(within(panel).getByText('CeeDee Lamb')).toBeInTheDocument();
  });

  // @spec DFF-UI-035
  // @spec DFF-UI-036
  // @spec DFF-UI-123
  // @spec DFF-UI-126
  // @spec DFF-UI-139
  // @spec DFF-UI-140
  // @spec DFF-UI-142
  test('shows disabled rows during bot turns, then uses the shared confirmation flow for available players and targets on the user turn', async () => {
    const user = userEvent.setup();

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);

      if (url === '/drafts' && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }

      if (url === '/drafts' && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ draftId: 'draft-available-123' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      if (url === '/drafts/draft-available-123/state') {
        return Promise.resolve(
          new Response(
            JSON.stringify(
              createDraftState({
                current_pick_number: 1,
              }),
            ),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        );
      }

      if (url === '/drafts/draft-available-123/queue') {
        return Promise.resolve(
          new Response(JSON.stringify([{ playerId: 'player-rb-1', rank: 1 }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      if (url === '/drafts/draft-available-123/pick' && init?.method === 'POST') {
        return Promise.resolve(new Response(null, { status: 200 }));
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await renderAppToConfig();
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    const panel = await screen.findByTestId('available-players-panel');
    const statusBar = await screen.findByTestId('draft-status-bar');
    expect(within(statusBar).getByText('Bob')).toBeInTheDocument();
    expect(within(panel).queryByText('Bot is picking…')).not.toBeInTheDocument();

    const lambRow = within(panel).getByRole('button', { name: /ceedee lamb/i });
    expect(lambRow).toBeDisabled();
    await user.click(lambRow);
    await user.click(screen.getByRole('button', { name: /^targets$/i }));
    const disabledTargetsPanel = await screen.findByTestId('targets-panel');
    expect(within(disabledTargetsPanel).queryByText('Bot is picking…')).not.toBeInTheDocument();
    const bijanTargetRow = within(disabledTargetsPanel).getByRole('button', { name: /bijan robinson/i });
    expect(bijanTargetRow).toBeDisabled();
    await user.click(bijanTargetRow);
    await user.click(screen.getByRole('button', { name: /^available$/i }));
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/drafts/draft-available-123/pick',
      expect.objectContaining({ method: 'POST' }),
    );

    act(() => {
      MockEventSource.instances[0]?.emit('your_turn', {
        pick_number: 2,
        round: 1,
        pick_in_round: 2,
      });
    });

    const availablePanelOnUserTurn = await screen.findByTestId('available-players-panel');
    const enabledRow = within(availablePanelOnUserTurn).getByRole('button', { name: /ceedee lamb/i });
    expect(enabledRow).toBeEnabled();

    await user.click(enabledRow);
    const confirmationCard = await screen.findByTestId('pick-confirmation-card');
    expect(within(confirmationCard).getByText('CeeDee Lamb')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/drafts/draft-available-123/pick',
      expect.objectContaining({ method: 'POST' }),
    );
    await user.click(within(confirmationCard).getByRole('button', { name: /confirm pick/i }));

    await user.click(screen.getByRole('button', { name: /^targets$/i }));
    const targetsPanel = await screen.findByTestId('targets-panel');
    expect(within(targetsPanel).queryByText('Bot is picking…')).not.toBeInTheDocument();
    const enabledTargetRow = within(targetsPanel).getByRole('button', { name: /bijan robinson/i });
    expect(enabledTargetRow).toBeEnabled();
    await user.click(enabledTargetRow);
    expect(within(await screen.findByTestId('pick-confirmation-card')).getByText('Bijan Robinson')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /confirm pick/i }));

    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      '/drafts/draft-available-123/pick',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ playerId: 'player-wr-1' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      7,
      '/drafts/draft-available-123/pick',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ playerId: 'player-rb-1' }),
      }),
    );
  });

  // @spec DFF-UI-084
  test('shows the failed pick toast when the pick submission returns an error', async () => {
    const user = userEvent.setup();

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);

      if (url === '/drafts' && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }

      if (url === '/drafts' && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ draftId: 'draft-available-123' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      if (url === '/drafts/draft-available-123/state') {
        return Promise.resolve(
          new Response(JSON.stringify(createDraftState()), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      if (url === '/drafts/draft-available-123/queue') {
        return Promise.resolve(
          new Response(JSON.stringify([{ playerId: 'player-rb-1', rank: 1 }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      if (url === '/drafts/draft-available-123/pick' && init?.method === 'POST') {
        return Promise.resolve(new Response(null, { status: 409 }));
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await renderAppToConfig();
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    const panel = await screen.findByTestId('available-players-panel');
    await user.click(within(panel).getByRole('button', { name: /ceedee lamb/i }));
    await user.click(await screen.findByRole('button', { name: /confirm pick/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Pick failed — player may already be taken.');
  });

  // @spec DFF-UI-080
  // @spec DFF-UI-119
  test('returns to config with an error toast when initial draft-state hydration fails after draft creation', async () => {
    const user = userEvent.setup();

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);

      if (url === '/drafts' && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }

      if (url === '/drafts' && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ draftId: 'draft-available-123' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      if (url === '/drafts/draft-available-123/state') {
        return Promise.resolve(new Response(null, { status: 500 }));
      }

      if (url === '/drafts/draft-available-123/queue') {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await renderAppToConfig();
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load draft state.');
    expect(await screen.findByRole('heading', { name: /config screen/i })).toBeInTheDocument();
    expect(screen.queryByTestId('available-players-loading')).not.toBeInTheDocument();
  });
});
