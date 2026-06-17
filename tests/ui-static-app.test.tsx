// @spec DFF-STATIC-013
// @spec DFF-STATIC-014
// @spec DFF-STATIC-015
// @spec DFF-STATIC-016
// @spec DFF-UI-154
// @spec DFF-UI-157
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { App } from '../src/ui-static/App.js';
import type { Snapshot } from '../src/ui/types.js';

const fetchMock = vi.fn<typeof fetch>();

// @spec DFF-UI-154
// @spec DFF-UI-157
function createSnapshot(): Snapshot {
  return {
    exportedAt: '2026-05-20T00:00:00.000Z',
    players: Array.from({ length: 24 }, (_, index) => ({
      id: `player-${index + 1}`,
      name: `Player ${index + 1}`,
      position: (['QB', 'RB', 'WR', 'TE'] as const)[index % 4]!,
      nflTeam: 'BUF',
      age: 24,
      isRookie: false,
      dynastyValue: 9000 - index,
      adp: index + 1,
    })),
    pickValues: [{ year: 2027, round: 1, dynastyValue: 6200 }],
  };
}

// @spec DFF-UI-154
// @spec DFF-UI-157
function mockStaticFetches(snapshot: Snapshot, draftsStatus = 404) {
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url === './data/snapshot.json' && method === 'GET') {
      return Promise.resolve(
        new Response(JSON.stringify(snapshot), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );
    }

    if (url === '/drafts' && method === 'GET') {
      return Promise.resolve(new Response('missing', { status: draftsStatus }));
    }

    return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
  });
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

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('static snapshot app', () => {
  // @spec DFF-STATIC-013
  test('shows a loading state and hides config UI until snapshot data is loaded', async () => {
    const deferred = createDeferred<Response>();
    fetchMock.mockReturnValue(deferred.promise);

    render(<App />);

    expect(screen.getByText(/loading player data/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {
        name: /config screen/i,
      }),
    ).not.toBeInTheDocument();

    deferred.resolve(
      new Response(
        JSON.stringify({
          exportedAt: '2026-05-20T00:00:00.000Z',
          players: [
            {
              id: 'player-1',
              name: 'Alpha QB',
              position: 'QB',
              nflTeam: 'BUF',
              age: 24,
              isRookie: false,
              dynastyValue: 9000,
              adp: 10,
            },
          ],
          pickValues: [],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    expect(
      await screen.findByRole('heading', {
        name: /config screen/i,
      }),
    ).toBeInTheDocument();
  });

  // @spec DFF-STATIC-013
  // @spec DFF-STATIC-014
  test('shows the full-screen data unavailable error when the snapshot fetch rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    render(<App />);

    expect(await screen.findByText(/player data unavailable\. try refreshing\./i)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {
        name: /config screen/i,
      }),
    ).not.toBeInTheDocument();
  });

  // @spec DFF-STATIC-013
  // @spec DFF-STATIC-014
  test('shows the full-screen data unavailable error when the snapshot response is not ok', async () => {
    fetchMock.mockResolvedValue(new Response('missing', { status: 503 }));

    render(<App />);

    expect(await screen.findByText(/player data unavailable\. try refreshing\./i)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {
        name: /config screen/i,
      }),
    ).not.toBeInTheDocument();
  });

  // @spec DFF-STATIC-013
  // @spec DFF-STATIC-015
  test('shows the full-screen data unavailable error when the snapshot contains zero players', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          exportedAt: '2026-05-20T00:00:00.000Z',
          players: [],
          pickValues: [],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    render(<App />);

    expect(await screen.findByText(/player data unavailable\. try refreshing\./i)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {
        name: /config screen/i,
      }),
    ).not.toBeInTheDocument();
  });

  // @spec DFF-STATIC-013
  // @spec DFF-STATIC-016
  test('shows a dismissible stale-data banner when exportedAt is more than 30 days old', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-22T12:00:00.000Z').valueOf());
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          exportedAt: '2026-04-20T12:00:00.000Z',
          players: [
            {
              id: 'player-1',
              name: 'Alpha QB',
              position: 'QB',
              nflTeam: 'BUF',
              age: 24,
              isRookie: false,
              dynastyValue: 9000,
              adp: 10,
            },
          ],
          pickValues: [],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    render(<App />);

    expect(
      await screen.findByText(/player data is over 30 days old/i),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', {
        name: /config screen/i,
      }),
    ).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: /dismiss stale data warning/i }));

    await waitFor(() => {
      expect(screen.queryByText(/player data is over 30 days old/i)).not.toBeInTheDocument();
    });
  });

  // @spec DFF-STATIC-013
  // @spec DFF-STATIC-016
  test('does not show the stale-data banner when exportedAt is malformed', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-22T12:00:00.000Z').valueOf());
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          exportedAt: 'not-a-date',
          players: [
            {
              id: 'player-1',
              name: 'Alpha QB',
              position: 'QB',
              nflTeam: 'BUF',
              age: 24,
              isRookie: false,
              dynastyValue: 9000,
              adp: 10,
            },
          ],
          pickValues: [],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    render(<App />);

    expect(
      await screen.findByRole('heading', {
        name: /config screen/i,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/player data is over 30 days old/i)).not.toBeInTheDocument();
  });

  // @spec DFF-UI-154
  // @spec DFF-UI-157
  // @spec DFF-UI-159
  // @spec DFF-UI-180
  // @spec DFF-UI-181
  // @spec DFF-UI-182
  test('resolves the snapshot fetch and renders the shared tabbed drafting shell after starting a static draft', async () => {
    const deferred = createDeferred<Response>();
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url === './data/snapshot.json' && method === 'GET') {
        return deferred.promise;
      }

      if (url === '/drafts' && method === 'GET') {
        return Promise.resolve(new Response('missing', { status: 404 }));
      }

      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    });

    render(<App />);

    const user = userEvent.setup();
    deferred.resolve(
      new Response(JSON.stringify(createSnapshot()), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );
    await screen.findByRole('heading', { name: /config screen/i });
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    expect(await screen.findByTestId('draft-status-bar')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: /draft view tabs/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^board$/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: /^draft board$/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^available players$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^pick feed$/i })).not.toBeInTheDocument();
  });
});
