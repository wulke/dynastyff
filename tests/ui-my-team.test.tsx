// @spec DFF-SLS-080
// @spec DFF-SLS-081
// @spec DFF-SLS-082
// @spec DFF-SM-001
// @spec DFF-SM-002
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

import { MyTeamSection } from '../src/ui/components/MyTeamSection.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type FetchCall = { url: string; init?: RequestInit };

function stubFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }): {
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const resolvedUrl = String(url);
      calls.push({ url: resolvedUrl, init });
      const result = handler(resolvedUrl, init);
      const status = result.status ?? 200;

      return new Response(status === 204 ? null : JSON.stringify(result.body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );

  return { calls };
}

const emptyConnections = { status: 200, body: [] };

function overviewEntry(name: string, position: string, age: number | null, value: number, slotType: string, matched = true) {
  return { name, position, age, dynastyValue: value, slotType, matched };
}

function overviewFixture(overrides: Record<string, unknown> = {}) {
  return {
    overallGrade: 'B',
    overallPercentile: 62,
    teamContext: { classification: 'contender', winPct: 0.75, rank: 2, teamCount: 10 },
    positions: {
      QB: {
        grade: 'A', percentile: 90, valueScore: 92, rawStarterValue: 6100, ageCurveScore: 64, depthScore: 70,
        starters: [overviewEntry('Josh Allen', 'QB', 30, 6100, 'starter')],
      },
      RB: {
        grade: 'C', percentile: 40, valueScore: 55, rawStarterValue: 4100, ageCurveScore: 71, depthScore: 45,
        starters: [overviewEntry('Bijan Robinson', 'RB', 24, 4100, 'starter')],
      },
      WR: {
        grade: 'B', percentile: 60, valueScore: 74, rawStarterValue: 5200, ageCurveScore: 58, depthScore: 61,
        starters: [overviewEntry('Justin Jefferson', 'WR', 25, 5200, 'starter')],
      },
      TE: {
        grade: 'D', percentile: 25, valueScore: 38, rawStarterValue: 1500, ageCurveScore: 44, depthScore: 30,
        starters: [overviewEntry('Travis Kelce', 'TE', 36, 1500, 'starter')],
      },
    },
    roster: [
      overviewEntry('Josh Allen', 'QB', 30, 6100, 'starter'),
      overviewEntry('Bijan Robinson', 'RB', 24, 4100, 'starter'),
      overviewEntry('Justin Jefferson', 'WR', 25, 5200, 'starter'),
      overviewEntry('Travis Kelce', 'TE', 36, 1500, 'starter'),
      overviewEntry('Chris Olave', 'WR', 24, 3400, 'bench'),
      overviewEntry('Trey Benson', 'RB', 23, 1100, 'taxi'),
      overviewEntry('Kirk Cousins', 'QB', 37, 600, 'ir'),
      overviewEntry('Rookie Unknown', 'QB', null, 0, 'bench', false),
    ],
    staleSince: null,
    lastSyncedAt: '2026-09-27T10:00:00.000Z',
    ...overrides,
  };
}

// @spec DFF-SM-001
// @spec DFF-SM-002
test('MyTeamSection renders the connection prompt when no league is connected', async () => {
  stubFetch(() => emptyConnections);

  render(<MyTeamSection />);

  expect(await screen.findByText(/connect your sleeper league/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/sleeper username/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/sleeper league id/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /find my leagues/i })).toBeDisabled();
});

