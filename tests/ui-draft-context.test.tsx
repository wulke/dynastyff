// @spec DFF-STATIC-060
// @spec DFF-STATIC-061
// @spec DFF-STATIC-062
// @spec DFF-UI-070
// @spec DFF-UI-071
// @spec DFF-UI-072
// @spec DFF-UI-073
// @spec DFF-UI-074
// @spec DFF-UI-082
// @spec DFF-UI-083
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { App } from '../src/ui/App.js';
import {
  HttpDraftContextProvider,
  useDraftContext,
  type QueueEntry,
} from '../src/ui/context/DraftContext.js';

const fetchMock = vi.fn<typeof fetch>();

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly url: string;
  readonly listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>();
  onerror: ((event: Event) => void) | null = null;
  closed = false;

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
    this.closed = true;
  }

  emit(type: string, data: unknown): void {
    const event = new MessageEvent(type, {
      data: JSON.stringify(data),
    });

    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  emitRaw(type: string, data: string): void {
    const event = new MessageEvent(type, { data });

    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  emitError(): void {
    this.onerror?.(new Event('error'));
  }

  static reset(): void {
    MockEventSource.instances = [];
  }
}

beforeEach(() => {
  fetchMock.mockReset();
  MockEventSource.reset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function DraftContextHarness() {
  const { startDraft, submitPick, updateQueue, newDraft } = useDraftContext();

  const queue: QueueEntry[] = [
    {
      playerId: 'player-queue-1',
      rank: 1,
    },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() =>
          void startDraft({
            name: 'Harness Draft',
            teamCount: 12,
            rounds: 20,
            scoringFormat: 'ppr',
            userPickPosition: 6,
            futurePickYears: 3,
            rosterConfig: {
              QB: 1,
              RB: 2,
              WR: 3,
              TE: 1,
              FLEX: 1,
              SF: 1,
              bench: 6,
            },
          })
        }
      >
        Start Harness Draft
      </button>
      <button type="button" onClick={() => void submitPick('player-123')}>
        Submit Pick
      </button>
      <button type="button" onClick={() => void updateQueue(queue)}>
        Update Queue
      </button>
      <button type="button" onClick={() => newDraft()}>
        Reset Draft
      </button>
    </>
  );
}

describe('HTTP draft context', () => {
  // @spec DFF-STATIC-060
  // @spec DFF-STATIC-061
  // @spec DFF-STATIC-062
  // @spec DFF-UI-070
  // @spec DFF-UI-071
  // @spec DFF-UI-082
  test('starts a draft through the context and shows the SSE connecting badge', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-ctx-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    render(<App />);

    await user.click(screen.getByRole('button', { name: /start draft/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/drafts',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]?.url).toBe('/drafts/draft-ctx-123/stream');
    expect(screen.getByText(/connecting…/i)).toBeInTheDocument();
  });

  // @spec DFF-UI-071
  // @spec DFF-UI-073
  // @spec DFF-UI-074
  test('dispatches SSE events into the app and transitions to history on draft_complete', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-stream-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    render(<App />);

    await user.click(screen.getByRole('button', { name: /start draft/i }));

    const stream = MockEventSource.instances[0];
    expect(stream).toBeDefined();

    act(() => {
      stream?.emit('state_sync', {
        draft_id: 'draft-stream-123',
        status: 'in_progress',
        current_pick_number: 1,
        teams: [],
        draft_order: [],
        picks: [],
        roster_players: [],
        team_pick_assets: [],
        user_queue: [],
        available_players: [],
      });
    });

    expect(screen.queryByText(/connecting…/i)).not.toBeInTheDocument();

    act(() => {
      stream?.emit('draft_complete', {
        draft_id: 'draft-stream-123',
        completed_at: '2026-05-21T18:00:00.000Z',
      });
    });

    expect(
      await screen.findByRole('heading', {
        name: /draft summary/i,
      }),
    ).toBeInTheDocument();
    expect(stream?.closed).toBe(true);
  });

  // @spec DFF-UI-070
  test('closes the EventSource when newDraft clears the draft id', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-reset-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    render(
      <HttpDraftContextProvider>
        <DraftContextHarness />
      </HttpDraftContextProvider>,
    );

    await user.click(screen.getByRole('button', { name: /start harness draft/i }));

    const stream = MockEventSource.instances[0];
    expect(stream?.url).toBe('/drafts/draft-reset-123/stream');

    await user.click(screen.getByRole('button', { name: /reset draft/i }));

    expect(stream?.closed).toBe(true);
  });

  // @spec DFF-UI-072
  // @spec DFF-UI-083
  test(
    'reconnects with exponential backoff capped at 30 seconds and shows a disconnect toast when retries are exhausted',
    async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-reconnect-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start draft/i }));
      await Promise.resolve();
    });

    const reconnectDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

    for (const delay of reconnectDelays) {
      const activeStream = MockEventSource.instances.at(-1);

      act(() => {
        activeStream?.emitError();
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay);
      });
    }

    expect(MockEventSource.instances).toHaveLength(7);

    act(() => {
      MockEventSource.instances.at(-1)?.emitError();
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/lost connection to draft server\. refresh to reconnect\./i);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_001);
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
    20_000,
  );

  // @spec DFF-UI-072
  // @spec DFF-UI-074
  test(
    'handles malformed SSE payloads by disconnecting and reconnecting instead of throwing',
    async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-malformed-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start draft/i }));
      await Promise.resolve();
    });

    const initialStream = MockEventSource.instances[0];
    expect(initialStream).toBeDefined();

    act(() => {
      initialStream?.emitRaw('pick_made', '{bad json');
    });

    expect(initialStream?.closed).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1]?.url).toBe('/drafts/draft-malformed-123/stream');
    expect(screen.getByText(/connecting…/i)).toBeInTheDocument();
    },
    20_000,
  );

  // @spec DFF-STATIC-060
  // @spec DFF-STATIC-062
  // @spec DFF-UI-084
  test('submitPick posts to the draft pick endpoint and shows a toast on non-ok responses', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ draftId: 'draft-pick-123' }), {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      )
      .mockResolvedValueOnce(new Response('taken', { status: 400 }));

    render(
      <HttpDraftContextProvider>
        <DraftContextHarness />
      </HttpDraftContextProvider>,
    );

    await user.click(screen.getByRole('button', { name: /start harness draft/i }));
    await user.click(screen.getByRole('button', { name: /submit pick/i }));

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/drafts/draft-pick-123/pick',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ playerId: 'player-123' }),
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/pick failed — player may already be taken\./i);
  });

  // @spec DFF-STATIC-060
  // @spec DFF-STATIC-062
  test('updateQueue posts queue entries to the draft queue endpoint', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ draftId: 'draft-queue-123' }), {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    render(
      <HttpDraftContextProvider>
        <DraftContextHarness />
      </HttpDraftContextProvider>,
    );

    await user.click(screen.getByRole('button', { name: /start harness draft/i }));
    await user.click(screen.getByRole('button', { name: /update queue/i }));

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/drafts/draft-queue-123/queue',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          queue: [
            {
              playerId: 'player-queue-1',
              rank: 1,
            },
          ],
        }),
      }),
    );
  });
});
