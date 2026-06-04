// @spec DFF-UI-050
// @spec DFF-UI-051
// @spec DFF-UI-052
// @spec DFF-UI-053
// @spec DFF-UI-054
// @spec DFF-UI-055
// @spec DFF-UI-056
// @spec DFF-UI-057
// @spec DFF-UI-058
// @spec DFF-UI-059
// @spec DFF-UI-059b
// @spec DFF-UI-059c
// @spec DFF-UI-059d
// @spec DFF-UI-059e
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

// @spec DFF-UI-050
function createDraftingState(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    draft_id: 'draft-trade-123',
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
    ],
    picks: [
      {
        pick_number: 1,
        team_id: 'team-1',
        player_id: 'player-picked',
        picked_at: '2026-06-02T12:00:00.000Z',
      },
    ],
    roster_players: [
      { team_id: 'team-2', player_id: 'roster-user-qb' },
      { team_id: 'team-2', player_id: 'roster-user-rb' },
      { team_id: 'team-1', player_id: 'roster-bot-wr' },
      { team_id: 'team-1', player_id: 'roster-bot-te' },
    ],
    team_pick_assets: [
      { team_id: 'team-2', year: 2027, round: 1 },
      { team_id: 'team-1', year: 2028, round: 2 },
    ],
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
        name: 'CeeDee Lamb',
        position: 'WR',
        nfl_team: 'DAL',
        age: 27,
        is_rookie: false,
        dynasty_value: 9400,
        adp: 2,
      },
    ],
    drafted_players: [
      {
        id: 'roster-user-qb',
        name: 'Jordan Love',
        position: 'QB',
        nfl_team: 'GB',
        age: 27,
        is_rookie: false,
        dynasty_value: 7000,
        adp: 28,
      },
      {
        id: 'roster-user-rb',
        name: 'Breece Hall',
        position: 'RB',
        nfl_team: 'NYJ',
        age: 24,
        is_rookie: false,
        dynasty_value: 7600,
        adp: 18,
      },
      {
        id: 'roster-bot-wr',
        name: 'Garrett Wilson',
        position: 'WR',
        nfl_team: 'NYJ',
        age: 25,
        is_rookie: false,
        dynasty_value: 7800,
        adp: 12,
      },
      {
        id: 'roster-bot-te',
        name: 'Brock Bowers',
        position: 'TE',
        nfl_team: 'LV',
        age: 22,
        is_rookie: false,
        dynasty_value: 7200,
        adp: 20,
      },
    ],
    trades: [],
    ...overrides,
  };
}

