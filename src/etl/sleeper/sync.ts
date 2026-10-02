import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import { createDatabase } from '../../db/client.js';
import { loadAliasFamilies, type AliasFamily } from '../player-matching.js';
import { createSleeperClient } from './client.js';
import { createSleeperPlayerMatcher } from './matching.js';
import { defaultRegistryCachePath, loadPlayerRegistry } from './registry-cache.js';
import type {
  FetchLike,
  PlayerRegistry,
  SleeperLeaguePayload,
  SleeperRosterPayload,
  SleeperTradedPickPayload,
  SleeperTransactionPayload,
  SleeperUserEntryPayload,
  SyncLogger,
} from './types.js';

export type SleeperSyncOptions = {
  databasePath?: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
  aliasesPath?: string;
  registryCachePath?: string;
  logger?: SyncLogger;
};

export type LeagueSyncOutcome = {
  leagueId: string;
  leagueName: string;
  ok: boolean;
  error?: string;
};

export type SleeperSyncResult = {
  skipped: boolean;
  attempted: string[];
  succeeded: string[];
  outcomes: LeagueSyncOutcome[];
};

const consoleLogger: SyncLogger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
};

function requireString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function requireFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function requireInteger(value: unknown): number | null {
  const number = requireFiniteNumber(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

function requireStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? value
    : null;
}

function jsonArray(value: unknown, fallback: string): string {
  if (value === undefined || value === null) {
    return fallback;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function epochMillisToIso(value: unknown, fallback: string): string {
  const millis = requireFiniteNumber(value);
  return millis !== null ? new Date(millis).toISOString() : fallback;
}

type ConnectionRow = {
  id: string;
  league_id: string;
  league_name: string;
};

type TeamRow = {
  id: string;
  rosterId: number;
  ownerId: string | null;
  displayName: string | null;
  teamName: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number | null;
  pointsAgainst: number | null;
};

type RosterPlayerRow = {
  id: string;
  rosterId: number;
  sleeperPlayerId: string;
  playersId: string | null;
  slotType: 'starter' | 'bench' | 'ir' | 'taxi';
};

type TradeOfferRow = {
  transactionId: number;
  status: 'pending' | 'complete' | 'failed';
  proposerRosterId: number;
  responderRosterIds: string;
  adds: string;
  drops: string;
  draftPicks: string;
  createdAt: string;
  updatedAt: string;
};

type TradedPickRow = {
  season: string;
  round: number;
  rosterId: number;
  previousOwnerId: number;
  ownerId: number;
};

// @spec DFF-SLS-092
// Maps a traded-pick entry to a row, or null when the payload is missing a
// required field (skipped with a warning by the caller).
function mapTradedPick(pick: SleeperTradedPickPayload, logger: SyncLogger): TradedPickRow | null {
  const season = requireString(pick.season);
  const round = requireInteger(pick.round);
  const rosterId = requireInteger(pick.roster_id);
  const previousOwnerId = requireInteger(pick.previous_owner_id);
  const ownerId = requireInteger(pick.owner_id);

  if (
    season === null ||
    round === null ||
    rosterId === null ||
    previousOwnerId === null ||
    ownerId === null
  ) {
    logger.warn('[Sleeper] WARN: traded-pick entry with missing fields skipped.');
    return null;
  }

  return { season, round, rosterId, previousOwnerId, ownerId };
}

// @spec DFF-SLS-060
// @spec DFF-SLS-061
// Maps a Sleeper trade transaction to a row, or null when the payload is too
// malformed to record (skipped with a warning by the caller).
function mapTradeOffer(
  transaction: SleeperTransactionPayload,
  syncedAt: string,
  logger: SyncLogger,
): TradeOfferRow | null {
  if (transaction.type !== 'trade') {
    return null;
  }

  const transactionId = requireInteger(transaction.transaction_id);

  if (transactionId === null) {
    logger.warn('[Sleeper] WARN: trade transaction without a valid transaction_id skipped.');
    return null;
  }

  let status: TradeOfferRow['status'] | null = null;

  if (transaction.status === 'pending') {
    status = 'pending';
  } else if (transaction.status === 'complete') {
    status = 'complete';
  } else if (transaction.status === 'failed' || transaction.status === 'dropped') {
    status = 'failed';
  }

  if (status === null) {
    logger.warn(
      `[Sleeper] WARN: trade transaction ${transactionId} has unrecognized status '${String(transaction.status)}'. Skipped.`,
    );
    return null;
  }

  const rosterIds = Array.isArray(transaction.roster_ids)
    ? transaction.roster_ids.map(requireInteger)
    : null;

  if (!rosterIds || rosterIds.length === 0 || rosterIds[0] === null) {
    logger.warn(
      `[Sleeper] WARN: trade transaction ${transactionId} without valid roster_ids skipped.`,
    );
    return null;
  }

  const responders = rosterIds.slice(1).filter((id): id is number => id !== null);

  return {
    transactionId,
    status,
    proposerRosterId: rosterIds[0],
    responderRosterIds: JSON.stringify(responders),
    adds: jsonArray(transaction.adds, '{}'),
    drops: jsonArray(transaction.drops, '{}'),
    draftPicks: jsonArray(transaction.draft_picks, '[]'),
    createdAt: epochMillisToIso(transaction.created ?? transaction.status_updated, syncedAt),
    updatedAt: epochMillisToIso(transaction.status_updated, syncedAt),
  };
}

function classifySlot(
  sleeperPlayerId: string,
  roster: SleeperRosterPayload,
): RosterPlayerRow['slotType'] {
  if (Array.isArray(roster.starters) && roster.starters.includes(sleeperPlayerId)) {
    return 'starter';
  }

  if (Array.isArray(roster.taxi) && roster.taxi.includes(sleeperPlayerId)) {
    return 'taxi';
  }

  if (Array.isArray(roster.reserve) && roster.reserve.includes(sleeperPlayerId)) {
    return 'ir';
  }

  return 'bench';
}

function extractTeamRow(
  roster: SleeperRosterPayload,
  usersByUserId: Map<string, { displayName: string | null; teamName: string | null }>,
  logger: SyncLogger,
): TeamRow | null {
  const rosterId = requireInteger(roster.roster_id);

  if (rosterId === null) {
    logger.warn('[Sleeper] WARN: roster payload without a valid roster_id skipped.');
    return null;
  }

  const ownerId = requireString(roster.owner_id);
  const settings =
    roster.settings && typeof roster.settings === 'object' && !Array.isArray(roster.settings)
      ? (roster.settings as Record<string, unknown>)
      : {};
  const owner = ownerId !== null ? usersByUserId.get(ownerId) : undefined;

  const fpts = requireFiniteNumber(settings.fpts);
  const fptsDecimal = requireFiniteNumber(settings.fpts_decimal) ?? 0;
  const fptsAgainst = requireFiniteNumber(settings.fpts_against);
  const fptsAgainstDecimal = requireFiniteNumber(settings.fpts_against_decimal) ?? 0;

  return {
    id: randomUUID(),
    rosterId,
    ownerId,
    displayName: owner?.displayName ?? null,
    teamName: owner?.teamName ?? null,
    wins: requireInteger(settings.wins) ?? 0,
    losses: requireInteger(settings.losses) ?? 0,
    ties: requireInteger(settings.ties) ?? 0,
    pointsFor: fpts !== null ? fpts + fptsDecimal : null,
    pointsAgainst: fptsAgainst !== null ? fptsAgainst + fptsAgainstDecimal : null,
  };
}

function persistLeagueState(
  sqlite: Database.Database,
  connection: ConnectionRow,
  league: SleeperLeaguePayload,
  teams: TeamRow[],
  rosterPlayers: RosterPlayerRow[],
  tradeOffers: TradeOfferRow[],
  tradedPicks: TradedPickRow[],
  syncedAt: string,
): void {
  const leagueName = requireString(league.name) ?? connection.league_name;

  sqlite.transaction(() => {
    sqlite
      .prepare(
        `INSERT INTO sleeper_leagues (league_id, name, season, scoring_settings, roster_positions, total_rosters, status, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(league_id) DO UPDATE SET
           name = excluded.name,
           season = excluded.season,
           scoring_settings = excluded.scoring_settings,
           roster_positions = excluded.roster_positions,
           total_rosters = excluded.total_rosters,
           status = excluded.status,
           synced_at = excluded.synced_at`,
      )
      .run(
        connection.league_id,
        leagueName,
        requireString(league.season) ?? '',
        jsonArray(league.scoring_settings, '{}'),
        jsonArray(league.roster_positions, '[]'),
        requireInteger(league.total_rosters) ?? 0,
        requireString(league.status) ?? 'unknown',
        syncedAt,
      );

    const insertTeam = sqlite.prepare(
      `INSERT INTO sleeper_teams (id, league_id, roster_id, owner_id, display_name, team_name, wins, losses, ties, points_for, points_against)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(league_id, roster_id) DO UPDATE SET
         owner_id = excluded.owner_id,
         display_name = excluded.display_name,
         team_name = excluded.team_name,
         wins = excluded.wins,
         losses = excluded.losses,
         ties = excluded.ties,
         points_for = excluded.points_for,
         points_against = excluded.points_against`,
    );

    for (const team of teams) {
      insertTeam.run(
        team.id,
        connection.league_id,
        team.rosterId,
        team.ownerId,
        team.displayName,
        team.teamName,
        team.wins,
        team.losses,
        team.ties,
        team.pointsFor,
        team.pointsAgainst,
      );
    }

    // @spec DFF-SLS-052 — rosters are replaced wholesale each sync.
    sqlite.prepare('DELETE FROM sleeper_rosters WHERE league_id = ?').run(connection.league_id);

    const insertRosterPlayer = sqlite.prepare(
      `INSERT INTO sleeper_rosters (id, league_id, roster_id, sleeper_player_id, players_id, slot_type, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const row of rosterPlayers) {
      insertRosterPlayer.run(
        row.id,
        connection.league_id,
        row.rosterId,
        row.sleeperPlayerId,
        row.playersId,
        row.slotType,
        syncedAt,
      );
    }

    const insertTradeOffer = sqlite.prepare(
      `INSERT INTO sleeper_trade_offers (id, league_id, transaction_id, status, proposer_roster_id, responder_roster_ids, adds, drops, draft_picks, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(league_id, transaction_id) DO UPDATE SET
         status = excluded.status,
         proposer_roster_id = excluded.proposer_roster_id,
         responder_roster_ids = excluded.responder_roster_ids,
         adds = excluded.adds,
         drops = excluded.drops,
         draft_picks = excluded.draft_picks,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`,
    );

    for (const offer of tradeOffers) {
      insertTradeOffer.run(
        randomUUID(),
        connection.league_id,
        offer.transactionId,
        offer.status,
        offer.proposerRosterId,
        offer.responderRosterIds,
        offer.adds,
        offer.drops,
        offer.draftPicks,
        offer.createdAt,
        offer.updatedAt,
      );
    }

    // @spec DFF-SLS-091 — traded-pick inventory is replaced wholesale each sync.
    sqlite.prepare('DELETE FROM sleeper_traded_picks WHERE league_id = ?').run(connection.league_id);

    const insertTradedPick = sqlite.prepare(
      `INSERT INTO sleeper_traded_picks (id, league_id, season, round, roster_id, previous_owner_id, owner_id, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const pick of tradedPicks) {
      insertTradedPick.run(
        randomUUID(),
        connection.league_id,
        pick.season,
        pick.round,
        pick.rosterId,
        pick.previousOwnerId,
        pick.ownerId,
        syncedAt,
      );
    }

    sqlite
      .prepare('UPDATE sleeper_connections SET last_synced_at = ? WHERE id = ?')
      .run(syncedAt, connection.id);
  })();
}

// @spec DFF-SLS-030
// @spec DFF-SLS-031
// @spec DFF-SLS-032
// @spec DFF-SLS-033
// @spec DFF-SLS-037
// @spec DFF-SLS-040
// @spec DFF-SLS-043
// @spec DFF-SLS-050
// @spec DFF-SLS-051
// @spec DFF-SLS-052
// @spec DFF-SLS-053
// @spec DFF-SLS-061
// @spec DFF-SLS-090
// @spec DFF-SLS-091
// @spec DFF-SLS-092
async function syncLeague(
  sqlite: Database.Database,
  connection: ConnectionRow,
  client: ReturnType<typeof createSleeperClient>,
  registry: PlayerRegistry,
  aliasFamilies: AliasFamily[],
  currentWeek: number,
  syncedAt: string,
  logger: SyncLogger,
): Promise<void> {
  const league = await client.fetchLeague(connection.league_id);
  const rostersPayload = await client.fetchLeagueRosters(connection.league_id);
  const usersPayload = await client.fetchLeagueUsers(connection.league_id);
  const tradedPicksPayload = await client.fetchLeagueTradedPicks(connection.league_id);

  const tradeOffers: TradeOfferRow[] = [];
  const tradedPicks: TradedPickRow[] = [];

  for (let week = 0; week <= currentWeek; week += 1) {
    const transactions = await client.fetchLeagueTransactions(connection.league_id, week);

    if (!Array.isArray(transactions)) {
      throw new Error(`transactions payload for week ${week} is not an array.`);
    }

    for (const transaction of transactions) {
      const mapped = mapTradeOffer(transaction, syncedAt, logger);

      if (mapped) {
        tradeOffers.push(mapped);
      }
    }
  }

  if (!Array.isArray(rostersPayload)) {
    throw new Error('rosters payload is not an array.');
  }

  if (!Array.isArray(tradedPicksPayload)) {
    throw new Error('traded_picks payload is not an array.');
  }

  for (const pick of tradedPicksPayload) {
    const mapped = mapTradedPick(pick, logger);

    if (mapped) {
      tradedPicks.push(mapped);
    }
  }

  if (!Array.isArray(usersPayload)) {
    throw new Error('users payload is not an array.');
  }

  const usersByUserId = new Map<
    string,
    { displayName: string | null; teamName: string | null }
  >();

  for (const user of usersPayload as SleeperUserEntryPayload[]) {
    const userId = requireString(user.user_id);

    if (!userId) {
      logger.warn('[Sleeper] WARN: league user entry without a valid user_id skipped.');
      continue;
    }

    const metadata =
      user.metadata && typeof user.metadata === 'object' && !Array.isArray(user.metadata)
        ? (user.metadata as Record<string, unknown>)
        : {};

    usersByUserId.set(userId, {
      displayName: requireString(user.display_name),
      teamName: requireString(metadata.team_name),
    });
  }

  const matchSleeperPlayer = createSleeperPlayerMatcher(sqlite, aliasFamilies, logger);
  const teams: TeamRow[] = [];
  const rosterPlayers: RosterPlayerRow[] = [];

  for (const roster of rostersPayload) {
    const team = extractTeamRow(roster, usersByUserId, logger);

    if (!team) {
      continue;
    }

    teams.push(team);

    const playerIds = requireStringArray(roster.players);

    if (!playerIds) {
      logger.warn(
        `[Sleeper] WARN: roster ${team.rosterId} has an invalid players array. Skipping its players.`,
      );
      continue;
    }

    for (const sleeperPlayerId of playerIds) {
      rosterPlayers.push({
        id: randomUUID(),
        rosterId: team.rosterId,
        sleeperPlayerId,
        playersId: matchSleeperPlayer(sleeperPlayerId, registry, syncedAt),
        slotType: classifySlot(sleeperPlayerId, roster),
      });
    }
  }

  persistLeagueState(sqlite, connection, league, teams, rosterPlayers, tradeOffers, tradedPicks, syncedAt);
}

function recordSyncRun(
  sqlite: Database.Database,
  runId: string,
  startedAt: string,
  completedAt: string,
  attempted: string[],
  succeeded: string[],
  leagueErrors: Record<string, string>,
): void {
  sqlite
    .prepare(
      `INSERT INTO sleeper_sync_runs (id, started_at, completed_at, league_ids_attempted, league_ids_succeeded, error)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      runId,
      startedAt,
      completedAt,
      JSON.stringify(attempted),
      JSON.stringify(succeeded),
      Object.keys(leagueErrors).length > 0 ? JSON.stringify(leagueErrors) : null,
    );
}

// @spec DFF-SLS-002
// @spec DFF-SLS-003
// @spec DFF-SLS-004
// @spec DFF-SLS-034
// @spec DFF-SLS-035
// @spec DFF-SLS-036
// @spec DFF-SLS-054
// @spec DFF-SLS-060
// @spec DFF-SLS-062
// Syncs every connected Sleeper league into the sleeper_* tables. Per-league
// failures are recorded and never fail the run; sync-wide aborts (registry or
// NFL-state fetch failure) record a run row and return with all leagues failed.
export async function runSleeperSync(options: SleeperSyncOptions = {}): Promise<SleeperSyncResult> {
  const logger = options.logger ?? consoleLogger;
  const now = options.now ?? (() => new Date());
  const sqlite = createDatabase(options.databasePath);

  try {
    const connections = sqlite
      .prepare('SELECT id, league_id, league_name FROM sleeper_connections')
      .all() as ConnectionRow[];

    if (connections.length === 0) {
      // @spec DFF-SLS-003
      logger.info('[Sleeper] No connected leagues configured. Skipping Sleeper sync.');
      return { skipped: true, attempted: [], succeeded: [], outcomes: [] };
    }

    const runId = randomUUID();
    const startedAt = now().toISOString();
    const attempted = connections.map((connection) => connection.league_id);

    let registry: PlayerRegistry;

    try {
      registry = await loadPlayerRegistry({
        cachePath: options.registryCachePath,
        fetchImpl: options.fetchImpl,
        now,
        logger,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(message);

      const leagueErrors = Object.fromEntries(attempted.map((leagueId) => [leagueId, message]));
      recordSyncRun(sqlite, runId, startedAt, now().toISOString(), attempted, [], leagueErrors);

      return {
        skipped: false,
        attempted,
        succeeded: [],
        outcomes: connections.map((connection) => ({
          leagueId: connection.league_id,
          leagueName: connection.league_name,
          ok: false,
          error: message,
        })),
      };
    }

    const client = createSleeperClient({ fetchImpl: options.fetchImpl });

    let currentWeek: number;

    try {
      const state = await client.fetchNflState();
      currentWeek = requireInteger(state.week) ?? 0;
    } catch (error) {
      const message = `Sleeper NFL state fetch failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      logger.error(`[Sleeper] ERROR: ${message}`);

      const leagueErrors = Object.fromEntries(attempted.map((leagueId) => [leagueId, message]));
      recordSyncRun(sqlite, runId, startedAt, now().toISOString(), attempted, [], leagueErrors);

      return {
        skipped: false,
        attempted,
        succeeded: [],
        outcomes: connections.map((connection) => ({
          leagueId: connection.league_id,
          leagueName: connection.league_name,
          ok: false,
          error: message,
        })),
      };
    }

    const aliasFamilies = loadAliasFamilies(
      options.aliasesPath ?? path.resolve(process.cwd(), 'player-aliases.json'),
    );

    const succeeded: string[] = [];
    const outcomes: LeagueSyncOutcome[] = [];
    const leagueErrors: Record<string, string> = {};

    for (const connection of connections) {
      try {
        await syncLeague(
          sqlite,
          connection,
          client,
          registry,
          aliasFamilies,
          currentWeek,
          now().toISOString(),
          logger,
        );
        succeeded.push(connection.league_id);
        outcomes.push({
          leagueId: connection.league_id,
          leagueName: connection.league_name,
          ok: true,
        });
      } catch (error) {
        // @spec DFF-SLS-060 — skip the failed league, keep going.
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
          `[Sleeper] WARN: league ${connection.league_id} (${connection.league_name}) sync failed — ${message}. Skipping.`,
        );
        leagueErrors[connection.league_id] = message;
        outcomes.push({
          leagueId: connection.league_id,
          leagueName: connection.league_name,
          ok: false,
          error: message,
        });
      }
    }

    // @spec DFF-SLS-054
    recordSyncRun(sqlite, runId, startedAt, now().toISOString(), attempted, succeeded, leagueErrors);

    return { skipped: false, attempted, succeeded, outcomes };
  } finally {
    sqlite.close();
  }
}
