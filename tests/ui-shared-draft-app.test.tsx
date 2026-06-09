// @spec DFF-UI-150
// @spec DFF-UI-151
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { App, DraftApp } from '../src/ui/App.js';
import { InMemoryDraftContextProvider } from '../src/ui-static/InMemoryDraftContext.js';
import type { Snapshot } from '../src/ui/types.js';

const fetchMock = vi.fn<typeof fetch>();

const snapshot: Snapshot = {
  exportedAt: '2026-06-08T12:00:00.000Z',
  players: [
    {
      id: 'player-1',
      name: 'Alpha QB',
      position: 'QB',
      nflTeam: 'BUF',
      age: 25,
      isRookie: false,
      dynastyValue: 9000,
      adp: 8,
    },
    {
      id: 'player-2',
      name: 'Bravo WR',
      position: 'WR',
      nflTeam: 'MIN',
      age: 23,
      isRookie: false,
      dynastyValue: 8700,
      adp: 14,
    },
  ],
  pickValues: [
    { year: 2027, round: 1, dynastyValue: 4200 },
    { year: 2027, round: 2, dynastyValue: 1800 },
    { year: 2028, round: 1, dynastyValue: 3600 },
  ],
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockRejectedValue(new Error('offline'));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('shared DraftApp shell', () => {
  // @spec DFF-UI-150
  // @spec DFF-UI-151
  test('renders snapshot stats on the config screen when imported directly under a snapshot-backed context', async () => {
    render(
      <InMemoryDraftContextProvider snapshot={snapshot}>
        <DraftApp />
      </InMemoryDraftContextProvider>,
    );

    expect(await screen.findByRole('heading', { name: /config screen/i })).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Jun 8, 2026')).toBeInTheDocument();
  });

  // @spec DFF-UI-151
  test('does not render snapshot stats in the HTTP app wrapper', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: /config screen/i })).toBeInTheDocument();
    expect(screen.queryByText('Jun 8, 2026')).not.toBeInTheDocument();
  });
});
