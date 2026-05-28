// @spec DFF-UI-001
// @spec DFF-UI-002
// @spec DFF-UI-003
// @spec DFF-UI-005
// @spec DFF-UI-006
// @spec DFF-UI-007
// @spec DFF-UI-004
// @spec DFF-UI-010
// @spec DFF-UI-014
// @spec DFF-UI-015
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { App } from '../src/ui/App.js';

const fetchMock = vi.fn<typeof fetch>();

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>();

  constructor(_url: string | URL) {
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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}

function createDraftingState(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    draft_id: 'draft-123',
    status: 'in_progress',
    current_pick_number: 2,
    teams: [
      { id: 'team-1', name: 'Bot Alpha', is_user: false, archetype: 'win_now' },
      { id: 'team-2', name: 'Lakeview Legends', is_user: true, archetype: null },
      { id: 'team-3', name: 'Bot Gamma', is_user: false, archetype: 'balanced' },
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
      {
        pick_number: 1,
        team_id: 'team-1',
        player_id: 'player-picked',
        picked_at: '2026-05-27T10:00:00.000Z',
      },
    ],
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
  };
}

// @spec DFF-UI-014
// @spec DFF-UI-015
function setupEmptyDraftsFetch() {
  // Default: GET /drafts returns empty array so the app shows the config screen.
  // Individual tests override this with their own mockResolvedValue/mockResolvedValueOnce.
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  MockEventSource.instances = [];
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
  setupEmptyDraftsFetch();
});

// @spec DFF-UI-014
// @spec DFF-UI-015
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function renderAppToConfig() {
  render(<App />);
  await screen.findByRole('heading', { name: /config screen/i });
}

