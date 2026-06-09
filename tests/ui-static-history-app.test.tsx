// @spec DFF-UI-155
// @spec DFF-UI-156
// @spec DFF-UI-060
// @spec DFF-UI-061
// @spec DFF-UI-065
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { App } from '../src/ui-static/App.js';
import type { Snapshot } from '../src/ui/types.js';

const fetchMock = vi.fn<typeof fetch>();

// @spec DFF-UI-155
// @spec DFF-UI-156
function createSnapshot(playerCount = 120): Snapshot {
  return {
    exportedAt: '2026-05-22T12:00:00.000Z',
    players: Array.from({ length: playerCount }, (_, index) => ({
      id: `player-${String(index + 1).padStart(3, '0')}`,
      name: `Player ${String(index + 1).padStart(3, '0')}`,
      position: (['WR', 'QB', 'RB', 'TE'] as const)[index % 4]!,
      nflTeam: ['BUF', 'DET', 'HOU', 'KC'][index % 4]!,
      age: 21 + (index % 8),
      isRookie: false,
      dynastyValue: 10_000 - index,
      adp: index + 1,
    })),
    pickValues: [{ year: 2027, round: 1, dynastyValue: 6200 }],
  };
}

// @spec DFF-UI-155
// @spec DFF-UI-156
function mockSnapshotFetch(snapshot: Snapshot) {
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
      return Promise.resolve(new Response('missing', { status: 404 }));
    }

    return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
  });
}

function configureSmallDraft() {
  fireEvent.change(screen.getByLabelText(/team count/i), { target: { value: '8' } });
  fireEvent.blur(screen.getByLabelText(/team count/i));
  fireEvent.change(screen.getByLabelText(/^rounds$/i), { target: { value: '10' } });
  fireEvent.blur(screen.getByLabelText(/^rounds$/i));
  fireEvent.change(screen.getByLabelText(/pick position/i), { target: { value: '2' } });
  fireEvent.blur(screen.getByLabelText(/pick position/i));
}

async function completeStaticDraft() {
  fireEvent.click(screen.getByRole('button', { name: /start draft/i }));

  expect(screen.getByRole('heading', { name: /draft room/i })).toBeInTheDocument();

  for (let turn = 0; turn < 10; turn += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    if (screen.queryByTestId('draft-completion-banner')) {
      return;
    }

    if (turn === 0) {
      const recentPicksSection = screen.getByRole('heading', { name: /recent picks/i }).closest('section');
      expect(recentPicksSection).not.toBeNull();
      expect(within(recentPicksSection!).getByText(/player 001/i)).toBeInTheDocument();
      expect(within(recentPicksSection!).queryByText(/player-001/i)).not.toBeInTheDocument();
    }

    const playerButtons = screen.getAllByRole('button');
    const playerButton = playerButtons.find((button) => /player \d{3}/i.test(button.textContent ?? ''));

    expect(playerButton).toBeDefined();
    expect(playerButton).toBeEnabled();

    fireEvent.click(playerButton!);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_000);
    });

    if (screen.queryByTestId('draft-completion-banner')) {
      return;
    }
  }
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('static in-browser draft flow', () => {
  // @spec DFF-UI-155
  // @spec DFF-UI-156
  // @spec DFF-UI-060
  // @spec DFF-UI-061
  // @spec DFF-UI-065
  test('shows the completion banner first, then opens full history after View Full History', async () => {
    const originalCrypto = globalThis.crypto;
    let nextId = 0;

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        randomUUID: () => `static-app-${++nextId}`,
      },
    });

    try {
      mockSnapshotFetch(createSnapshot());

      render(<App />);

      await screen.findByRole('heading', { name: /config screen/i });
      vi.useFakeTimers();
      configureSmallDraft();
      await completeStaticDraft();

      const completionBanner = screen.getByTestId('draft-completion-banner');
      expect(within(completionBanner).getByText(/you finished the draft/i)).toBeInTheDocument();
      expect(screen.getByTestId('drafting-layout')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /draft summary/i })).not.toBeInTheDocument();

      fireEvent.click(within(completionBanner).getByRole('button', { name: /view draft grade/i }));
      fireEvent.click(screen.getByRole('button', { name: /view full history/i }));

      expect(screen.getByRole('heading', { name: /draft summary/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /pick log/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /roster view/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /trade log/i })).toBeInTheDocument();

      const pickLogPanel = screen.getByRole('tabpanel', { name: /pick log/i });
      expect(within(pickLogPanel).getByText(/player 001/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /new draft/i }));
      expect(screen.getByRole('heading', { name: /config screen/i })).toBeInTheDocument();

      configureSmallDraft();
      await completeStaticDraft();

      expect(screen.getByTestId('draft-completion-banner')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /view draft grade/i }));
      fireEvent.click(screen.getByRole('button', { name: /view full history/i }));
      expect(screen.getByRole('heading', { name: /draft summary/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /pick log/i })).toBeInTheDocument();
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: originalCrypto,
      });
    }
  }, 20_000);
});
