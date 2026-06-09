// @spec DFF-UI-110
// @spec DFF-UI-111
// @spec DFF-UI-112
// @spec DFF-UI-113
// @spec DFF-UI-114
// @spec DFF-UI-115
// @spec DFF-UI-116
// @spec DFF-UI-117
// @spec DFF-UI-118
import { act, cleanup, render, screen, within } from '@testing-library/react';
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
  MockEventSource.instances = [];
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// @spec DFF-UI-110
function createDraftsFetchResponse() {
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify([
        {
          id: 'draft-in-progress-1',
          created_at: '2026-05-20T12:00:00.000Z',
          completed_at: null,
          status: 'in_progress',
          scoring_format: 'ppr',
          team_count: 12,
          rounds: 20,
        },
        {
          id: 'draft-completed-1',
          created_at: '2026-05-19T10:00:00.000Z',
          completed_at: '2026-05-19T15:00:00.000Z',
          status: 'completed',
          scoring_format: 'half_ppr',
          team_count: 10,
          rounds: 18,
        },
      ]),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    ),
  );
}

// @spec DFF-UI-110
test('renders the drafts list page when drafts exist on app load', async () => {
  createDraftsFetchResponse();

  render(<App />);

  expect(await screen.findByRole('heading', { name: /drafts list/i })).toBeInTheDocument();
});

// @spec DFF-UI-112
test('drafts list table shows status, date, team count, rounds, and scoring format for each draft', async () => {
  createDraftsFetchResponse();

  render(<App />);

  await screen.findByRole('heading', { name: /drafts list/i });

  const rows = screen.getAllByTestId(/^draft-row-/);
  expect(rows).toHaveLength(2);
});

// @spec DFF-UI-111
// @spec DFF-UI-118
test('renders the config screen when GET /drafts returns empty array', async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

  render(<App />);

  expect(await screen.findByRole('heading', { name: /config screen/i })).toBeInTheDocument();
});

// @spec DFF-UI-113
test('resume button appears only for in-progress drafts', async () => {
  createDraftsFetchResponse();

  render(<App />);

  await screen.findByRole('heading', { name: /drafts list/i });

  // In-progress draft should have Resume button
  const inProgressRow = screen.getByTestId('draft-row-draft-in-progress-1');
  expect(within(inProgressRow).getByRole('button', { name: /resume/i })).toBeInTheDocument();

  // Completed draft should not have Resume button
  const completedRow = screen.getByTestId('draft-row-draft-completed-1');
  expect(within(completedRow).queryByRole('button', { name: /resume/i })).not.toBeInTheDocument();
});

// @spec DFF-UI-116
test('renders a loading state instead of the config screen while GET /drafts is in flight', async () => {
  const draftsDeferred = createDeferred<Response>();
  fetchMock.mockReturnValueOnce(draftsDeferred.promise);

  render(<App />);

  expect(screen.getByRole('heading', { name: /loading drafts/i })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /config screen/i })).not.toBeInTheDocument();

  await act(async () => {
    draftsDeferred.resolve(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  expect(await screen.findByRole('heading', { name: /config screen/i })).toBeInTheDocument();
});

// @spec DFF-UI-114
test('review button appears for all drafts', async () => {
  createDraftsFetchResponse();

  render(<App />);

  await screen.findByRole('heading', { name: /drafts list/i });

  const allDraftRows = screen.getAllByTestId(/^draft-row-/);
  for (const row of allDraftRows) {
    expect(within(row).getByRole('button', { name: /review/i })).toBeInTheDocument();
  }
});

// @spec DFF-UI-115
test('new draft button on drafts list page navigates to config screen', async () => {
  createDraftsFetchResponse();

  render(<App />);

  await screen.findByRole('heading', { name: /drafts list/i });

  await userEvent.setup().click(screen.getByRole('button', { name: /new draft/i }));

  expect(
    screen.getByRole('heading', { name: /config screen/i }),
  ).toBeInTheDocument();
});

// @spec DFF-UI-113
test('resume button navigates to the draft board and loads draft state', async () => {
  createDraftsFetchResponse();

  render(<App />);

  await screen.findByRole('heading', { name: /drafts list/i });

  // Mock the state fetch for loadDraft
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        draft_id: 'draft-in-progress-1',
        status: 'in_progress',
        current_pick_number: 5,
        teams: [
          { id: 'team-1', name: 'Bot 1', is_user: false, archetype: 'bpa' },
          { id: 'team-2', name: 'You', is_user: true, archetype: null },
        ],
        draft_order: [
          { pick_number: 1, round: 1, pick_in_round: 1, team_id: 'team-1' },
          { pick_number: 2, round: 1, pick_in_round: 2, team_id: 'team-2' },
        ],
        picks: [],
        roster_players: [],
        team_pick_assets: [],
        user_queue: [],
        available_players: [],
        trades: [],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    ),
  );

  await userEvent.setup().click(
    within(screen.getByTestId('draft-row-draft-in-progress-1')).getByRole('button', { name: /resume/i }),
  );

  expect(await screen.findByRole('heading', { name: /draft board/i })).toBeInTheDocument();
});

