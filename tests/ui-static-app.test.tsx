// @spec DFF-STATIC-013
// @spec DFF-STATIC-014
// @spec DFF-STATIC-015
// @spec DFF-STATIC-016
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { App } from '../src/ui-static/App.js';

const fetchMock = vi.fn<typeof fetch>();

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
      screen.getByRole('heading', {
        name: /config screen/i,
      }),
    ).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: /dismiss stale data warning/i }));

    await waitFor(() => {
      expect(screen.queryByText(/player data is over 30 days old/i)).not.toBeInTheDocument();
    });
  });
});