// @spec DFF-SLS-080
test('the username flow lists dynasty leagues and connects the selected one', async () => {
  const user = userEvent.setup();
  let connections: unknown[] = [];
  const { calls } = stubFetch((url, init) => {
    if (url === '/sleeper/connections' && !init?.method) {
      return { body: connections };
    }

    if (url === '/sleeper/sync/status') {
      return { body: [] };
    }

    if (url === '/sleeper/user/trev') {
      return {
        body: {
          userId: 'u1',
          username: 'trev',
          leagues: [
            { leagueId: '111', name: 'Gridiron Guild', season: '2026', totalRosters: 12, status: 'in_season' },
          ],
        },
      };
    }

    if (url === '/season/111/overview') {
      return { body: overviewFixture() };
    }

    if (url === '/sleeper/connections' && init?.method === 'POST') {
      connections = [
        { id: 'c1', leagueId: '111', leagueName: 'Gridiron Guild', season: '2026', rosterId: 2, lastSyncedAt: null },
      ];
      return { status: 201, body: { id: 'c1', leagueId: '111' } };
    }

    return { status: 404, body: { error: 'not found' } };
  });

  render(<MyTeamSection />);

  await screen.findByText(/connect your sleeper league/i);

  await user.type(screen.getByLabelText(/sleeper username/i), 'trev');
  await user.click(screen.getByRole('button', { name: /find my leagues/i }));

  expect(await screen.findByText('Gridiron Guild')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Connect' }));

  // @spec DFF-SM-003 — the Roster Overview is the landing view after connecting.
  await waitFor(() => {
    expect(screen.getByText('Roster Overview')).toBeInTheDocument();
  });

  const connectCall = calls.find((call) => call.url === '/sleeper/connections' && call.init?.method === 'POST');
  expect(connectCall).toBeDefined();
  expect(JSON.parse(String(connectCall?.init?.body))).toEqual({
    username: 'trev',
    league_id: '111',
  });
});

// @spec DFF-SLS-081
test('the direct league ID flow previews the league before connecting', async () => {
  const user = userEvent.setup();
  let connections: unknown[] = [];
  const { calls } = stubFetch((url, init) => {
    if (url === '/sleeper/connections' && !init?.method) {
      return { body: connections };
    }

    if (url === '/sleeper/sync/status') {
      return { body: [] };
    }

    if (url === '/sleeper/league/123456789') {
      return {
        body: { leagueId: '123456789', name: 'Preview League', season: '2026', totalRosters: 10, status: 'in_season' },
      };
    }

    if (url === '/season/123456789/overview') {
      return { body: overviewFixture() };
    }

    if (url === '/sleeper/connections' && init?.method === 'POST') {
      connections = [
        { id: 'c2', leagueId: '123456789', leagueName: 'Preview League', season: '2026', rosterId: 1, lastSyncedAt: null },
      ];
      return { status: 201, body: { id: 'c2', leagueId: '123456789' } };
    }

    return { status: 404, body: { error: 'not found' } };
  });

  render(<MyTeamSection />);

  await screen.findByText(/connect your sleeper league/i);

  await user.type(screen.getByLabelText(/sleeper username/i), 'trev');
  await user.type(screen.getByLabelText(/sleeper league id/i), '123456789');
  await user.click(screen.getByRole('button', { name: /preview league/i }));

  expect(await screen.findByText('Preview League')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Connect' }));

  // @spec DFF-SM-003
  await waitFor(() => {
    expect(screen.getByText('Roster Overview')).toBeInTheDocument();
  });

  expect(
    calls.some((call) => call.url === '/sleeper/league/123456789'),
  ).toBe(true);
});

// @spec DFF-SLS-082
// @spec DFF-SM-003
test('connected state lands on the roster overview and manages connections behind a toggle', async () => {
  const user = userEvent.setup();
  let connections = [
    {
      id: 'c1',
      leagueId: '111',
      leagueName: 'Gridiron Guild',
      season: '2026',
      rosterId: 2,
      lastSyncedAt: '2026-09-27T10:00:00.000Z',
    },
  ];

  const { calls } = stubFetch((url, init) => {
    if (url === '/sleeper/connections' && !init?.method) {
      return { body: connections };
    }

    if (url === '/sleeper/connections/c1' && init?.method === 'DELETE') {
      connections = [];
      return { status: 204, body: null };
    }

    if (url === '/sleeper/sync/status') {
      return {
        body: [
          {
            leagueId: '111',
            leagueName: 'Gridiron Guild',
            lastSyncedAt: '2026-09-27T10:00:00.000Z',
            lastRun: { startedAt: '2026-09-27T10:00:00.000Z', completedAt: '2026-09-27T10:00:05.000Z', error: null },
          },
        ],
      };
    }

    if (url === '/season/111/overview') {
      return { body: overviewFixture() };
    }

    if (url === '/sleeper/sync' && init?.method === 'POST') {
      return { body: { skipped: false, attempted: ['111'], succeeded: ['111'], outcomes: [] } };
    }

    return { status: 404, body: { error: 'not found' } };
  });

  render(<MyTeamSection />);

  // @spec DFF-SM-019 — header grade + percentile, per-position rows with starter names.
  expect(await screen.findByText('Roster Overview')).toBeInTheDocument();
  expect(screen.getByText('PCTL 62')).toBeInTheDocument();
  expect(screen.getByText('PCTL 90')).toBeInTheDocument();
  expect(screen.getAllByText(/josh allen/i).length).toBeGreaterThan(0);

  // @spec DFF-SM-026 — team context badge.
  expect(screen.getByText('contender')).toBeInTheDocument();

  // @spec DFF-SM-084 — IR and unmatched players remain visible in roster display.
  expect(screen.getByText(/kirk cousins/i)).toBeInTheDocument();
  expect(screen.getByText('unmatched')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /manage connections/i }));

  expect(await screen.findByText(/connected leagues/i)).toBeInTheDocument();
  expect(screen.getByText(/synced /i)).toBeInTheDocument();
  expect(screen.getByText('ok')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /sync now/i }));

  await waitFor(() => {
    expect(
      calls.some((call) => call.url === '/sleeper/sync' && call.init?.method === 'POST'),
    ).toBe(true);
  });

  await user.click(screen.getByRole('button', { name: /disconnect/i }));

  await waitFor(() => {
    expect(screen.getByText(/connect your sleeper league/i)).toBeInTheDocument();
  });

  expect(
    calls.some((call) => call.url === '/sleeper/connections/c1' && call.init?.method === 'DELETE'),
  ).toBe(true);
});