// @spec DFF-UI-053
function setupTradeModalFetches() {
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url === '/drafts' && method === 'GET') {
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }

    if (url === '/drafts' && method === 'POST') {
      return Promise.resolve(
        new Response(JSON.stringify({ draftId: 'draft-trade-123' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }

    if (url === '/drafts/draft-trade-123/state' && method === 'GET') {
      return Promise.resolve(
        new Response(JSON.stringify(createDraftingState()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }

    if (url === '/drafts/draft-trade-123/queue' && method === 'GET') {
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }

    if (url === '/drafts/draft-trade-123/trade-response' && method === 'POST') {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }

    if (url === '/drafts/draft-trade-123/trade-offer' && method === 'POST') {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, tradeId: 'trade-user-proposal' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }

    throw new Error(`Unexpected fetch: ${method} ${url}`);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  MockEventSource.instances = [];
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
  setupTradeModalFetches();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderDraftRoom() {
  const user = userEvent.setup();

  render(<App />);
  await screen.findByRole('heading', { name: /config screen/i });
  await user.click(screen.getByRole('button', { name: /start draft/i }));
  await screen.findByRole('heading', { name: /draft board/i });

  return user;
}

// @spec DFF-UI-050
function emitUserTrade(tradeId = 'trade-user-1') {
  act(() => {
    MockEventSource.instances[0]?.emit('trade_offered', {
      trade_id: tradeId,
      initiating_team_id: 'team-1',
      receiving_team_id: 'team-2',
      assets_sent: [{ type: 'player', player_id: 'player-1' }],
      assets_received: [{ type: 'player', player_id: 'player-2' }],
      is_bot_to_bot: false,
    });
  });
}

// @spec DFF-UI-050
// @spec DFF-UI-051
test('opens a blocking modal for a user-targeted trade and prevents draft-room interaction beneath it', async () => {
  await renderDraftRoom();
  emitUserTrade();

  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /decline/i })).toBeInTheDocument();

  expect(screen.getByTestId('available-player-row-player-1')).toBeDisabled();
  expect(screen.queryByTestId('pick-confirmation-card')).not.toBeInTheDocument();
});

// @spec DFF-UI-053
test('accepting a user-targeted trade posts accepted and closes the modal', async () => {
  const user = await renderDraftRoom();
  emitUserTrade('trade-user-accept');

  await user.click(screen.getByRole('button', { name: /accept/i }));

  expect(fetchMock).toHaveBeenCalledWith(
    '/drafts/draft-trade-123/trade-response',
    expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'accepted' }),
    }),
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

// @spec DFF-UI-053
test('declining a user-targeted trade posts declined and closes the modal', async () => {
  const user = await renderDraftRoom();
  emitUserTrade('trade-user-decline');

  await user.click(screen.getByRole('button', { name: /decline/i }));

  expect(fetchMock).toHaveBeenCalledWith(
    '/drafts/draft-trade-123/trade-response',
    expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'declined' }),
      }),
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

// @spec DFF-UI-052
// @spec DFF-UI-054
test('bot-to-bot trade modal renders OK and Force Decline actions and maps OK to accepted', async () => {
  const user = await renderDraftRoom();

  act(() => {
    MockEventSource.instances[0]?.emit('trade_offered', {
      trade_id: 'trade-b2b-ok',
      initiating_team_id: 'team-1',
      receiving_team_id: 'team-3',
      assets_sent: [{ type: 'future_pick', year: 2027, round: 1 }],
      assets_received: [{ type: 'player', player_id: 'player-2' }],
      is_bot_to_bot: true,
    });
  });

  expect(screen.getByRole('button', { name: /^ok$/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /force decline/i })).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /^ok$/i }));

  expect(fetchMock).toHaveBeenCalledWith(
    '/drafts/draft-trade-123/trade-response',
    expect.objectContaining({
      body: JSON.stringify({ status: 'accepted' }),
    }),
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

// @spec DFF-UI-053
test('keeps the trade modal open and shows an error toast when trade-response returns non-ok', async () => {
  const user = await renderDraftRoom();
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url === '/drafts/draft-trade-123/trade-response' && method === 'POST') {
      return Promise.resolve(new Response(JSON.stringify({ error: 'boom' }), { status: 500 }));
    }

    return setupTradeModalDefaultResponse(url, method);
  });
  emitUserTrade('trade-user-failure');

  await user.click(screen.getByRole('button', { name: /accept/i }));

  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByRole('alert', { hidden: true })).toHaveTextContent(/trade response failed\. try again\./i);
});

// @spec DFF-UI-050
test('does not dismiss the trade modal on escape key or outside click', async () => {
  await renderDraftRoom();
  emitUserTrade('trade-user-block-dismiss');

  const dialog = screen.getByRole('dialog');
  const overlay = screen.getByTestId('trade-modal-overlay');

  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeInTheDocument();

  fireEvent.pointerDown(overlay);
  fireEvent.click(overlay);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

// @spec DFF-UI-050
test('renders the latest trade when a second trade_offered event arrives before the first resolves', async () => {
  await renderDraftRoom();
  emitUserTrade('trade-user-first');

  expect(screen.getByText(/josh allen \(qb\)/i)).toBeInTheDocument();

  act(() => {
    MockEventSource.instances[0]?.emit('trade_offered', {
      trade_id: 'trade-user-second',
      initiating_team_id: 'team-3',
      receiving_team_id: 'team-2',
      assets_sent: [{ type: 'future_pick', year: 2028, round: 2 }],
      assets_received: [{ type: 'player', player_id: 'player-1' }],
      is_bot_to_bot: false,
    });
  });

  expect(screen.getByText(/bot gamma sends/i)).toBeInTheDocument();
  expect(screen.getByText(/2028 round 2/i)).toBeInTheDocument();
  expect(screen.queryByText(/bot alpha sends/i)).not.toBeInTheDocument();
});

// @spec DFF-UI-056
// @spec DFF-UI-057
// @spec DFF-UI-058
test('clicking a bot team header opens propose mode with team switching and position filters', async () => {
  const user = await renderDraftRoom();

  await user.click(screen.getByRole('button', { name: /bot alpha/i }));

  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /propose trade/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/trade partner/i)).toHaveValue('team-1');
  expect(screen.getAllByRole('button', { name: /^all$/i })).toHaveLength(2);
  expect(screen.getAllByRole('button', { name: /^qb$/i })).toHaveLength(2);
  expect(screen.getAllByRole('button', { name: /^rb$/i })).toHaveLength(2);
  expect(screen.getAllByRole('button', { name: /^wr$/i })).toHaveLength(2);
  expect(screen.getAllByRole('button', { name: /^te$/i })).toHaveLength(2);

  await user.click(screen.getAllByRole('button', { name: /^rb$/i })[0]!);
  expect(screen.getByText(/breece hall/i)).toBeInTheDocument();
  expect(screen.queryByText(/jordan love/i)).not.toBeInTheDocument();
  expect(screen.getByText(/2027 round 1/i)).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText(/trade partner/i), 'team-3');
  expect(screen.getByLabelText(/trade partner/i)).toHaveValue('team-3');
});

