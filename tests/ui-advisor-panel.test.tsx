// @spec DFF-UI-040
// @spec DFF-UI-041
// @spec DFF-UI-042
// @spec DFF-UI-043
// @spec DFF-UI-044
// @spec DFF-UI-045
// @spec DFF-UI-046
// @spec DFF-UI-047
// @spec DFF-UI-048
// @spec DFF-UI-081
// @spec DFF-UI-085
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

// @spec DFF-UI-040
// @spec DFF-UI-041
// @spec DFF-UI-042
// @spec DFF-UI-043
// @spec DFF-UI-044
// @spec DFF-UI-045
// @spec DFF-UI-046
// @spec DFF-UI-047
// @spec DFF-UI-048
function emitStateSync() {
  act(() => {
    MockEventSource.instances[0]?.emit('state_sync', {
      draft_id: 'draft-advisor-123',
      status: 'in_progress',
      current_pick_number: 2,
      teams: [
        { id: 'team-1', name: 'Bot Alpha', is_user: false, archetype: 'win_now' },
        { id: 'team-2', name: 'You', is_user: true, archetype: null },
        { id: 'team-3', name: 'Bot Beta', is_user: false, archetype: 'productive_struggle' },
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
          player_id: 'player-0',
          picked_at: '2026-05-23T10:00:00.000Z',
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
          age: 29,
          is_rookie: false,
          dynasty_value: 9999,
          adp: 2.1,
        },
      ],
      trades: [],
    });
  });
}

async function startDraft() {
  const user = userEvent.setup();
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ draftId: 'draft-advisor-123' }), {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
      },
    }),
  );

  render(<App />);
  await user.click(screen.getByRole('button', { name: /start draft/i }));
  emitStateSync();
  return user;
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

describe('advisor panel UI', () => {
  // @spec DFF-UI-040
  // @spec DFF-UI-041
  // @spec DFF-UI-042
  test('opens from the draft header, slides in from the right, and does not block draft board controls', async () => {
    const user = await startDraft();

    expect(screen.queryByTestId('advisor-panel')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /advisor/i }));

    const panel = screen.getByTestId('advisor-panel');
    expect(panel).toBeInTheDocument();
    expect(within(panel).getByRole('tab', { name: /advise me/i })).toBeInTheDocument();
    expect(within(panel).getByRole('tab', { name: /grill me/i })).toBeInTheDocument();

    const layoutToggle = screen.getByTestId('layout-toggle');
    expect(layoutToggle).toHaveAttribute('aria-label', 'Switch to column layout');

    await user.click(layoutToggle);

    expect(layoutToggle).toHaveAttribute('aria-label', 'Switch to row layout');

    await user.click(screen.getByRole('button', { name: /advisor/i }));

    expect(screen.queryByTestId('advisor-panel')).not.toBeInTheDocument();
  });

  // @spec DFF-UI-043
  // @spec DFF-UI-044
  // @spec DFF-UI-045
  // @spec DFF-UI-081
  test('posts advise requests, renders the structured response, and clears stale advice on your_turn', async () => {
    const user = await startDraft();
    let resolveAdvice: ((value: Response) => void) | null = null;
    const advicePromise = new Promise<Response>((resolve) => {
      resolveAdvice = resolve;
    });

    fetchMock.mockImplementationOnce(async () => advicePromise);

    await user.click(screen.getByRole('button', { name: /advisor/i }));
    await user.click(screen.getByRole('button', { name: /^advise me$/i }));

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/drafts/draft-advisor-123/advisor/advise',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(screen.getByText(/getting recommendation/i)).toBeInTheDocument();

    resolveAdvice?.(
      new Response(
        JSON.stringify({
          recommendation: 'Josh Allen, QB, BUF',
          keyFactors: ['Highest dynasty value on the board'],
          caveats: ['Elite QB value may crowd early roster construction'],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    expect(await screen.findByText(/^recommendation$/i)).toBeInTheDocument();
    expect(screen.getByText(/josh allen, qb, buf/i)).toBeInTheDocument();
    expect(screen.getByText(/highest dynasty value on the board/i)).toBeInTheDocument();
    expect(screen.getByText(/elite qb value may crowd early roster construction/i)).toBeInTheDocument();

    act(() => {
      MockEventSource.instances[0]?.emit('your_turn', {
        pick_number: 5,
        round: 2,
        pick_in_round: 2,
      });
    });

    expect(screen.queryByText(/^recommendation$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/josh allen, qb, buf/i)).not.toBeInTheDocument();
  });

  // @spec DFF-UI-046
  // @spec DFF-UI-047
  // @spec DFF-UI-048
  test('supports grill-me chat, shows a typing indicator, and clears conversation plus resets the server on your_turn', async () => {
    const user = await startDraft();
    let resolveChat: ((value: Response) => void) | null = null;
    const chatPromise = new Promise<Response>((resolve) => {
      resolveChat = resolve;
    });

    fetchMock
      .mockImplementationOnce(async () => chatPromise)
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await user.click(screen.getByRole('button', { name: /advisor/i }));
    await user.click(screen.getByRole('tab', { name: /grill me/i }));
    await user.type(screen.getByPlaceholderText(/share your reasoning/i), 'I want the elite quarterback ceiling.');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/drafts/draft-advisor-123/advisor/chat',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'I want the elite quarterback ceiling.' }),
      }),
    );
    expect(screen.getByText(/i want the elite quarterback ceiling\./i)).toBeInTheDocument();
    expect(screen.getByText(/advisor is thinking/i)).toBeInTheDocument();

    resolveChat?.(
      new Response(
        JSON.stringify({
          message: 'What does that cost you at RB and WR over the next two turns?',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    expect(await screen.findByText(/what does that cost you at rb and wr over the next two turns\?/i)).toBeInTheDocument();

    act(() => {
      MockEventSource.instances[0]?.emit('your_turn', {
        pick_number: 11,
        round: 4,
        pick_in_round: 2,
      });
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/drafts/draft-advisor-123/advisor/chat',
      expect.objectContaining({
        method: 'DELETE',
      }),
    );
    expect(screen.queryByText(/i want the elite quarterback ceiling\./i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/what does that cost you at rb and wr over the next two turns\?/i),
    ).not.toBeInTheDocument();
  });

  // @spec DFF-UI-085
  test('shows the advisor unavailable toast when an advisor request fails', async () => {
    const user = await startDraft();

    fetchMock.mockResolvedValueOnce(new Response('unavailable', { status: 503 }));

    await user.click(screen.getByRole('button', { name: /advisor/i }));
    await user.click(screen.getByRole('button', { name: /^advise me$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/advisor unavailable\. try again\./i);
  });
});