// @spec DFF-SM-004
// @spec DFF-SM-081
test('stale overview shows a warning and refresh re-syncs then re-fetches', async () => {
  const user = userEvent.setup();
  const connections = [
    {
      id: 'c1',
      leagueId: '111',
      leagueName: 'Gridiron Guild',
      season: '2026',
      rosterId: 2,
      lastSyncedAt: '2026-09-27T08:00:00.000Z',
    },
  ];
  const { calls } = stubFetch((url, init) => {
    if (url === '/sleeper/connections' && !init?.method) {
      return { body: connections };
    }

    if (url === '/sleeper/sync/status') {
      return { body: [] };
    }

    if (url === '/season/111/overview') {
      return { body: overviewFixture({ staleSince: '2026-09-27T08:00:00.000Z' }) };
    }

    if (url === '/sleeper/sync' && init?.method === 'POST') {
      return { body: { skipped: false, attempted: ['111'], succeeded: ['111'], outcomes: [] } };
    }

    return { status: 404, body: { error: 'not found' } };
  });

  render(<MyTeamSection />);

  expect(await screen.findByText(/stale/i)).toBeInTheDocument();

  const overviewFetchesBefore = calls.filter((call) => call.url === '/season/111/overview').length;
  await user.click(screen.getByRole('button', { name: /refresh/i }));

  await waitFor(() => {
    expect(
      calls.some((call) => call.url === '/sleeper/sync' && call.init?.method === 'POST'),
    ).toBe(true);
  });

  await waitFor(() => {
    expect(calls.filter((call) => call.url === '/season/111/overview').length).toBeGreaterThan(
      overviewFetchesBefore,
    );
  });
});

// @spec DFF-SM-003
test('multiple connected leagues switch via tabs', async () => {
  const user = userEvent.setup();
  const connections = [
    { id: 'c1', leagueId: '111', leagueName: 'Gridiron Guild', season: '2026', rosterId: 2, lastSyncedAt: null },
    { id: 'c2', leagueId: '222', leagueName: 'Second League', season: '2026', rosterId: 5, lastSyncedAt: null },
  ];
  const { calls } = stubFetch((url) => {
    if (url === '/sleeper/connections') {
      return { body: connections };
    }

    if (url === '/sleeper/sync/status') {
      return { body: [] };
    }

    if (url === '/season/111/overview') {
      return { body: overviewFixture() };
    }

    if (url === '/season/222/overview') {
      return { body: overviewFixture({ overallGrade: 'A', overallPercentile: 88 }) };
    }

    return { status: 404, body: { error: 'not found' } };
  });

  render(<MyTeamSection />);

  expect(await screen.findByText('Roster Overview')).toBeInTheDocument();
  expect(screen.getByText('PCTL 62')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Second League' }));

  await waitFor(() => {
    expect(screen.getByText('PCTL 88')).toBeInTheDocument();
  });

  expect(calls.some((call) => call.url === '/season/222/overview')).toBe(true);
});

function pendingTradeFixture() {
  return {
    trades: [
      {
        transactionId: '555',
        assetsOut: [{ kind: 'player', label: 'Chris Olave', dynastyValue: 3400, direction: 'out' }],
        assetsIn: [{ kind: 'player', label: 'Jordan Love', dynastyValue: 3800, direction: 'in' }],
        compositeScore: 24.5,
        verdict: 'win',
        warnings: [],
      },
    ],
  };
}

// @spec DFF-SM-039
test('pending offers render verdict badges and inline Claude reasoning', async () => {
  const user = userEvent.setup();
  const connections = [
    { id: 'c1', leagueId: '111', leagueName: 'Gridiron Guild', season: '2026', rosterId: 1, lastSyncedAt: '2026-09-27T10:00:00.000Z' },
  ];
  const { calls } = stubFetch((url, init) => {
    if (url === '/sleeper/connections') return { body: connections };
    if (url === '/sleeper/sync/status') return { body: [] };
    if (url === '/season/111/overview') return { body: overviewFixture() };
    if (url === '/season/111/trades/pending') return { body: pendingTradeFixture() };
    if (url === '/season/111/trades/analyze' && init?.method === 'POST') {
      return {
        body: {
          transactionId: '555',
          score: { verdict: 'win' },
          narrative: '**Verdict:** Win\n**Recommendation:** accept the deal',
          claudeUnavailable: false,
        },
      };
    }
    return { status: 404, body: { error: 'not found' } };
  });

  render(<MyTeamSection />);

  expect(await screen.findByText('Pending Offers')).toBeInTheDocument();
  expect(screen.getByText('win')).toBeInTheDocument();
  expect(screen.getByText(/Send Chris Olave/)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /analyze/i }));

  expect(await screen.findByText(/accept the deal/)).toBeInTheDocument();

  const analyzeCall = calls.find((call) => call.url === '/season/111/trades/analyze');
  expect(JSON.parse(String(analyzeCall?.init?.body))).toEqual({ transaction_id: '555' });
});

