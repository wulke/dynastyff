// @spec DFF-SLS-001
// @spec DFF-SLS-003
// @spec DFF-SLS-030
// @spec DFF-SLS-031
// @spec DFF-SLS-032
// @spec DFF-SLS-033
// @spec DFF-SLS-034
// @spec DFF-SLS-035
// @spec DFF-SLS-036
// @spec DFF-SLS-037
// @spec DFF-SLS-040
// @spec DFF-SLS-041
// @spec DFF-SLS-042
// @spec DFF-SLS-043
// @spec DFF-SLS-050
// @spec DFF-SLS-051
// @spec DFF-SLS-052
// @spec DFF-SLS-053
// @spec DFF-SLS-054
// @spec DFF-SLS-060
// @spec DFF-SLS-061
// @spec DFF-SLS-062
// @spec DFF-SLS-070
// @spec DFF-SLS-071
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import DatabaseConstructor from 'better-sqlite3';

import { initializeDatabase } from '../src/db/init.js';
import { deriveSeasonYear } from '../src/etl/sleeper/season.js';
import { runSleeperSync } from '../src/etl/sleeper/sync.js';
import type { FetchLike, SyncLogger } from '../src/etl/sleeper/types.js';

const fixedNow = () => new Date('2026-09-27T12:00:00.000Z');

type Fixture = {
  dbPath: string;
  cachePath: string;
  aliasesPath: string;
  cleanup: () => void;
};

function createFixture(): Fixture {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-sleeper-sync-'));
  const dbPath = path.join(tempDir, 'test.sqlite');
  initializeDatabase(dbPath);

  const aliasesPath = path.join(tempDir, 'aliases.json');
  fs.writeFileSync(aliasesPath, JSON.stringify({ aliases: [] }));

  return {
    dbPath,
    cachePath: path.join(tempDir, 'registry-cache.json'),
    aliasesPath,
    cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
  };
}

function openDb(fixture: Fixture): Database.Database {
  const db = new DatabaseConstructor(fixture.dbPath);
  db.pragma('foreign_keys = ON');
  return db;
}

function seedPlayer(db: Database.Database, id: string, name: string, position: string): void {
  db.prepare(
    `INSERT INTO players (id, name, position, dynasty_value, updated_at)
     VALUES (?, ?, ?, 5000, '2026-05-01T00:00:00.000Z')`,
  ).run(id, name, position);
}

function seedConnection(db: Database.Database, leagueId: string, leagueName: string): void {
  db.prepare(
    `INSERT INTO sleeper_connections (id, league_id, league_name, season, user_id, roster_id, connected_at)
     VALUES ('conn-${leagueId}', ?, ?, '2026', 'u1', 1, '2026-09-01T00:00:00.000Z')`,
  ).run(leagueId, leagueName);
}

function createLogger(): SyncLogger & { warnings: string[]; errors: string[]; infos: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  const infos: string[] = [];

  return {
    warnings,
    errors,
    infos,
    info: (message) => infos.push(message),
    warn: (message) => warnings.push(message),
    error: (message) => errors.push(message),
  };
}

type RouteHandler = () => { httpStatus?: number; body: unknown } | unknown;

