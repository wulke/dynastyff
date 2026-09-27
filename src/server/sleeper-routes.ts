import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';

import { createDatabase } from '../db/client.js';
import { createSleeperClient, SleeperApiError } from '../etl/sleeper/client.js';
import { deriveSeasonYear } from '../etl/sleeper/season.js';
import { runSleeperSync, type SleeperSyncResult } from '../etl/sleeper/sync.js';
import type { FetchLike, SleeperLeaguePayload } from '../etl/sleeper/types.js';

export type SleeperRouteOptions = {
  databasePath?: string;
  fetchImpl?: FetchLike;
  idGenerator?: () => string;
  now?: () => Date;
  runSleeperSyncImpl?: (options: { databasePath?: string; fetchImpl?: FetchLike; now?: () => Date }) => Promise<SleeperSyncResult>;
};

type ConnectionApiRecord = {
  id: string;
  leagueId: string;
  leagueName: string;
  season: string;
  userId: string;
  rosterId: number;
  connectedAt: string;
  lastSyncedAt: string | null;
};

type ConnectionRow = {
  id: string;
  league_id: string;
  league_name: string;
  season: string;
  user_id: string;
  roster_id: number;
  connected_at: string;
  last_synced_at: string | null;
};

function toConnectionApiRecord(row: ConnectionRow): ConnectionApiRecord {
  return {
    id: row.id,
    leagueId: row.league_id,
    leagueName: row.league_name,
    season: row.season,
    userId: row.user_id,
    rosterId: row.roster_id,
    connectedAt: row.connected_at,
    lastSyncedAt: row.last_synced_at,
  };
}

function requireString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function requireFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isDynastyLeague(league: SleeperLeaguePayload): boolean {
  const settings =
    league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
      ? (league.settings as Record<string, unknown>)
      : {};

  const type = requireString(settings.type);

  return type === null || type === 'dynasty';
}

// @spec DFF-SLS-010
// @spec DFF-SLS-071
export function createSleeperUserRoute({
  fetchImpl,
  now = () => new Date(),
}: SleeperRouteOptions = {}): RequestHandler {
  const client = createSleeperClient({ fetchImpl });

  return async (request, response) => {
    const requestedUsername = request.params.username;
    const username = Array.isArray(requestedUsername) ? undefined : requestedUsername;

    if (!username || username.trim().length === 0) {
      response.status(400).json({ error: 'Enter a valid Sleeper username.' });
      return;
    }

    try {
      const user = await client.fetchUserByUsername(username.trim());
      const userId = requireString(user?.user_id);

      if (!userId) {
        response.status(404).json({ error: `Sleeper username '${username.trim()}' not found.` });
        return;
      }

      const leagues = await client.fetchUserLeagues(userId, deriveSeasonYear(now()));
      const dynastyLeagues = (Array.isArray(leagues) ? leagues : [])
        .filter(isDynastyLeague)
        .map((league) => ({
          leagueId: requireString(league.league_id) ?? '',
          name: requireString(league.name) ?? 'Unnamed league',
          season: requireString(league.season) ?? '',
          totalRosters: requireFiniteNumber(league.total_rosters) ?? 0,
          status: requireString(league.status) ?? 'unknown',
        }))
        .filter((league) => league.leagueId.length > 0);

      response.status(200).json({
        userId,
        username: requireString(user?.username) ?? username.trim(),
        displayName: requireString(user?.display_name),
        leagues: dynastyLeagues,
      });
    } catch {
      response.status(502).json({ error: 'Could not reach Sleeper. Try again shortly.' });
    }
  };
}

// @spec DFF-SLS-011
export function createSleeperLeaguePreviewRoute({
  fetchImpl,
}: SleeperRouteOptions = {}): RequestHandler {
  const client = createSleeperClient({ fetchImpl });

  return async (request, response) => {
    const requestedLeagueId = request.params.league_id;
    const leagueId = Array.isArray(requestedLeagueId) ? undefined : requestedLeagueId;

    if (!leagueId || !/^\d+$/.test(leagueId)) {
      response.status(400).json({ error: 'Enter a valid Sleeper league ID.' });
      return;
    }

    try {
      const league = await client.fetchLeague(leagueId);
      const name = league !== null ? requireString(league.name) : null;

      if (!league || name === null) {
        response.status(404).json({ error: 'Sleeper league not found.' });
        return;
      }

      response.status(200).json({
        leagueId: requireString(league.league_id) ?? leagueId,
        name,
        season: requireString(league.season) ?? '',
        totalRosters: requireFiniteNumber(league.total_rosters) ?? 0,
        status: requireString(league.status) ?? 'unknown',
      });
    } catch {
      response.status(502).json({ error: 'Could not reach Sleeper. Try again shortly.' });
    }
  };
}