// @spec DFF-SM-043
test('pending offers show a fallback note when Claude is unavailable', async () => {
  const user = userEvent.setup();
  const connections = [
    { id: 'c1', leagueId: '111', leagueName: 'Gridiron Guild', season: '2026', rosterId: 1, lastSyncedAt: '2026-09-27T10:00:00.000Z' },
  ];
  stubFetch((url, init) => {
    if (url === '/sleeper/connections') return { body: connections };
    if (url === '/sleeper/sync/status') return { body: [] };
    if (url === '/season/111/overview') return { body: overviewFixture() };
    if (url === '/season/111/trades/pending') return { body: pendingTradeFixture() };
    if (url === '/season/111/trades/analyze' && init?.method === 'POST') {
      return { body: { transactionId: '555', score: {}, narrative: null, claudeUnavailable: true } };
    }
    return { status: 404, body: { error: 'not found' } };
  });

  render(<MyTeamSection />);

  await screen.findByText('Pending Offers');
  await user.click(screen.getByRole('button', { name: /analyze/i }));

  expect(await screen.findByText(/Claude is unavailable/i)).toBeInTheDocument();
});

function recommendationsFixture() {
  return {
    groups: {
      qb: { label: 'QB targets', candidates: [] },
      rb: {
        label: 'RB targets',
        candidates: [
          {
            teamRosterId: 2,
            teamName: 'Rival Squad',
            rationale: 'Swap surplus WR depth for RB help',
            score: {
              transactionId: '-2001',
              assetsOut: [{ kind: 'player', label: 'Chris Olave', dynastyValue: 3400, direction: 'out' }],
              assetsIn: [{ kind: 'player', label: 'Breece Hall', dynastyValue: 3800, direction: 'in' }],
              compositeScore: 18.2,
              verdict: 'win',
              warnings: [],
            },
            offer: {
              transactionId: -2001,
              status: 'hypothetical',
              proposerRosterId: 2,
              responderRosterIds: [1],
              adds: { 'p-rb': 1 },
              drops: { 'p-rb': 2, 'p-wr': 1 },
              draftPicks: [],
              createdAt: '2026-09-27T00:00:00.000Z',
            },
          },
        ],
      },
      wr: { label: 'WR targets', candidates: [] },
      te: { label: 'TE targets', candidates: [] },
      picks: { label: 'Pick acquisitions', candidates: [] },
      sell: { label: 'Value sells', candidates: [] },
    },
    lastComputedAt: '2026-09-27T12:00:00.000Z',
  };
}

// @spec DFF-SM-057
// @spec DFF-SM-056
test('trade recommendations render as a grouped accordion and analyze posts the hypothetical offer', async () => {
  const user = userEvent.setup();
  const connections = [
    { id: 'c1', leagueId: '111', leagueName: 'Gridiron Guild', season: '2026', rosterId: 1, lastSyncedAt: '2026-09-27T10:00:00.000Z' },
  ];
  const { calls } = stubFetch((url, init) => {
    if (url === '/sleeper/connections') return { body: connections };
    if (url === '/sleeper/sync/status') return { body: [] };
    if (url === '/season/111/overview') return { body: overviewFixture() };
    if (url === '/season/111/trades/pending') return { body: { trades: [] } };
    if (url === '/season/111/trades/recommendations') return { body: recommendationsFixture() };
    if (url === '/season/111/trades/analyze' && init?.method === 'POST') {
      return {
        body: {
          transactionId: '-2001',
          score: { verdict: 'win' },
          narrative: '**Verdict:** Win\n**Recommendation:** send it',
          claudeUnavailable: false,
        },
      };
    }
    return { status: 404, body: { error: 'not found' } };
  });

  render(<MyTeamSection />);

  expect(await screen.findByText('Trade Recommendations')).toBeInTheDocument();
  expect(screen.getByText('RB targets')).toBeInTheDocument();
  expect(screen.getByText('Rival Squad')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /analyze/i }));

  expect(await screen.findByText(/send it/)).toBeInTheDocument();

  const analyzeCall = calls.find((call) => call.url === '/season/111/trades/analyze');
  const body = JSON.parse(String(analyzeCall?.init?.body)) as { trade_offer: { proposerRosterId: number } };

  expect(body.trade_offer.proposerRosterId).toEqual(2);
});