function createFakeSleeperFetch(routes: Record<string, RouteHandler>): FetchLike & {
  calls: string[];
} {
  const calls: string[] = [];

  const fetchImpl: FetchLike & { calls: string[] } = async (url: string) => {
    const pathname = new URL(url).pathname;

    for (const [route, handler] of Object.entries(routes)) {
      if (!pathname.endsWith(route)) {
        continue;
      }

      calls.push(pathname);
      const result = handler() as { httpStatus?: number; body: unknown } | undefined;
      const isError =
        typeof result === 'object' && result !== null && 'httpStatus' in result;
      const status = isError ? (result as { httpStatus: number }).httpStatus : 200;
      const body = isError ? (result as { body: unknown }).body : result;

      return new Response(body === undefined ? null : JSON.stringify(body), {
        status: status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(null), { status: 404 });
  };

  fetchImpl.calls = calls;
  return fetchImpl;
}

function registryPayload(): Record<string, unknown> {
  return {
    p1: { player_id: 'p1', full_name: 'Josh Allen', position: 'QB', team: 'BUF' },
    p2: { player_id: 'p2', full_name: "Ja'Marr Chase", position: 'WR', team: 'CIN' },
    p3: { player_id: 'p3', full_name: 'Mystery Back', position: 'RB', team: 'KC' },
    p4: { player_id: 'p4', full_name: 'Devy Prospect', position: 'WR', team: 'KC' },
  };
}

function leaguePayload(): Record<string, unknown> {
  return {
    league_id: '111111111111111111',
    name: 'Gridiron Guild',
    season: '2026',
    total_rosters: 2,
    status: 'in_season',
    settings: {},
    scoring_settings: { rec: 1, bonus_rec_te: 0 },
    roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'BN', 'BN'],
  };
}

function rostersPayload(): Array<Record<string, unknown>> {
  return [
    {
      roster_id: 1,
      owner_id: 'u1',
      players: ['p1', 'p2', 'p3', 'p4'],
      starters: ['p1', 'p2'],
      taxi: ['p4'],
      reserve: ['p3'],
      settings: { wins: 3, losses: 1, ties: 0, fpts: 400, fpts_decimal: 0.5, fpts_against: 350.25 },
    },
    {
      roster_id: 2,
      owner_id: 'u2',
      players: [],
      starters: [],
      taxi: [],
      reserve: [],
      settings: { wins: 1, losses: 3, ties: 0, fpts: 300, fpts_against: 401.75 },
    },
  ];
}

function usersPayload(): Array<Record<string, unknown>> {
  return [
    { user_id: 'u1', display_name: 'Trev', metadata: { team_name: 'Trev Team' } },
    { user_id: 'u2', display_name: 'Ana', metadata: {} },
  ];
}

function transactionsPayload(week: number): Array<Record<string, unknown>> {
  if (week === 1) {
    return [
      { transaction_id: 501, type: 'trade', status: 'pending', roster_ids: [1, 2], consenter_ids: [1, 2], adds: { p1: 2 }, drops: {}, draft_picks: [{ season: '2027', round: 1, roster_id: 1, previous_owner_id: 2 }], created: 1690000000000, status_updated: 1690000001000 },
      { transaction_id: 502, type: 'waiver', status: 'complete', roster_ids: [2], adds: { p3: 2 }, drops: {} },
      { transaction_id: 503, type: 'trade', status: 'complete', roster_ids: [2, 1], adds: { p2: 1 }, drops: {}, draft_picks: [], created: 1680000000000, status_updated: 1680000000000 },
    ];
  }

  if (week === 2) {
    return [
      { transaction_id: 504, type: 'trade', status: 'dropped', roster_ids: [1, 2], adds: {}, drops: {}, draft_picks: [], created: 1685000000000, status_updated: 1685000000000 },
    ];
  }

  return [];
}

function tradedPicksPayload(): Array<Record<string, unknown>> {
  return [
    { season: '2027', round: 1, roster_id: 2, previous_owner_id: 2, owner_id: 1 },
    { season: '2027', round: 2, roster_id: 1, previous_owner_id: 1, owner_id: 2 },
    { season: '2028', round: 1, roster_id: 1, previous_owner_id: 1, owner_id: 1 },
  ];
}

function createHappyPathRoutes(): Record<string, RouteHandler> {
  return {
    '/state/nfl': () => ({ season: '2026', week: 2, season_type: 'regular' }),
    '/league/111111111111111111': leaguePayload,
    '/league/111111111111111111/rosters': rostersPayload,
    '/league/111111111111111111/users': usersPayload,
    '/league/111111111111111111/traded_picks': tradedPicksPayload,
    '/league/111111111111111111/transactions/0': () => transactionsPayload(0),
    '/league/111111111111111111/transactions/1': () => transactionsPayload(1),
    '/league/111111111111111111/transactions/2': () => transactionsPayload(2),
    '/players/nfl': registryPayload,
  };
}

function syncOptions(fixture: Fixture, fetchImpl: FetchLike, logger: SyncLogger) {
  return {
    databasePath: fixture.dbPath,
    fetchImpl,
    now: fixedNow,
    aliasesPath: fixture.aliasesPath,
    registryCachePath: fixture.cachePath,
    logger,
  };
}

// @spec DFF-SLS-070
// @spec DFF-SLS-071
test('deriveSeasonYear switches to the current year in September (UTC)', () => {
  assert.equal(deriveSeasonYear(new Date('2026-08-31T23:59:59.000Z')), 2025);
  assert.equal(deriveSeasonYear(new Date('2026-09-01T00:00:00.000Z')), 2026);
  assert.equal(deriveSeasonYear(new Date('2026-01-15T00:00:00.000Z')), 2025);
  assert.equal(deriveSeasonYear(new Date('2026-12-31T23:59:59.000Z')), 2026);
});

// @spec DFF-SLS-003
test('runSleeperSync skips silently when no leagues are connected', async () => {
  const fixture = createFixture();
  const logger = createLogger();
  const fetchImpl = createFakeSleeperFetch({});

  try {
    const result = await runSleeperSync(syncOptions(fixture, fetchImpl, logger));

    assert.equal(result.skipped, true);
    assert.deepEqual(result.attempted, []);
    assert.equal(logger.infos.length, 1);
    assert.match(logger.infos[0], /No connected leagues configured/);
    assert.equal(fetchImpl.calls.length, 0);

    const db = openDb(fixture);
    try {
      const runs = db.prepare('SELECT COUNT(*) AS total FROM sleeper_sync_runs').get() as { total: number };
      assert.equal(runs.total, 0);
    } finally {
      db.close();
    }
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SLS-030
// @spec DFF-SLS-031
// @spec DFF-SLS-032
// @spec DFF-SLS-033
// @spec DFF-SLS-037
// @spec DFF-SLS-040
// @spec DFF-SLS-041
// @spec DFF-SLS-042
// @spec DFF-SLS-043
// @spec DFF-SLS-050
// @spec DFF-SLS-051
// @spec DFF-SLS-052
// @spec DFF-SLS-053
// @spec DFF-SLS-054
test('runSleeperSync persists full league state for a connected league', async () => {
  const fixture = createFixture();
  const logger = createLogger();

  {
    const db = openDb(fixture);
    try {
      seedPlayer(db, 'qb-josh-allen', 'Josh Allen', 'QB');
      seedPlayer(db, 'wr-jamarr-chase', "Ja'Marr Chase", 'WR');
      seedConnection(db, '111111111111111111', 'Gridiron Guild');
    } finally {
      db.close();
    }
  }

  const fetchImpl = createFakeSleeperFetch(createHappyPathRoutes());

  try {
    const result = await runSleeperSync(syncOptions(fixture, fetchImpl, logger));

    assert.equal(result.skipped, false);
    assert.deepEqual(result.succeeded, ['111111111111111111']);
    assert.equal(result.outcomes[0]?.ok, true);

    // Week sweep: transactions fetched for weeks 0..currentWeek (2).
    const transactionCalls = fetchImpl.calls.filter((call) => call.includes('/transactions/'));
    assert.deepEqual(transactionCalls, [
      '/v1/league/111111111111111111/transactions/0',
      '/v1/league/111111111111111111/transactions/1',
      '/v1/league/111111111111111111/transactions/2',
    ]);

    const db = openDb(fixture);
    try {
      const league = db
        .prepare('SELECT * FROM sleeper_leagues WHERE league_id = ?')
        .get('111111111111111111') as Record<string, string | number>;
      assert.equal(league.name, 'Gridiron Guild');
      assert.equal(league.season, '2026');
      assert.equal(league.total_rosters, 2);
      assert.equal(league.status, 'in_season');
      assert.equal(league.synced_at, fixedNow().toISOString());
      assert.deepEqual(JSON.parse(league.roster_positions as string), [
        'QB', 'RB', 'WR', 'TE', 'FLEX', 'BN', 'BN',
      ]);

      const teams = db
        .prepare('SELECT * FROM sleeper_teams WHERE league_id = ? ORDER BY roster_id')
        .all('111111111111111111') as Array<Record<string, string | number | null>>;
      assert.equal(teams.length, 2);
      assert.equal(teams[0]?.display_name, 'Trev');
      assert.equal(teams[0]?.team_name, 'Trev Team');
      assert.equal(teams[0]?.wins, 3);
      assert.equal(teams[0]?.points_for, 400.5);
      assert.equal(teams[0]?.points_against, 350.25);
      assert.equal(teams[1]?.display_name, 'Ana');
      assert.equal(teams[1]?.points_for, 300);

      const rosterRows = db
        .prepare(
          'SELECT sleeper_player_id, players_id, slot_type FROM sleeper_rosters WHERE league_id = ? AND roster_id = 1',
        )
        .all('111111111111111111') as Array<{ sleeper_player_id: string; players_id: string | null; slot_type: string }>;
      const slotsByPlayer = new Map(rosterRows.map((row) => [row.sleeper_player_id, row]));
      assert.equal(slotsByPlayer.get('p1')?.slot_type, 'starter');
      assert.equal(slotsByPlayer.get('p2')?.slot_type, 'starter');
      assert.equal(slotsByPlayer.get('p3')?.slot_type, 'ir');
      assert.equal(slotsByPlayer.get('p4')?.slot_type, 'taxi');

      // Matched players carry canonical ids; unmatched stay NULL with a warning.
      assert.equal(slotsByPlayer.get('p1')?.players_id, 'qb-josh-allen');
      assert.equal(slotsByPlayer.get('p2')?.players_id, 'wr-jamarr-chase');
      assert.equal(slotsByPlayer.get('p3')?.players_id, null);
      assert.equal(slotsByPlayer.get('p4')?.players_id, null);
      assert.ok(
        logger.warnings.some((warning) => warning.includes("'Mystery Back'")),
        'expected an unmatched-player warning for Mystery Back',
      );

      const mapRows = db
        .prepare('SELECT sleeper_player_id, players_id FROM sleeper_player_map')
        .all() as Array<{ sleeper_player_id: string; players_id: string | null }>;
      const mapBySleeperId = new Map(mapRows.map((row) => [row.sleeper_player_id, row.players_id]));
      assert.equal(mapBySleeperId.get('p1'), 'qb-josh-allen');
      assert.equal(mapBySleeperId.get('p3'), undefined);

      const offers = db
        .prepare(
          'SELECT * FROM sleeper_trade_offers WHERE league_id = ? ORDER BY transaction_id',
        )
        .all('111111111111111111') as Array<Record<string, string | number>>;
      assert.deepEqual(
        offers.map((offer) => offer.transaction_id),
        [501, 503, 504],
      );

      const pending = offers.find((offer) => offer.transaction_id === 501) as Record<string, string>;
      assert.equal(pending.status, 'pending');
      assert.equal(pending.proposer_roster_id, 1);
      assert.deepEqual(JSON.parse(pending.responder_roster_ids as string), [2]);
      assert.deepEqual(JSON.parse(pending.adds as string), { p1: 2 });
      assert.equal(
        (pending.draft_picks as string).includes('"season":"2027"'),
        true,
      );
      assert.equal(pending.created_at, '2023-07-22T04:26:40.000Z');

      const complete = offers.find((offer) => offer.transaction_id === 503) as Record<string, string | number>;
      assert.equal(complete.status, 'complete');
      assert.equal(complete.proposer_roster_id, 2);

      const dropped = offers.find((offer) => offer.transaction_id === 504) as Record<string, string>;
      assert.equal(dropped.status, 'failed');

      const connection = db
        .prepare('SELECT last_synced_at FROM sleeper_connections WHERE league_id = ?')
        .get('111111111111111111') as { last_synced_at: string };
      assert.equal(connection.last_synced_at, fixedNow().toISOString());

      const run = db
        .prepare('SELECT * FROM sleeper_sync_runs')
        .get() as Record<string, string | null>;
      assert.equal(run.started_at, fixedNow().toISOString());
      assert.equal(run.completed_at, fixedNow().toISOString());
      assert.deepEqual(JSON.parse(run.league_ids_attempted as string), ['111111111111111111']);
      assert.deepEqual(JSON.parse(run.league_ids_succeeded as string), ['111111111111111111']);
      assert.equal(run.error, null);
    } finally {
      db.close();
    }
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SLS-034
// @spec DFF-SLS-035
test('player registry is fetched once per run and cached to disk for 24 hours', async () => {
  const fixture = createFixture();
  const logger = createLogger();

  {
    const db = openDb(fixture);
    try {
      seedConnection(db, '111111111111111111', 'Gridiron Guild');
    } finally {
      db.close();
    }
  }

  const fetchImpl = createFakeSleeperFetch(createHappyPathRoutes());

  try {
    await runSleeperSync(syncOptions(fixture, fetchImpl, logger));
    const registryFetchesAfterFirst = fetchImpl.calls.filter((call) => call.endsWith('/players/nfl')).length;
    assert.equal(registryFetchesAfterFirst, 1);
    assert.equal(fs.existsSync(fixture.cachePath), true);

    const cached = JSON.parse(fs.readFileSync(fixture.cachePath, 'utf8')) as {
      fetched_at: string;
      players: Record<string, unknown>;
    };
    assert.equal(cached.fetched_at, fixedNow().toISOString());
    assert.deepEqual(cached.players.p1, { fullName: 'Josh Allen', position: 'QB' });

    // A second run within the TTL must not refetch the registry.
    const fetchImpl2 = createFakeSleeperFetch(createHappyPathRoutes());
    await runSleeperSync(syncOptions(fixture, fetchImpl2, logger));
    assert.equal(
      fetchImpl2.calls.filter((call) => call.endsWith('/players/nfl')).length,
      0,
      'registry should be served from the fresh cache',
    );
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SLS-036
test('registry fetch failure aborts the sync for all leagues and records a run row', async () => {
  const fixture = createFixture();
  const logger = createLogger();

  {
    const db = openDb(fixture);
    try {
      seedConnection(db, '111111111111111111', 'Gridiron Guild');
    } finally {
      db.close();
    }
  }

  const fetchImpl = createFakeSleeperFetch({
    '/players/nfl': () => ({ httpStatus: 503, body: { error: 'unavailable' } }),
  });

  try {
    const result = await runSleeperSync(syncOptions(fixture, fetchImpl, logger));

    assert.equal(result.skipped, false);
    assert.deepEqual(result.attempted, ['111111111111111111']);
    assert.deepEqual(result.succeeded, []);
    assert.equal(result.outcomes[0]?.ok, false);

    const db = openDb(fixture);
    try {
      const leagues = db.prepare('SELECT COUNT(*) AS total FROM sleeper_leagues').get() as { total: number };
      assert.equal(leagues.total, 0);

      const run = db.prepare('SELECT * FROM sleeper_sync_runs').get() as Record<string, string | null>;
      assert.equal(run.completed_at, fixedNow().toISOString());
      const errors = JSON.parse(run.error as string) as Record<string, string>;
      assert.equal(errors['111111111111111111'].includes('player registry unavailable'), true);
    } finally {
      db.close();
    }
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SLS-036
test('a stale registry cache is used with a warning when the fetch fails', async () => {
  const fixture = createFixture();
  const logger = createLogger();

  {
    const db = openDb(fixture);
    try {
      seedConnection(db, '111111111111111111', 'Gridiron Guild');
    } finally {
      db.close();
    }
  }

  // Prime a cache that is 25 hours old (trimmed cache format).
  const trimmedRegistry = Object.fromEntries(
    Object.entries(registryPayload()).map(([id, entry]) => [
      id,
      { fullName: (entry as { full_name: string }).full_name, position: (entry as { position: string }).position },
    ]),
  );
  fs.writeFileSync(
    fixture.cachePath,
    JSON.stringify({
      fetched_at: '2026-09-26T11:00:00.000Z',
      players: trimmedRegistry,
    }),
  );

  const fetchImpl = createFakeSleeperFetch({
    ...createHappyPathRoutes(),
    '/players/nfl': () => ({ httpStatus: 503, body: { error: 'unavailable' } }),
  });

  try {
    const result = await runSleeperSync(syncOptions(fixture, fetchImpl, logger));

    assert.deepEqual(result.succeeded, ['111111111111111111']);
    assert.ok(
      logger.warnings.some((warning) => warning.includes('using stale cache')),
      'expected a stale-cache warning',
    );
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SLS-052
test('sleeper_rosters rows are replaced, not accumulated, across syncs', async () => {
  const fixture = createFixture();
  const logger = createLogger();

  {
    const db = openDb(fixture);
    try {
      seedConnection(db, '111111111111111111', 'Gridiron Guild');
    } finally {
      db.close();
    }
  }

  const routes = createHappyPathRoutes();
  const fetchImpl = createFakeSleeperFetch(routes);

  try {
    await runSleeperSync(syncOptions(fixture, fetchImpl, logger));

    const movedRosters = rostersPayload().map((roster, index) =>
      index === 0
        ? { ...roster, players: ['p1'], starters: ['p1'], taxi: [], reserve: [] }
        : roster,
    );
    routes['/league/111111111111111111/rosters'] = () => movedRosters;

    await runSleeperSync(syncOptions(fixture, fetchImpl, logger));

    const db = openDb(fixture);
    try {
      const rows = db
        .prepare('SELECT sleeper_player_id FROM sleeper_rosters WHERE league_id = ?')
        .all('111111111111111111') as Array<{ sleeper_player_id: string }>;
      assert.deepEqual(
        rows.map((row) => row.sleeper_player_id).sort(),
        ['p1'],
      );
    } finally {
      db.close();
    }
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SLS-060
// @spec DFF-SLS-062
test('a failed league is skipped, recorded, and its existing data is left unchanged', async () => {
  const fixture = createFixture();
  const logger = createLogger();

  {
    const db = openDb(fixture);
    try {
      seedConnection(db, '111111111111111111', 'Gridiron Guild');
      seedConnection(db, '222222222222222222', 'Broken League');
      // Pre-existing state for the league that will fail its sync.
      db.prepare(
        `INSERT INTO sleeper_leagues (league_id, name, season, scoring_settings, roster_positions, total_rosters, status, synced_at)
         VALUES ('222222222222222222', 'Broken League', '2026', '{}', '[]', 12, 'in_season', '2026-09-20T00:00:00.000Z')`,
      ).run();
    } finally {
      db.close();
    }
  }

  const fetchImpl = createFakeSleeperFetch({
    ...createHappyPathRoutes(),
    '/league/222222222222222222': () => ({ httpStatus: 500, body: { error: 'boom' } }),
  });

  try {
    const result = await runSleeperSync(syncOptions(fixture, fetchImpl, logger));

    assert.deepEqual(result.succeeded, ['111111111111111111']);
    assert.equal(result.outcomes.find((outcome) => outcome.leagueId === '222222222222222222')?.ok, false);
    assert.ok(
      logger.warnings.some((warning) => warning.includes('222222222222222222')),
      'expected a per-league failure warning',
    );

    const db = openDb(fixture);
    try {
      const broken = db
        .prepare('SELECT * FROM sleeper_leagues WHERE league_id = ?')
        .get('222222222222222222') as Record<string, string | number>;
      assert.equal(broken.synced_at, '2026-09-20T00:00:00.000Z');

      const run = db.prepare('SELECT * FROM sleeper_sync_runs').get() as Record<string, string | null>;
      assert.deepEqual(JSON.parse(run.league_ids_succeeded as string), ['111111111111111111']);
      const errors = JSON.parse(run.error as string) as Record<string, string>;
      assert.equal(errors['222222222222222222'].includes('Sleeper returned 500'), true);
    } finally {
      db.close();
    }
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SLS-061
test('malformed individual payloads are skipped with a warning without failing the league', async () => {
  const fixture = createFixture();
  const logger = createLogger();

  {
    const db = openDb(fixture);
    try {
      seedConnection(db, '111111111111111111', 'Gridiron Guild');
    } finally {
      db.close();
    }
  }

  const fetchImpl = createFakeSleeperFetch({
    ...createHappyPathRoutes(),
    '/league/111111111111111111/transactions/1': () => [
      { type: 'trade', status: 'pending' },
      { transaction_id: 501, type: 'trade', status: 'pending', roster_ids: [1, 2], adds: {}, drops: {}, draft_picks: [] },
    ],
    '/league/111111111111111111/users': () => [
      { display_name: 'No User Id' },
      { user_id: 'u1', display_name: 'Trev', metadata: { team_name: 'Trev Team' } },
    ],
  });

  try {
    const result = await runSleeperSync(syncOptions(fixture, fetchImpl, logger));

    assert.equal(result.outcomes[0]?.ok, true);

    const db = openDb(fixture);
    try {
      const offers = db
        .prepare('SELECT transaction_id FROM sleeper_trade_offers WHERE league_id = ?')
        .all('111111111111111111') as Array<{ transaction_id: number }>;
      // 503 (malformed, week 1) skipped; 501 (week 1) and 504 (week 2) recorded.
      assert.deepEqual(offers.map((offer) => offer.transaction_id), [501, 504]);

      const teams = db
        .prepare('SELECT COUNT(*) AS total FROM sleeper_teams WHERE league_id = ?')
        .get('111111111111111111') as { total: number };
      assert.equal(teams.total, 2);
    } finally {
      db.close();
    }

    assert.ok(logger.warnings.some((warning) => warning.includes('transaction_id')));
    assert.ok(logger.warnings.some((warning) => warning.includes('user_id')));
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SLS-042
test('a player ingested after a failed match is matched on the next sync', async () => {
  const fixture = createFixture();
  const logger = createLogger();

  {
    const db = openDb(fixture);
    try {
      seedPlayer(db, 'qb-josh-allen', 'Josh Allen', 'QB');
      seedConnection(db, '111111111111111111', 'Gridiron Guild');
    } finally {
      db.close();
    }
  }

  const fetchImpl = createFakeSleeperFetch(createHappyPathRoutes());

  try {
    await runSleeperSync(syncOptions(fixture, fetchImpl, logger));

    {
      const db = openDb(fixture);
      try {
        const chase = db
          .prepare("SELECT players_id FROM sleeper_rosters WHERE sleeper_player_id = 'p2'")
          .get() as { players_id: string | null };
        assert.equal(chase.players_id, null);
      } finally {
        db.close();
      }
    }

    {
      const db = openDb(fixture);
      try {
        seedPlayer(db, 'wr-jamarr-chase', "Ja'Marr Chase", 'WR');
      } finally {
        db.close();
      }
    }

    await runSleeperSync(syncOptions(fixture, fetchImpl, logger));

    const db = openDb(fixture);
    try {
      const chase = db
        .prepare("SELECT players_id FROM sleeper_rosters WHERE sleeper_player_id = 'p2'")
        .get() as { players_id: string | null };
      assert.equal(chase.players_id, 'wr-jamarr-chase');
    } finally {
      db.close();
    }
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SLS-090
// @spec DFF-SLS-091
test('the traded-pick inventory is fetched and persisted per league', async () => {
  const fixture = createFixture();
  const logger = createLogger();

  {
    const db = openDb(fixture);
    try {
      seedConnection(db, '111111111111111111', 'Gridiron Guild');
    } finally {
      db.close();
    }
  }

  const routes = createHappyPathRoutes();
  const fetchImpl = createFakeSleeperFetch(routes);

  try {
    await runSleeperSync(syncOptions(fixture, fetchImpl, logger));

    assert.ok(
      fetchImpl.calls.some((call) => call.endsWith('/league/111111111111111111/traded_picks')),
      'expected the traded_picks endpoint to be fetched',
    );

    const db = openDb(fixture);
    try {
      const rows = db
        .prepare(
          'SELECT season, round, roster_id, previous_owner_id, owner_id FROM sleeper_traded_picks WHERE league_id = ? ORDER BY season, round',
        )
        .all('111111111111111111') as Array<{
        season: string;
        round: number;
        roster_id: number;
        previous_owner_id: number;
        owner_id: number;
      }>;

      assert.deepEqual(rows, [
        { season: '2027', round: 1, roster_id: 2, previous_owner_id: 2, owner_id: 1 },
        { season: '2027', round: 2, roster_id: 1, previous_owner_id: 1, owner_id: 2 },
        { season: '2028', round: 1, roster_id: 1, previous_owner_id: 1, owner_id: 1 },
      ]);
    } finally {
      db.close();
    }
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SLS-091
test('traded-pick rows are replaced, not accumulated, across syncs', async () => {
  const fixture = createFixture();
  const logger = createLogger();

  {
    const db = openDb(fixture);
    try {
      seedConnection(db, '111111111111111111', 'Gridiron Guild');
    } finally {
      db.close();
    }
  }

  const routes = createHappyPathRoutes();
  const fetchImpl = createFakeSleeperFetch(routes);

  try {
    await runSleeperSync(syncOptions(fixture, fetchImpl, logger));

    routes['/league/111111111111111111/traded_picks'] = () => [
      { season: '2027', round: 1, roster_id: 2, previous_owner_id: 2, owner_id: 1 },
    ];

    await runSleeperSync(syncOptions(fixture, fetchImpl, logger));

    const db = openDb(fixture);
    try {
      const count = db
        .prepare('SELECT COUNT(*) AS count FROM sleeper_traded_picks WHERE league_id = ?')
        .get('111111111111111111') as { count: number };

      assert.equal(count.count, 1);
    } finally {
      db.close();
    }
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SLS-092
test('malformed traded-pick entries are skipped with a warning', async () => {
  const fixture = createFixture();
  const logger = createLogger();

  {
    const db = openDb(fixture);
    try {
      seedConnection(db, '111111111111111111', 'Gridiron Guild');
    } finally {
      db.close();
    }
  }

  const routes = createHappyPathRoutes();
  routes['/league/111111111111111111/traded_picks'] = () => [
    { season: '2027', round: 1, roster_id: 2, previous_owner_id: 2, owner_id: 1 },
    { season: '2027', round: 2, roster_id: 1 },
    { round: 3, roster_id: 1, previous_owner_id: 1, owner_id: 2 },
  ];
  const fetchImpl = createFakeSleeperFetch(routes);

  try {
    await runSleeperSync(syncOptions(fixture, fetchImpl, logger));

    const db = openDb(fixture);
    try {
      const rows = db
        .prepare('SELECT season, round FROM sleeper_traded_picks WHERE league_id = ?')
        .all('111111111111111111') as Array<{ season: string; round: number }>;

      assert.deepEqual(rows, [{ season: '2027', round: 1 }]);
      assert.ok(
        logger.warnings.some((message) => message.includes('traded-pick entry with missing fields')),
        'expected a warning for the skipped entries',
      );
    } finally {
      db.close();
    }
  } finally {
    fixture.cleanup();
  }
});
