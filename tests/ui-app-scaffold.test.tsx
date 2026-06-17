// @spec DFF-UI-001
// @spec DFF-UI-002
// @spec DFF-UI-003
// @spec DFF-UI-005
// @spec DFF-UI-006
// @spec DFF-UI-007
// @spec DFF-UI-004
// @spec DFF-UI-010
// @spec DFF-UI-011
// @spec DFF-UI-012
// @spec DFF-UI-013
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

function createJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type SavedConfigApiRecord = {
  id: string;
  name: string;
  team_count: number;
  rounds: number;
  scoring_format: 'ppr' | 'half_ppr' | 'standard';
  roster_slots: {
    QB: number;
    RB: number;
    WR: number;
    TE: number;
    FLEX: number;
    SF: number;
    BN: number;
  };
  pick_position: number;
  future_pick_years: number;
  created_at: string;
};

function createSavedConfigRecord(overrides: Partial<SavedConfigApiRecord> = {}): SavedConfigApiRecord {
  return {
    id: 'saved-config-1',
    name: 'Home League',
    team_count: 12,
    rounds: 20,
    scoring_format: 'ppr',
    roster_slots: {
      QB: 1,
      RB: 2,
      WR: 3,
      TE: 1,
      FLEX: 1,
      SF: 1,
      BN: 6,
    },
    pick_position: 6,
    future_pick_years: 3,
    created_at: '2026-06-04T12:00:00.000Z',
    ...overrides,
  };
}

function setupDraftLifecycleFetches(options: {
  draftId?: string;
  postResponse?: Response;
  savedConfigs?: SavedConfigApiRecord[];
  onPostDraft?: () => Promise<Response> | Response;
} = {}) {
  const {
    draftId = 'draft-123',
    postResponse = createJsonResponse({ draftId }, 201),
    savedConfigs = [],
    onPostDraft,
  } = options;

  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url === '/drafts' && method === 'GET') {
      return Promise.resolve(createJsonResponse([]));
    }

    if (url === '/configs' && method === 'GET') {
      return Promise.resolve(createJsonResponse(savedConfigs));
    }

    if (url === '/drafts' && method === 'POST') {
      return Promise.resolve(onPostDraft ? onPostDraft() : postResponse);
    }

    if (url === `/drafts/${draftId}/state` && method === 'GET') {
      return Promise.resolve(createJsonResponse(createDraftingState({ draft_id: draftId })));
    }

    if (url === `/drafts/${draftId}/queue` && method === 'GET') {
      return Promise.resolve(createJsonResponse([]));
    }

    return Promise.resolve(createJsonResponse([]));
  });
}