// @spec DFF-UI-059
// @spec DFF-UI-059b
// @spec DFF-UI-059c
test('submitting a user-initiated trade posts trade-offer and keeps the modal open for the SSE result', async () => {
  const user = await renderDraftRoom();

  await user.click(screen.getByRole('button', { name: /bot alpha/i }));
  await user.click(screen.getByRole('button', { name: /jordan love/i }));
  await user.click(screen.getByRole('button', { name: /garrett wilson/i }));
  await user.click(screen.getByRole('button', { name: /submit proposal/i }));

  expect(fetchMock).toHaveBeenCalledWith(
    '/drafts/draft-trade-123/trade-offer',
    expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        targetTeamId: 'team-1',
        offeredAssets: [{ type: 'player', player_id: 'roster-user-qb' }],
        requestedAssets: [{ type: 'player', player_id: 'roster-bot-wr' }],
      }),
    }),
  );

  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText(/waiting for bot response/i)).toBeInTheDocument();

  act(() => {
    MockEventSource.instances[0]?.emit('trade_offered', {
      trade_id: 'trade-user-proposal',
      initiating_team_id: 'team-2',
      receiving_team_id: 'team-1',
      assets_sent: [{ type: 'player', player_id: 'roster-user-qb' }],
      assets_received: [{ type: 'player', player_id: 'roster-bot-wr' }],
      is_bot_to_bot: false,
    });
    MockEventSource.instances[0]?.emit('trade_resolved', {
      trade_id: 'trade-user-proposal',
      status: 'accepted',
      assets_sent: [{ type: 'player', player_id: 'roster-user-qb' }],
      assets_received: [{ type: 'player', player_id: 'roster-bot-wr' }],
    });
  });

  expect(await screen.findByText(/trade accepted/i)).toBeInTheDocument();
});

function setupTradeModalDefaultResponse(url: string, method: string): Promise<Response> {
  if (url === '/drafts' && method === 'GET') {
    return Promise.resolve(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }

  if (url === '/drafts' && method === 'POST') {
    return Promise.resolve(
      new Response(JSON.stringify({ draftId: 'draft-trade-123' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }

  if (url === '/drafts/draft-trade-123/state' && method === 'GET') {
    return Promise.resolve(
      new Response(JSON.stringify(createDraftingState()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }

  if (url === '/drafts/draft-trade-123/queue' && method === 'GET') {
    return Promise.resolve(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }

  if (url === '/drafts/draft-trade-123/trade-response' && method === 'POST') {
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }

  if (url === '/drafts/draft-trade-123/trade-offer' && method === 'POST') {
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true, tradeId: 'trade-user-proposal' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }

  throw new Error(`Unexpected fetch: ${method} ${url}`);
}

// @spec DFF-UI-052
// @spec DFF-UI-055
test('force declining a bot-to-bot trade posts force_declined and closes the modal', async () => {
  const user = await renderDraftRoom();

  act(() => {
    MockEventSource.instances[0]?.emit('trade_offered', {
      trade_id: 'trade-b2b-veto',
      initiating_team_id: 'team-1',
      receiving_team_id: 'team-3',
      assets_sent: [{ type: 'future_pick', year: 2027, round: 1 }],
      assets_received: [{ type: 'player', player_id: 'player-2' }],
      is_bot_to_bot: true,
    });
  });

  await user.click(screen.getByRole('button', { name: /force decline/i }));

  expect(fetchMock).toHaveBeenCalledWith(
    '/drafts/draft-trade-123/trade-response',
    expect.objectContaining({
      body: JSON.stringify({ status: 'force_declined' }),
    }),
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

// @spec DFF-UI-059d
// @spec DFF-UI-059e
test('countering an incoming bot offer reverses the assets into propose mode for the same team', async () => {
  const user = await renderDraftRoom();
  emitUserTrade('trade-user-counter');

  expect(screen.getByRole('button', { name: /counter/i })).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /counter/i }));

  expect(screen.getByRole('heading', { name: /propose trade/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/trade partner/i)).toHaveValue('team-1');
  expect(screen.getAllByText(/ceedee lamb/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/josh allen/i).length).toBeGreaterThan(0);
});