// @spec DFF-SLS-012
export function createSleeperConnectionsCreateRoute({
  databasePath,
  fetchImpl,
  idGenerator = randomUUID,
  now = () => new Date(),
}: SleeperRouteOptions = {}): RequestHandler {
  const client = createSleeperClient({ fetchImpl });

  return async (request, response) => {
    const body =
      request.body && typeof request.body === 'object' && !Array.isArray(request.body)
        ? (request.body as Record<string, unknown>)
        : {};
    const username = requireString(body.username);
    const leagueId = requireString(body.league_id);

    if (!username || !leagueId || !/^\d+$/.test(leagueId)) {
      response
        .status(400)
        .json({ error: 'Provide a Sleeper username and a numeric league ID to connect.' });
      return;
    }

    const sqlite = createDatabase(databasePath);

    try {
      const user = await client.fetchUserByUsername(username);
      const userId = requireString(user?.user_id);

      if (!userId) {
        response.status(404).json({ error: `Sleeper username '${username}' not found.` });
        return;
      }

      const league = await client.fetchLeague(leagueId);
      const leagueName = league !== null ? requireString(league.name) : null;

      if (!league || leagueName === null) {
        response.status(404).json({ error: 'Sleeper league not found.' });
        return;
      }

      const rosters = await client.fetchLeagueRosters(leagueId);
      const userRosterId = (Array.isArray(rosters) ? rosters : []).find(
        (roster) => requireString(roster.owner_id) === userId,
      );
      const rosterId = userRosterId ? requireFiniteNumber(userRosterId.roster_id) : null;

      if (rosterId === null || !Number.isInteger(rosterId)) {
        response.status(400).json({
          error: `Sleeper user '${username}' does not have a roster in league ${leagueId}.`,
        });
        return;
      }

      const existing = sqlite
        .prepare('SELECT id FROM sleeper_connections WHERE league_id = ?')
        .get(leagueId) as { id: string } | undefined;

      if (existing) {
        response.status(409).json({ error: 'This league is already connected.' });
        return;
      }

      const record: ConnectionApiRecord = {
        id: idGenerator(),
        leagueId,
        leagueName,
        season: requireString(league.season) ?? String(deriveSeasonYear(now())),
        userId,
        rosterId,
        connectedAt: now().toISOString(),
        lastSyncedAt: null,
      };

      sqlite
        .prepare(
          `INSERT INTO sleeper_connections (id, league_id, league_name, season, user_id, roster_id, connected_at, last_synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          record.id,
          record.leagueId,
          record.leagueName,
          record.season,
          record.userId,
          record.rosterId,
          record.connectedAt,
        );

      response.status(201).json(record);
    } catch (error) {
      if (error instanceof SleeperApiError) {
        response.status(502).json({ error: 'Could not reach Sleeper. Try again shortly.' });
        return;
      }

      throw error;
    } finally {
      sqlite.close();
    }
  };
}

// @spec DFF-SLS-013
export function createSleeperConnectionsDeleteRoute({
  databasePath,
}: SleeperRouteOptions = {}): RequestHandler {
  return (request, response, next) => {
    const requestedId = request.params.id;
    const id = Array.isArray(requestedId) ? undefined : requestedId;
    const sqlite = createDatabase(databasePath);

    try {
      if (!id) {
        response.status(400).json({ error: 'Invalid connection id.' });
        return;
      }

      const result = sqlite
        .prepare('DELETE FROM sleeper_connections WHERE id = ?')
        .run(id);

      if (result.changes === 0) {
        response.status(404).json({ error: 'Connection not found.' });
        return;
      }

      response.status(204).end();
    } catch (error) {
      next(error);
    } finally {
      sqlite.close();
    }
  };
}

// @spec DFF-SLS-014
export function createSleeperConnectionsListRoute({
  databasePath,
}: SleeperRouteOptions = {}): RequestHandler {
  return (_request, response, next) => {
    const sqlite = createDatabase(databasePath);

    try {
      const rows = sqlite
        .prepare('SELECT * FROM sleeper_connections ORDER BY connected_at')
        .all() as ConnectionRow[];

      response.status(200).json(rows.map(toConnectionApiRecord));
    } catch (error) {
      next(error);
    } finally {
      sqlite.close();
    }
  };
}

// @spec DFF-SLS-020
export function createSleeperSyncRoute({
  databasePath,
  fetchImpl,
  now,
  runSleeperSyncImpl = runSleeperSync,
}: SleeperRouteOptions = {}): RequestHandler {
  return async (_request, response, next) => {
    try {
      const result = await runSleeperSyncImpl({ databasePath, fetchImpl, now });
      response.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

// @spec DFF-SLS-021
export function createSleeperSyncStatusRoute({
  databasePath,
}: SleeperRouteOptions = {}): RequestHandler {
  return (_request, response, next) => {
    const sqlite = createDatabase(databasePath);

    try {
      const connections = sqlite
        .prepare('SELECT * FROM sleeper_connections ORDER BY connected_at')
        .all() as ConnectionRow[];
      const runs = sqlite
        .prepare('SELECT * FROM sleeper_sync_runs ORDER BY started_at')
        .all() as Array<{
        started_at: string;
        completed_at: string | null;
        league_ids_attempted: string;
        error: string | null;
      }>;

      const status = connections.map((connection) => {
        const lastRun = [...runs]
          .reverse()
          .find((run) => {
            try {
              return (JSON.parse(run.league_ids_attempted) as string[]).includes(
                connection.league_id,
              );
            } catch {
              return false;
            }
          });

        let lastRunError: string | null = null;

        if (lastRun?.error) {
          try {
            const errors = JSON.parse(lastRun.error) as Record<string, string>;
            lastRunError = errors[connection.league_id] ?? null;
          } catch {
            lastRunError = lastRun.error;
          }
        }

        return {
          leagueId: connection.league_id,
          leagueName: connection.league_name,
          lastSyncedAt: connection.last_synced_at,
          lastRun:
            lastRun !== undefined
              ? {
                  startedAt: lastRun.started_at,
                  completedAt: lastRun.completed_at,
                  error: lastRunError,
                }
              : null,
        };
      });

      response.status(200).json(status);
    } catch (error) {
      next(error);
    } finally {
      sqlite.close();
    }
  };
}

// @spec DFF-SLS-022
// Pure gate for the startup background sync: run when at least one league is
// connected and the most recent sync run is older than 15 minutes (or none).
export function shouldSyncOnStartup({
  connectionCount,
  lastRunCompletedAt,
  now = () => new Date(),
  thresholdMs = 15 * 60 * 1000,
}: {
  connectionCount: number;
  lastRunCompletedAt: string | null;
  now?: () => Date;
  thresholdMs?: number;
}): boolean {
  if (connectionCount === 0) {
    return false;
  }

  if (lastRunCompletedAt === null) {
    return true;
  }

  const completedAt = Date.parse(lastRunCompletedAt);

  return Number.isNaN(completedAt) || now().getTime() - completedAt >= thresholdMs;
}

// @spec DFF-SLS-022
// Fires the background Sleeper sync on server startup without blocking the
// listen callback or incoming requests. Never throws.
export async function maybeRunStartupSleeperSync({
  databasePath,
  fetchImpl,
  now,
  runSleeperSyncImpl = runSleeperSync,
}: SleeperRouteOptions = {}): Promise<boolean> {
  let connectionCount = 0;
  let lastRunCompletedAt: string | null = null;

  try {
    const sqlite = createDatabase(databasePath);

    try {
      connectionCount = (
        sqlite.prepare('SELECT COUNT(*) AS total FROM sleeper_connections').get() as {
          total: number;
        }
      ).total;
      lastRunCompletedAt = (
        sqlite
          .prepare('SELECT completed_at FROM sleeper_sync_runs ORDER BY started_at DESC LIMIT 1')
          .get() as { completed_at: string | null } | undefined
      )?.completed_at ?? null;
    } finally {
      sqlite.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[server] WARN: Sleeper startup check failed — ${message}.`);
    return false;
  }

  if (!shouldSyncOnStartup({ connectionCount, lastRunCompletedAt, now })) {
    return false;
  }

  try {
    const result = await runSleeperSyncImpl({ databasePath, fetchImpl, now });
    console.log(
      `[server] Sleeper startup sync complete — ${result.succeeded.length} succeeded, ` +
        `${result.attempted.length - result.succeeded.length} failed.`,
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[server] WARN: Sleeper startup sync failed — ${message}.`);
    return false;
  }
}