// @spec DFF-UI-011
// @spec DFF-UI-014
// @spec DFF-UI-015
function setupDefaultAppFetches(savedConfigs: SavedConfigApiRecord[] = []) {
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url === '/drafts' && method === 'GET') {
      return Promise.resolve(createJsonResponse([]));
    }

    if (url === '/configs' && method === 'GET') {
      return Promise.resolve(createJsonResponse(savedConfigs));
    }

    return Promise.resolve(createJsonResponse([]));
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  MockEventSource.instances = [];
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
  setupDefaultAppFetches();
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

  // @spec DFF-UI-011
  test('loads saved configs on mount and displays them in the dropdown', async () => {
    setupDefaultAppFetches([
      createSavedConfigRecord({
        id: 'saved-config-a',
        name: 'Home League',
      }),
      createSavedConfigRecord({
        id: 'saved-config-b',
        name: 'Superflex Build',
        created_at: '2026-06-04T13:00:00.000Z',
      }),
    ]);

    await renderAppToConfig();

    const select = screen.getByLabelText(/saved configs/i);
    const options = within(select).getAllByRole('option');

    expect(options.map((option) => option.textContent)).toEqual([
      'Select a saved config',
      'Home League',
      'Superflex Build',
    ]);
  });

  // @spec DFF-UI-011b
  test('renders only the default saved-config option when GET /configs returns non-ok', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url === '/drafts' && method === 'GET') {
        return Promise.resolve(createJsonResponse([]));
      }

      if (url === '/configs' && method === 'GET') {
        return Promise.resolve(new Response('boom', { status: 500 }));
      }

      return Promise.resolve(createJsonResponse([]));
    });

    await renderAppToConfig();

    const select = screen.getByLabelText(/saved configs/i);
    const options = within(select).getAllByRole('option');

    expect(options.map((option) => option.textContent)).toEqual(['Select a saved config']);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // @spec DFF-UI-012
  test('selecting a saved config populates all form fields', async () => {
    const savedConfig = createSavedConfigRecord({
      id: 'saved-config-2',
      name: 'Superflex Tight End Premium',
      team_count: 14,
      rounds: 24,
      scoring_format: 'half_ppr',
      pick_position: 9,
      future_pick_years: 5,
      roster_slots: {
        QB: 1,
        RB: 2,
        WR: 4,
        TE: 2,
        FLEX: 2,
        SF: 1,
        BN: 8,
      },
    });

    setupDefaultAppFetches([savedConfig]);
    const user = userEvent.setup();

    await renderAppToConfig();
    await user.selectOptions(screen.getByLabelText(/saved configs/i), 'saved-config-2');

    expect(screen.getByLabelText(/config name/i)).toHaveValue('Superflex Tight End Premium');
    expect(screen.getByLabelText(/team count/i)).toHaveValue(14);
    expect(screen.getByLabelText(/^rounds$/i)).toHaveValue(24);
    expect(screen.getByLabelText(/scoring format/i)).toHaveValue('half_ppr');
    expect(screen.getByLabelText(/^qb$/i)).toHaveValue(1);
    expect(screen.getByLabelText(/^rb$/i)).toHaveValue(2);
    expect(screen.getByLabelText(/^wr$/i)).toHaveValue(4);
    expect(screen.getByLabelText(/^te$/i)).toHaveValue(2);
    expect(screen.getByLabelText(/^flex$/i)).toHaveValue(2);
    expect(screen.getByLabelText(/^sf$/i)).toHaveValue(1);
    expect(screen.getByLabelText(/^bn$/i)).toHaveValue(8);
    expect(screen.getByLabelText(/pick position/i)).toHaveValue(9);
    expect(screen.getByLabelText(/future pick years/i)).toHaveValue(5);
  });

  // @spec DFF-UI-013
  test('saving the current config posts to /configs and adds the result to the dropdown', async () => {
    const user = userEvent.setup();

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url === '/drafts' && method === 'GET') {
        return Promise.resolve(createJsonResponse([]));
      }

      if (url === '/configs' && method === 'GET') {
        return Promise.resolve(createJsonResponse([]));
      }

      if (url === '/configs' && method === 'POST') {
        return Promise.resolve(
          createJsonResponse(
            createSavedConfigRecord({
              id: 'saved-config-new',
              name: 'Tournament Build',
              team_count: 10,
              rounds: 18,
              scoring_format: 'standard',
              roster_slots: {
                QB: 1,
                RB: 2,
                WR: 3,
                TE: 1,
                FLEX: 1,
                SF: 0,
                BN: 5,
              },
              pick_position: 4,
              future_pick_years: 2,
            }),
            201,
          ),
        );
      }

      return Promise.resolve(createJsonResponse([]));
    });

    await renderAppToConfig();

    await user.type(screen.getByLabelText(/config name/i), 'Tournament Build');
    await user.clear(screen.getByLabelText(/team count/i));
    await user.type(screen.getByLabelText(/team count/i), '10');
    await user.clear(screen.getByLabelText(/^rounds$/i));
    await user.type(screen.getByLabelText(/^rounds$/i), '18');
    await user.selectOptions(screen.getByLabelText(/scoring format/i), 'standard');
    await user.clear(screen.getByLabelText(/^sf$/i));
    await user.type(screen.getByLabelText(/^sf$/i), '0');
    await user.clear(screen.getByLabelText(/^bn$/i));
    await user.type(screen.getByLabelText(/^bn$/i), '5');
    await user.clear(screen.getByLabelText(/pick position/i));
    await user.type(screen.getByLabelText(/pick position/i), '4');
    await user.clear(screen.getByLabelText(/future pick years/i));
    await user.type(screen.getByLabelText(/future pick years/i), '2');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/configs',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          configName: 'Tournament Build',
          teamCount: 10,
          rounds: 18,
          scoringFormat: 'standard',
          pickPosition: 4,
          futurePickYears: 2,
          rosterSlots: {
            QB: 1,
            RB: 2,
            WR: 3,
            TE: 1,
            FLEX: 1,
            SF: 0,
            BN: 5,
          },
        }),
      }),
    );

    const select = screen.getByLabelText(/saved configs/i);
    expect(within(select).getByRole('option', { name: 'Tournament Build' })).toBeInTheDocument();
    expect(select).toHaveValue('saved-config-new');
  });

  // @spec DFF-UI-013b
  test('shows a save-config error toast and re-enables Save when POST /configs returns non-ok', async () => {
    const user = userEvent.setup();

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url === '/drafts' && method === 'GET') {
        return Promise.resolve(createJsonResponse([]));
      }

      if (url === '/configs' && method === 'GET') {
        return Promise.resolve(createJsonResponse([]));
      }

      if (url === '/configs' && method === 'POST') {
        return Promise.resolve(new Response('boom', { status: 500 }));
      }

      return Promise.resolve(createJsonResponse([]));
    });

    await renderAppToConfig();

    const saveButton = screen.getByRole('button', { name: /^save$/i });
    await user.click(saveButton);

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to save config\./i);
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled();
  });

  // @spec DFF-UI-013b
  test('shows a save-config error toast and re-enables Save when POST /configs returns malformed json', async () => {
    const user = userEvent.setup();

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url === '/drafts' && method === 'GET') {
        return Promise.resolve(createJsonResponse([]));
      }

      if (url === '/configs' && method === 'GET') {
        return Promise.resolve(createJsonResponse([]));
      }

      if (url === '/configs' && method === 'POST') {
        return Promise.resolve(
          new Response('not-json', {
            status: 201,
            headers: {
              'Content-Type': 'application/json',
            },
          }),
        );
      }

      return Promise.resolve(createJsonResponse([]));
    });

    await renderAppToConfig();

    const saveButton = screen.getByRole('button', { name: /^save$/i });
    await user.click(saveButton);

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to save config\./i);
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled();
  });

  // @spec DFF-UI-002
  // @spec DFF-UI-014
  test('posts the current form values and transitions to drafting when a draft is created', async () => {
    const user = userEvent.setup();
    setupDraftLifecycleFetches();

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

  // @spec DFF-UI-138
  // @spec DFF-UI-139
  // @spec DFF-UI-180
  // @spec DFF-UI-181
  // @spec DFF-UI-182
  // @spec DFF-UI-183
  test('renders the drafting status bar above a tabbed single-pane layout with the Board tab selected by default', async () => {
    const user = userEvent.setup();
    setupDraftLifecycleFetches();

    await renderAppToConfig();
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    act(() => {
      MockEventSource.instances[0]?.emit('state_sync', createDraftingState());
    });

    const statusBar = await screen.findByTestId('draft-status-bar');
    expect(statusBar).toHaveTextContent('Pick 2 of 6');
    expect(statusBar).toHaveTextContent('Your turn');

    const tabList = screen.getByRole('tablist', { name: /draft view tabs/i });
    const boardTab = within(tabList).getByRole('tab', { name: /^board$/i });
    const playersTab = within(tabList).getByRole('tab', { name: /^players$/i });
    const feedTab = within(tabList).getByRole('tab', { name: /^feed$/i });
    const rosterTab = within(tabList).getByRole('tab', { name: /^roster$/i });

    expect(boardTab).toHaveAttribute('aria-selected', 'true');
    expect(boardTab.className).toContain('bg-accent');
    expect(playersTab).toHaveAttribute('aria-selected', 'false');
    expect(feedTab).toHaveAttribute('aria-selected', 'false');
    expect(rosterTab).toHaveAttribute('aria-selected', 'false');
    expect(statusBar.compareDocumentPosition(tabList)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    expect(screen.getByRole('heading', { name: /draft board/i })).toBeInTheDocument();
    expect(screen.getByTestId('layout-toggle')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^available players$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^pick feed$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();

    expect(screen.getByText(/^Your turn$/i)).toBe(statusBar.querySelector('[data-testid="draft-status-turn"]'));
    expect(screen.queryByText(/bot is picking…/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /expand draft board/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /expand available players/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /expand pick feed/i })).not.toBeInTheDocument();
  });

  // @spec DFF-UI-180
  // @spec DFF-UI-185
  // @spec DFF-UI-184
  // @spec DFF-UI-186
  // @spec DFF-UI-191
  // @spec DFF-UI-192
  test('switches between draft tabs, preserves nested players tabs, and keeps full-view overlays above the tab shell', async () => {
    const user = userEvent.setup();
    setupDraftLifecycleFetches();

    await renderAppToConfig();
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    act(() => {
      MockEventSource.instances[0]?.emit('state_sync', createDraftingState());
    });

    await user.click(screen.getByRole('tab', { name: /^players$/i }));
    expect(screen.getByRole('heading', { name: /^available players$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^available$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^targets$/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /josh allen/i }));
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /draft josh allen/i })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /^feed$/i }));
    const pickFeedPanel = screen.getByTestId('pick-feed-panel');
    expect(pickFeedPanel).toBeInTheDocument();
    expect(screen.getByTestId('pick-feed-scroll-container').className).not.toContain('max-h-[28rem]');

    await user.click(screen.getByRole('tab', { name: /^players$/i }));
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /draft josh allen/i })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /^roster$/i }));
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();

    act(() => {
      MockEventSource.instances[0]?.emit('trade_offered', {
        trade_id: 'trade-user-149',
        initiating_team_id: 'team-1',
        receiving_team_id: 'team-2',
        assets_sent: [{ type: 'player', player_id: 'player-1' }],
        assets_received: [{ type: 'player', player_id: 'player-2' }],
        is_bot_to_bot: false,
      });
    });

    expect(screen.getByTestId('trade-modal-overlay').className).toContain('fixed');
    expect(screen.getByTestId('trade-modal-overlay').className).toContain('inset-0');

    act(() => {
      MockEventSource.instances[0]?.emit('state_sync', createDraftingState({ status: 'completed', current_pick_number: null }));
    });
    act(() => {
      MockEventSource.instances[0]?.emit('draft_complete', {
        draft_id: 'draft-123',
        completed_at: '2026-05-21T18:00:00.000Z',
      });
    });

    expect(screen.getByTestId('draft-completion-banner').className).toContain('fixed');
    expect(screen.getByTestId('draft-completion-banner').className).toContain('inset-0');
  });

  // @spec DFF-UI-138
  test('shows the active bot team name in the drafting status bar when it is not the user turn', async () => {
    const user = userEvent.setup();
    setupDraftLifecycleFetches();

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
    setupDraftLifecycleFetches();

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
    setupDraftLifecycleFetches();

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
    setupDraftLifecycleFetches();

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
    setupDraftLifecycleFetches({
      postResponse: new Response('boom', { status: 500 }),
    });

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
    setupDraftLifecycleFetches({
      postResponse: new Response('Pick position must be between 1 and 12.', { status: 422 }),
    });

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
    setupDraftLifecycleFetches({
      onPostDraft: () => Promise.reject(new Error('socket hang up')),
    });

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
    setupDraftLifecycleFetches({
      postResponse: new Response('boom', { status: 500 }),
    });

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
    setupDraftLifecycleFetches({
      postResponse: createJsonResponse({}, 201),
    });

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
    setupDraftLifecycleFetches({
      postResponse: new Response('not json', {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    });

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
    setupDraftLifecycleFetches({
      onPostDraft: () => deferredResponse.promise,
    });

    await renderAppToConfig();

    const startDraftButton = screen.getByRole('button', { name: /start draft/i });
    await user.click(startDraftButton);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('button', { name: /starting draft…/i })).toBeDisabled();

    const pendingButton = screen.getByRole('button', { name: /starting draft…/i });
    await user.click(pendingButton);

    expect(fetchMock).toHaveBeenCalledTimes(3);

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
    setupDraftLifecycleFetches();

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
  // @spec DFF-UI-145
  test('renders a completion banner over the draft board when the draft completes', async () => {
    const user = userEvent.setup();
    setupDraftLifecycleFetches();

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
    expect(screen.getByTestId('draft-completion-banner')).toHaveTextContent(/congratulations/i);
    expect(screen.getByTestId('draft-completion-banner')).toHaveTextContent(/lakeview legends/i);
    expect(screen.getByRole('button', { name: /view draft grade/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /draft board/i })).toBeInTheDocument();
    expect(screen.getByTestId('layout-toggle')).toBeDisabled();
    expect(screen.queryByRole('heading', { name: /draft grade summary/i })).not.toBeInTheDocument();
  });

  // @spec DFF-UI-005
  test('falls back to "Your team" when the user team is missing from state', async () => {
    const user = userEvent.setup();
    setupDraftLifecycleFetches();

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

    expect(screen.getByTestId('draft-completion-banner')).toHaveTextContent(/congratulations/i);
    expect(screen.getByTestId('draft-completion-banner')).toHaveTextContent(/your team/i);
  });

  // @spec DFF-UI-003
  // @spec DFF-UI-005
  test('renders the completion banner even if draft_complete arrives before the first state_sync', async () => {
    const user = userEvent.setup();
    setupDraftLifecycleFetches();

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
    expect(screen.getByTestId('draft-completion-banner')).toHaveTextContent(/congratulations/i);
    expect(screen.getByTestId('draft-completion-banner')).toHaveTextContent(/lakeview legends/i);
  });

  // @spec DFF-UI-145
  // @spec DFF-UI-149
  // @spec DFF-UI-004
  test('opens the draft grade summary from the completion banner and then returns to config when the user starts a new draft', async () => {
    const user = userEvent.setup();
    setupDraftLifecycleFetches();

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
    await user.click(screen.getByRole('button', { name: /view draft grade/i }));
    expect(screen.getByRole('heading', { name: /draft grade summary/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /new draft/i }));

    expect(
      screen.getByRole('heading', {
        name: /config screen/i,
      }),
    ).toBeInTheDocument();
  });
});
