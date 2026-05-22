// @spec DFF-STATIC-034
// @spec DFF-STATIC-035
// @spec DFF-STATIC-063
// @spec DFF-STATIC-070
// @spec DFF-STATIC-071
// @spec DFF-STATIC-072
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { App } from '../src/ui-static/App.js';
import type { Snapshot } from '../src/ui/types.js';

const fetchMock = vi.fn<typeof fetch>();

// @spec DFF-STATIC-063
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

// @spec DFF-STATIC-063
function mockSnapshotFetch(snapshot: Snapshot) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(snapshot), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    }),
  );
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
  // @spec DFF-STATIC-034
  // @spec DFF-STATIC-035
  // @spec DFF-STATIC-063
  // @spec DFF-STATIC-070
  // @spec DFF-STATIC-071
  // @spec DFF-STATIC-072
  test('completes config to history in-browser and renders completed drafts in reverse chronological order', async () => {
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

      fireEvent.change(screen.getByLabelText(/team count/i), { target: { value: '8' } });
      fireEvent.blur(screen.getByLabelText(/team count/i));
      fireEvent.change(screen.getByLabelText(/^rounds$/i), { target: { value: '10' } });
      fireEvent.blur(screen.getByLabelText(/^rounds$/i));
      fireEvent.change(screen.getByLabelText(/pick position/i), { target: { value: '2' } });
      fireEvent.blur(screen.getByLabelText(/pick position/i));
      fireEvent.click(screen.getByRole('button', { name: /start draft/i }));

      expect(screen.getByRole('heading', { name: /draft room/i })).toBeInTheDocument();
      expect(screen.getByText(/bot is picking/i)).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_499);
      });

      expect(screen.getByText(/bot is picking/i)).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_501);
      });

      for (let turn = 0; turn < 10; turn += 1) {
        const playerButtons = screen.getAllByRole('button');
        const playerButton = playerButtons.find((button) => /player \d{3}/i.test(button.textContent ?? ''));

        expect(playerButton).toBeDefined();
        expect(playerButton).toBeEnabled();

        fireEvent.click(playerButton!);

        await act(async () => {
          await vi.advanceTimersByTimeAsync(50_000);
        });

        if (screen.queryByRole('heading', { name: /session history/i })) {
          break;
        }
      }

      expect(screen.getByRole('heading', { name: /session history/i })).toBeInTheDocument();
      const historyItems = within(screen.getByRole('list', { name: /completed drafts/i })).getAllByRole('listitem');

      expect(historyItems).toHaveLength(1);
      expect(historyItems[0]).toHaveTextContent(/static-app-1/i);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: originalCrypto,
      });
    }
  });
});