// @spec DFF-UI-146
test('review button navigates to the draft grade summary view for a completed draft', async () => {
  createDraftsFetchResponse();

  render(<App />);

  await screen.findByRole('heading', { name: /drafts list/i });

  // Mock the state fetch for loadDraft
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        draft_id: 'draft-completed-1',
        status: 'completed',
        current_pick_number: null,
        teams: [
          { id: 'team-1', name: 'Bot 1', is_user: false, archetype: 'bpa' },
          { id: 'team-2', name: 'You', is_user: true, archetype: null },
        ],
        draft_order: [
          { pick_number: 1, round: 1, pick_in_round: 1, team_id: 'team-1' },
          { pick_number: 2, round: 1, pick_in_round: 2, team_id: 'team-2' },
        ],
        picks: [],
        roster_players: [],
        team_pick_assets: [],
        user_queue: [],
        available_players: [],
        trades: [],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    ),
  );

  await userEvent.setup().click(
    within(screen.getByTestId('draft-row-draft-completed-1')).getByRole('button', { name: /review/i }),
  );

  expect(await screen.findByRole('heading', { name: /draft grade summary/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /view full history/i })).toBeInTheDocument();
});

// @spec DFF-UI-114
test('review button navigates to the draft history view for an in-progress draft', async () => {
  createDraftsFetchResponse();

  render(<App />);

  await screen.findByRole('heading', { name: /drafts list/i });

  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        draft_id: 'draft-in-progress-1',
        status: 'in_progress',
        current_pick_number: 5,
        teams: [
          { id: 'team-1', name: 'Bot 1', is_user: false, archetype: 'bpa' },
          { id: 'team-2', name: 'You', is_user: true, archetype: null },
        ],
        draft_order: [
          { pick_number: 1, round: 1, pick_in_round: 1, team_id: 'team-1' },
          { pick_number: 2, round: 1, pick_in_round: 2, team_id: 'team-2' },
        ],
        picks: [],
        roster_players: [],
        team_pick_assets: [],
        user_queue: [],
        available_players: [],
        trades: [],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    ),
  );

  await userEvent.setup().click(
    within(screen.getByTestId('draft-row-draft-in-progress-1')).getByRole('button', { name: /review/i }),
  );

  expect(await screen.findByRole('heading', { name: /draft summary/i })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /pick log/i })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /draft grade summary/i })).not.toBeInTheDocument();
});

// @spec DFF-UI-117
test('falls back to config screen when GET /drafts fails', async () => {
  fetchMock.mockRejectedValue(new Error('Network error'));

  render(<App />);

  expect(await screen.findByRole('heading', { name: /config screen/i })).toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load drafts.');
});

// @spec DFF-UI-117
test('falls back to config screen and shows a toast when GET /drafts returns a non-ok response', async () => {
  fetchMock.mockResolvedValue(new Response('', { status: 500 }));

  render(<App />);

  expect(await screen.findByRole('heading', { name: /config screen/i })).toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load drafts.');
});

// @spec DFF-UI-113
test('resume stays on the drafts list and shows a toast when loadDraft fails', async () => {
  createDraftsFetchResponse();

  render(<App />);

  await screen.findByRole('heading', { name: /drafts list/i });

  fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));

  await userEvent.setup().click(
    within(screen.getByTestId('draft-row-draft-in-progress-1')).getByRole('button', { name: /resume/i }),
  );

  expect(screen.getByRole('heading', { name: /drafts list/i })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /draft board/i })).not.toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load draft state.');
});

// @spec DFF-UI-114
test('review stays on the drafts list and shows a toast when loadDraft fails', async () => {
  createDraftsFetchResponse();

  render(<App />);

  await screen.findByRole('heading', { name: /drafts list/i });

  fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));

  await userEvent.setup().click(
    within(screen.getByTestId('draft-row-draft-completed-1')).getByRole('button', { name: /review/i }),
  );

  expect(screen.getByRole('heading', { name: /drafts list/i })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /draft grade summary/i })).not.toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load draft state.');
});

// @spec DFF-UI-112
test('drafts list table displays draft data correctly with status badges and formatted dates', async () => {
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify([
        {
          id: 'draft-ppr-1',
          created_at: '2026-05-18T12:00:00.000Z',
          completed_at: null,
          status: 'in_progress',
          scoring_format: 'ppr',
          team_count: 14,
          rounds: 22,
        },
      ]),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    ),
  );

  render(<App />);

  await screen.findByRole('heading', { name: /drafts list/i });

  const row = screen.getByTestId('draft-row-draft-ppr-1');
  expect(within(row).getByText(/in progress/i)).toBeInTheDocument();
  expect(within(row).getByText(/14/i)).toBeInTheDocument();
  expect(within(row).getByText(/22/i)).toBeInTheDocument();
  expect(within(row).getByText('PPR')).toBeInTheDocument();
});
