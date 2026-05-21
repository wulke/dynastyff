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
import { act, cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { App } from '../src/ui/App.js';

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
        name: /history shell/i,
      }),
    ).toBeInTheDocument();
    expect(stream?.closed).toBe(true);
  });

  // @spec DFF-UI-072
  // @spec DFF-UI-083
  test('reconnects with exponential backoff capped at 30 seconds and shows a disconnect toast when retries are exhausted', async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-reconnect-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    render(<App />);

    await user.click(screen.getByRole('button', { name: /start draft/i }));

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

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /lost connection to draft server\. refresh to reconnect\./i,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_001);
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