describe('UI app scaffold', () => {
  // @spec DFF-UI-001
  // @spec DFF-UI-010
  test('renders the config screen with the expected default draft fields', async () => {
    await renderAppToConfig();

    expect(screen.getByLabelText(/config name/i)).toHaveValue('');
    expect(screen.getByLabelText(/team count/i)).toHaveValue(12);
    expect(screen.getByLabelText(/^rounds$/i)).toHaveValue(20);
    expect(screen.getByLabelText(/scoring format/i)).toHaveValue('ppr');
    expect(screen.getByLabelText(/^qb$/i)).toHaveValue(1);
    expect(screen.getByLabelText(/^rb$/i)).toHaveValue(2);
    expect(screen.getByLabelText(/^wr$/i)).toHaveValue(3);
    expect(screen.getByLabelText(/^te$/i)).toHaveValue(1);
    expect(screen.getByLabelText(/^flex$/i)).toHaveValue(1);
    expect(screen.getByLabelText(/^sf$/i)).toHaveValue(1);
    expect(screen.getByLabelText(/^bn$/i)).toHaveValue(6);
    expect(screen.getByLabelText(/pick position/i)).toHaveValue(6);
    expect(screen.getByLabelText(/future pick years/i)).toHaveValue(3);
  });

  // @spec DFF-UI-002
  // @spec DFF-UI-014
  test('posts the current form values and transitions to drafting when a draft is created', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    await renderAppToConfig();

    await user.type(screen.getByLabelText(/config name/i), 'Startup Lab');
    await user.clear(screen.getByLabelText(/team count/i));
    await user.type(screen.getByLabelText(/team count/i), '10');
    await user.selectOptions(screen.getByLabelText(/scoring format/i), 'half_ppr');
    await user.clear(screen.getByLabelText(/^wr$/i));
    await user.type(screen.getByLabelText(/^wr$/i), '4');
    await user.clear(screen.getByLabelText(/pick position/i));
    await user.type(screen.getByLabelText(/pick position/i), '3');
    await user.clear(screen.getByLabelText(/future pick years/i));
    await user.type(screen.getByLabelText(/future pick years/i), '2');
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/drafts',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          configName: 'Startup Lab',
          teamCount: 10,
          rounds: 20,
          scoringFormat: 'half_ppr',
          pickPosition: 3,
          futurePickYears: 2,
          rosterSlots: {
            QB: 1,
            RB: 2,
            WR: 4,
            TE: 1,
            FLEX: 1,
            SF: 1,
            BN: 6,
          },
        }),
      }),
    );
    expect(
      screen.getByRole('heading', {
        name: /draft board/i,
      }),
    ).toBeInTheDocument();
  });

  // @spec DFF-UI-130
  // @spec DFF-UI-131
  // @spec DFF-UI-138
  // @spec DFF-UI-139
  test('renders the drafting status bar and three weighted columns with a single turn-status surface', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    await renderAppToConfig();
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    act(() => {
      MockEventSource.instances[0]?.emit('state_sync', createDraftingState());
    });

    const statusBar = await screen.findByTestId('draft-status-bar');
    expect(statusBar).toHaveTextContent('Pick 2 of 6');
    expect(statusBar).toHaveTextContent('Your turn');

    const layout = screen.getByTestId('drafting-layout');
    expect(layout.className).toContain('xl:grid');
    expect(layout.className).toContain('xl:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)]');

    const draftBoardColumn = screen.getByTestId('draft-board-column');
    const availablePlayersColumn = screen.getByTestId('available-players-column');
    const pickFeedColumn = screen.getByTestId('pick-feed-column');
    expect(within(draftBoardColumn).getByRole('heading', { name: /draft board/i })).toBeInTheDocument();
    expect(within(availablePlayersColumn).getByRole('heading', { name: /available players/i })).toBeInTheDocument();
    expect(within(pickFeedColumn).getByRole('heading', { name: /pick feed/i })).toBeInTheDocument();

    expect(screen.getByText(/^Your turn$/i)).toBe(statusBar.querySelector('[data-testid="draft-status-turn"]'));
    expect(screen.queryByText(/bot is picking…/i)).not.toBeInTheDocument();
  });

  // @spec DFF-UI-132
  // @spec DFF-UI-133
  // @spec DFF-UI-134
  // @spec DFF-UI-135
  // @spec DFF-UI-136
  // @spec DFF-UI-137
  test('supports single-column expansion with collapsed strips and a 200ms layout transition', async () => {
    const user = userEvent.setup();
    const localStorageSetItemSpy = vi.spyOn(Storage.prototype, 'setItem');
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
          new Response(JSON.stringify({ draftId: 'draft-123' }), {
            status: 201,
            headers: {
              'Content-Type': 'application/json',
            },
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const firstRender = render(<App />);
    await screen.findByRole('heading', { name: /config screen/i });
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    act(() => {
      MockEventSource.instances[0]?.emit('state_sync', createDraftingState());
    });

    const layout = await screen.findByTestId('drafting-layout');
    expect(layout).toHaveAttribute('data-expanded-column', 'none');
    expect(layout.className).toContain('xl:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)]');
    expect(layout.className).toContain('duration-200');

    expect(screen.getByRole('button', { name: /expand draft board/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /expand available players/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /expand pick feed/i })).toBeInTheDocument();

    const expandAvailablePlayersButton = screen.getByRole('button', { name: /expand available players/i });
    await user.click(expandAvailablePlayersButton);

    expect(layout).toHaveAttribute('data-expanded-column', 'available-players');
    expect(screen.getByTestId('draft-board-collapsed-strip')).toHaveTextContent('Draft Board');
    expect(screen.getByTestId('pick-feed-collapsed-strip')).toHaveTextContent('Pick Feed');
    expect(screen.queryByRole('heading', { name: /^draft board$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^pick feed$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^available players$/i })).toBeInTheDocument();
    await user.click(expandAvailablePlayersButton);
    expect(layout).toHaveAttribute('data-expanded-column', 'available-players');

    await user.click(screen.getByTestId('pick-feed-collapsed-strip'));

    expect(layout).toHaveAttribute('data-expanded-column', 'pick-feed');
    expect(screen.getByTestId('draft-board-collapsed-strip')).toHaveTextContent('Draft Board');
    expect(screen.getByTestId('available-players-collapsed-strip')).toHaveTextContent('Available Players');
    expect(screen.queryByRole('heading', { name: /^available players$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^pick feed$/i })).toBeInTheDocument();
    expect(localStorageSetItemSpy).not.toHaveBeenCalled();

    firstRender.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: /config screen/i });
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    act(() => {
      MockEventSource.instances[1]?.emit('state_sync', createDraftingState());
    });

    const remountedLayout = await screen.findByTestId('drafting-layout');
    expect(remountedLayout).toHaveAttribute('data-expanded-column', 'none');
    expect(remountedLayout.className).toContain('xl:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)]');
  });

  // @spec DFF-UI-138
  test('shows the active bot team name in the drafting status bar when it is not the user turn', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    await renderAppToConfig();
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    act(() => {
      MockEventSource.instances[0]?.emit(
        'state_sync',
        createDraftingState({
          current_pick_number: 3,
        }),
      );
    });

    const statusBar = await screen.findByTestId('draft-status-bar');
    expect(statusBar).toHaveTextContent('Pick 3 of 6');
    expect(within(statusBar).getByText('Bot Gamma')).toBeInTheDocument();
  });

  // @spec DFF-UI-138
  test('shows the final pick count and draft complete status when the draft is completed', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    await renderAppToConfig();
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    act(() => {
      MockEventSource.instances[0]?.emit(
        'state_sync',
        createDraftingState({
          status: 'completed',
          current_pick_number: null,
          picks: [
            { pick_number: 1, team_id: 'team-1', player_id: 'player-picked-1', picked_at: '2026-05-27T10:00:00.000Z' },
            { pick_number: 2, team_id: 'team-2', player_id: 'player-picked-2', picked_at: '2026-05-27T10:01:00.000Z' },
            { pick_number: 3, team_id: 'team-3', player_id: 'player-picked-3', picked_at: '2026-05-27T10:02:00.000Z' },
            { pick_number: 4, team_id: 'team-3', player_id: 'player-picked-4', picked_at: '2026-05-27T10:03:00.000Z' },
            { pick_number: 5, team_id: 'team-2', player_id: 'player-picked-5', picked_at: '2026-05-27T10:04:00.000Z' },
            { pick_number: 6, team_id: 'team-1', player_id: 'player-picked-6', picked_at: '2026-05-27T10:05:00.000Z' },
          ],
        }),
      );
    });

    const statusBar = await screen.findByTestId('draft-status-bar');
    expect(statusBar).toHaveTextContent('Pick 6 of 6');
    expect(within(statusBar).getByText('Draft complete')).toBeInTheDocument();
  });

  // @spec DFF-UI-138
  test('falls back to draft room active when the current pick number has no matching draft-order slot', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    await renderAppToConfig();
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    act(() => {
      MockEventSource.instances[0]?.emit(
        'state_sync',
        createDraftingState({
          current_pick_number: 7,
        }),
      );
    });

    const statusBar = await screen.findByTestId('draft-status-bar');
    expect(statusBar).toHaveTextContent('Pick 7 of 6');
    expect(within(statusBar).getByText('Draft room active')).toBeInTheDocument();
  });

  // @spec DFF-UI-138
  test('falls back to draft room active when the current slot team cannot be resolved', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    await renderAppToConfig();
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    act(() => {
      MockEventSource.instances[0]?.emit(
        'state_sync',
        createDraftingState({
          current_pick_number: 3,
          draft_order: [
            { pick_number: 1, round: 1, pick_in_round: 1, team_id: 'team-1' },
            { pick_number: 2, round: 1, pick_in_round: 2, team_id: 'team-2' },
            { pick_number: 3, round: 1, pick_in_round: 3, team_id: 'missing-team' },
            { pick_number: 4, round: 2, pick_in_round: 1, team_id: 'team-3' },
            { pick_number: 5, round: 2, pick_in_round: 2, team_id: 'team-2' },
            { pick_number: 6, round: 2, pick_in_round: 3, team_id: 'team-1' },
          ],
        }),
      );
    });

    const statusBar = await screen.findByTestId('draft-status-bar');
    expect(statusBar).toHaveTextContent('Pick 3 of 6');
    expect(within(statusBar).getByText('Draft room active')).toBeInTheDocument();
  });

  // @spec DFF-UI-015
  test('shows an error toast and remains on config when draft creation fails', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /draft creation failed\. check your config and try again\./i,
    );
    expect(
      screen.getByRole('heading', {
        name: /config screen/i,
      }),
    ).toBeInTheDocument();
  });

  // @spec DFF-UI-015
  test('shows the server validation message for a 4xx draft creation error', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(new Response('Pick position must be between 1 and 12.', { status: 422 }));

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/pick position must be between 1 and 12\./i);
    expect(
      screen.getByRole('heading', {
        name: /config screen/i,
      }),
    ).toBeInTheDocument();
  });

  // @spec DFF-UI-015
  test('shows the generic error toast when the draft creation request rejects', async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new Error('socket hang up'));

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /draft creation failed\. check your config and try again\./i,
    );
    expect(
      screen.getByRole('heading', {
        name: /config screen/i,
      }),
    ).toBeInTheDocument();
  });

  // @spec DFF-UI-015
  // @spec DFF-UI-087
  test('auto-dismisses the error toast after 6 seconds', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));

    await renderAppToConfig();
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole('button', { name: /start draft/i }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/draft creation failed\. check your config and try again\./i);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6001);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // @spec DFF-UI-014
  // @spec DFF-UI-015
  test('remains on config when the success response is missing a draft id', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /draft creation failed\. check your config and try again\./i,
    );
    expect(
      screen.getByRole('heading', {
        name: /config screen/i,
      }),
    ).toBeInTheDocument();
  });

  // @spec DFF-UI-014
  // @spec DFF-UI-015
  test('remains on config when the success response body is not valid json', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response('not json', {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /draft creation failed\. check your config and try again\./i,
    );
    expect(
      screen.getByRole('heading', {
        name: /config screen/i,
      }),
    ).toBeInTheDocument();
  });

  // @spec DFF-UI-014
  // @spec DFF-UI-015
  test('ignores a second submit while draft creation is already in flight', async () => {
    const deferredResponse = createDeferred<Response>();
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockImplementation(() => deferredResponse.promise);

    await renderAppToConfig();

    const startDraftButton = screen.getByRole('button', { name: /start draft/i });
    await user.click(startDraftButton);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: /starting draft…/i })).toBeDisabled();

    const pendingButton = screen.getByRole('button', { name: /starting draft…/i });
    await user.click(pendingButton);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    deferredResponse.resolve(
      new Response(JSON.stringify({ draftId: 'draft-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    expect(
      await screen.findByRole('heading', {
        name: /draft board/i,
      }),
    ).toBeInTheDocument();
  });

  // @spec DFF-UI-010
  // @spec DFF-UI-014
  test('clamps out-of-range numeric values before posting the draft request', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    await renderAppToConfig();

    await user.clear(screen.getByLabelText(/team count/i));
    await user.type(screen.getByLabelText(/team count/i), '18');
    await user.clear(screen.getByLabelText(/^rounds$/i));
    await user.type(screen.getByLabelText(/^rounds$/i), '9');
    await user.clear(screen.getByLabelText(/pick position/i));
    await user.type(screen.getByLabelText(/pick position/i), '99');
    await user.clear(screen.getByLabelText(/future pick years/i));
    await user.type(screen.getByLabelText(/future pick years/i), '7');
    await user.clear(screen.getByLabelText(/^wr$/i));
    await user.type(screen.getByLabelText(/^wr$/i), '12');
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/drafts',
      expect.objectContaining({
        body: JSON.stringify({
          configName: '',
          teamCount: 16,
          rounds: 10,
          scoringFormat: 'ppr',
          pickPosition: 16,
          futurePickYears: 5,
          rosterSlots: {
            QB: 1,
            RB: 2,
            WR: 8,
            TE: 1,
            FLEX: 1,
            SF: 1,
            BN: 6,
          },
        }),
      }),
    );
  });

  // @spec DFF-UI-003
  // @spec DFF-UI-005
  // @spec DFF-UI-007
  test('renders a completion banner over the draft board when the draft completes', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));

    act(() => {
      MockEventSource.instances[0]?.emit('state_sync', {
        draft_id: 'draft-123',
        status: 'in_progress',
        current_pick_number: 24,
        teams: [
          { id: 'team-1', name: 'Bot Alpha', is_user: false, archetype: 'win_now' },
          { id: 'team-2', name: 'Lakeview Legends', is_user: true, archetype: null },
        ],
        draft_order: [
          { pick_number: 1, round: 1, pick_in_round: 1, team_id: 'team-1' },
          { pick_number: 2, round: 1, pick_in_round: 2, team_id: 'team-2' },
        ],
        picks: [],
        roster_players: [],
        team_pick_assets: [],
        user_queue: [],
        available_players: [],
      });
    });

    act(() => {
      MockEventSource.instances[0]?.emit('draft_complete', {
        draft_id: 'draft-123',
        completed_at: '2026-05-21T18:00:00.000Z',
      });
    });

    expect(
      screen.getByRole('heading', {
        name: /you finished the draft/i,
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('draft-completion-banner')).getByText(
        /congratulations, lakeview legends/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view full history/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /draft board/i })).toBeInTheDocument();
    expect(screen.getByTestId('layout-toggle')).toBeDisabled();
    expect(screen.queryByRole('heading', { name: /draft summary/i })).not.toBeInTheDocument();
  });

  // @spec DFF-UI-005
  test('falls back to "Your team" when the user team is missing from state', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));

    act(() => {
      MockEventSource.instances[0]?.emit('state_sync', {
        draft_id: 'draft-123',
        status: 'in_progress',
        current_pick_number: 24,
        teams: [{ id: 'team-1', name: 'Bot Alpha', is_user: false, archetype: 'win_now' }],
        draft_order: [{ pick_number: 1, round: 1, pick_in_round: 1, team_id: 'team-1' }],
        picks: [],
        roster_players: [],
        team_pick_assets: [],
        user_queue: [],
        available_players: [],
      });
    });

    act(() => {
      MockEventSource.instances[0]?.emit('draft_complete', {
        draft_id: 'draft-123',
        completed_at: '2026-05-21T18:00:00.000Z',
      });
    });

    expect(
      within(screen.getByTestId('draft-completion-banner')).getByText(
        /congratulations, your team\./i,
      ),
    ).toBeInTheDocument();
  });

  // @spec DFF-UI-003
  // @spec DFF-UI-005
  test('renders the completion banner even if draft_complete arrives before the first state_sync', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));

    act(() => {
      MockEventSource.instances[0]?.emit('draft_complete', {
        draft_id: 'draft-123',
        completed_at: '2026-05-21T18:00:00.000Z',
      });
    });

    expect(
      screen.getByRole('heading', {
        name: /you finished the draft/i,
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('draft-completion-banner')).getByText(
        /congratulations, your team\./i,
      ),
    ).toBeInTheDocument();
  });

  // @spec DFF-UI-006
  // @spec DFF-UI-004
  test('opens history from the completion banner and then returns to config when the user starts a new draft', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    await renderAppToConfig();

    await user.click(screen.getByRole('button', { name: /start draft/i }));

    act(() => {
      MockEventSource.instances[0]?.emit('state_sync', {
        draft_id: 'draft-123',
        status: 'in_progress',
        current_pick_number: 24,
        teams: [
          { id: 'team-1', name: 'Bot Alpha', is_user: false, archetype: 'win_now' },
          { id: 'team-2', name: 'Lakeview Legends', is_user: true, archetype: null },
        ],
        draft_order: [
          { pick_number: 1, round: 1, pick_in_round: 1, team_id: 'team-1' },
          { pick_number: 2, round: 1, pick_in_round: 2, team_id: 'team-2' },
        ],
        picks: [],
        roster_players: [],
        team_pick_assets: [],
        user_queue: [],
        available_players: [],
      });
    });

    act(() => {
      MockEventSource.instances[0]?.emit('draft_complete', {
        draft_id: 'draft-123',
        completed_at: '2026-05-21T18:00:00.000Z',
      });
    });
    await user.click(screen.getByRole('button', { name: /view full history/i }));
    await user.click(screen.getByRole('button', { name: /new draft/i }));

    expect(
      screen.getByRole('heading', {
        name: /config screen/i,
      }),
    ).toBeInTheDocument();
  });
});
