// @spec DFF-STATIC-034
// @spec DFF-STATIC-035
// @spec DFF-STATIC-063
// @spec DFF-STATIC-070
// @spec DFF-STATIC-071
// @spec DFF-STATIC-073
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { DraftConfig, Snapshot } from '../src/ui/types.js';
import { useDraftContext } from '../src/ui/context/DraftContext.js';
import { InMemoryDraftContextProvider } from '../src/ui-static/InMemoryDraftContext.js';

const TEST_SNAPSHOT: Snapshot = {
  exportedAt: '2026-05-22T12:00:00.000Z',
  players: [
    {
      id: 'player-1',
      name: 'Alpha WR',
      position: 'WR',
      nflTeam: 'HOU',
      age: 22,
      isRookie: false,
      dynastyValue: 9100,
      adp: 8,
    },
    {
      id: 'player-2',
      name: 'Bravo QB',
      position: 'QB',
      nflTeam: 'BUF',
      age: 24,
      isRookie: false,
      dynastyValue: 9000,
      adp: 10,
    },
    {
      id: 'player-3',
      name: 'Charlie RB',
      position: 'RB',
      nflTeam: 'DET',
      age: 23,
      isRookie: false,
      dynastyValue: 8800,
      adp: 14,
    },
    {
      id: 'player-4',
      name: 'Delta TE',
      position: 'TE',
      nflTeam: 'KC',
      age: 25,
      isRookie: false,
      dynastyValue: 7600,
      adp: 30,
    },
  ],
  pickValues: [{ year: 2027, round: 1, dynastyValue: 6200 }],
};

const USER_FIRST_CONFIG: DraftConfig = {
  name: 'User First',
  teamCount: 2,
  rounds: 1,
  scoringFormat: 'ppr',
  userPickPosition: 1,
  futurePickYears: 1,
  rosterConfig: {
    QB: 1,
    RB: 1,
    WR: 1,
    TE: 1,
    FLEX: 0,
    SF: 0,
    bench: 0,
  },
};

const BOT_FIRST_CONFIG: DraftConfig = {
  ...USER_FIRST_CONFIG,
  name: 'Bot First',
  userPickPosition: 2,
};

// @spec DFF-STATIC-063
function ContextHarness() {
  const { draftState, sessionHistory, startDraft, submitPick, newDraft } = useDraftContext();

  return (
    <div>
      <button type="button" onClick={() => startDraft(BOT_FIRST_CONFIG)}>
        Start Bot First
      </button>
      <button type="button" onClick={() => startDraft(USER_FIRST_CONFIG)}>
        Start User First
      </button>
      <button type="button" onClick={() => submitPick('player-1')}>
        Submit Alpha
      </button>
      <button type="button" onClick={() => newDraft()}>
        New Draft
      </button>
      <output aria-label="draft status">{draftState?.status ?? 'idle'}</output>
      <output aria-label="pick count">{String(draftState?.picks.length ?? 0)}</output>
      <output aria-label="history count">{String(sessionHistory.length)}</output>
      <output aria-label="history ids">{sessionHistory.map((draft) => draft.draftId).join(',')}</output>
    </div>
  );
}

// @spec DFF-STATIC-063
function withMockedDraftEnvironment(run: () => Promise<void> | void) {
  const originalCrypto = globalThis.crypto;
  let nextId = 0;

  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      randomUUID: () => `draft-test-${++nextId}`,
    },
  });

  return Promise.resolve()
    .then(() => run())
    .finally(() => {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: originalCrypto,
      });
    });
}

beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('InMemoryDraftContextProvider', () => {
  // @spec DFF-STATIC-034
  // @spec DFF-STATIC-035
  // @spec DFF-STATIC-063
  test('waits before a bot pick and halts the bot loop on the user turn', async () => {
    vi.useFakeTimers();

    await withMockedDraftEnvironment(async () => {
      render(
        <InMemoryDraftContextProvider snapshot={TEST_SNAPSHOT}>
          <ContextHarness />
        </InMemoryDraftContextProvider>,
      );

      fireEvent.click(screen.getByRole('button', { name: /start bot first/i }));

      expect(screen.getByLabelText(/draft status/i)).toHaveTextContent('in_progress');
      expect(screen.getByLabelText(/pick count/i)).toHaveTextContent('0');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_499);
      });

      expect(screen.getByLabelText(/pick count/i)).toHaveTextContent('0');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_501);
      });

      expect(screen.getByLabelText(/pick count/i)).toHaveTextContent('1');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(screen.getByLabelText(/pick count/i)).toHaveTextContent('1');
      expect(screen.getByLabelText(/draft status/i)).toHaveTextContent('in_progress');
      expect(screen.getByLabelText(/history count/i)).toHaveTextContent('0');
    });
  });

  // @spec DFF-STATIC-070
  // @spec DFF-STATIC-071
  // @spec DFF-STATIC-073
  test('appends completed drafts to session history, preserves history across newDraft, and never writes browser storage', async () => {
    vi.useFakeTimers();
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    await withMockedDraftEnvironment(async () => {
      render(
        <InMemoryDraftContextProvider snapshot={TEST_SNAPSHOT}>
          <ContextHarness />
        </InMemoryDraftContextProvider>,
      );

      fireEvent.click(screen.getByRole('button', { name: /start user first/i }));
      fireEvent.click(screen.getByRole('button', { name: /submit alpha/i }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      expect(screen.getByLabelText(/history count/i)).toHaveTextContent('1');
      expect(screen.getByLabelText(/history ids/i)).toHaveTextContent('draft-test-1');

      fireEvent.click(screen.getByRole('button', { name: /new draft/i }));

      expect(screen.getByLabelText(/draft status/i)).toHaveTextContent('idle');
      expect(screen.getByLabelText(/history count/i)).toHaveTextContent('1');

      fireEvent.click(screen.getByRole('button', { name: /start user first/i }));
      fireEvent.click(screen.getByRole('button', { name: /submit alpha/i }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      expect(screen.getByLabelText(/history count/i)).toHaveTextContent('2');

      expect(screen.getByLabelText(/history ids/i)).toHaveTextContent('draft-test-1,draft-test-4');
      expect(setItemSpy).not.toHaveBeenCalled();
    });
  });
});
