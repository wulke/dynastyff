// @spec DFF-SM-004
// @spec DFF-SM-010
// @spec DFF-SM-018
// @spec DFF-SM-081
// @spec DFF-SM-083
import type { RequestHandler } from 'express';

import { assembleLeagueContext, LeagueContextError } from '../season/context.js';
import { evaluateRoster } from '../season/rosterEvaluator.js';

export type SeasonRouteOptions = {
  databasePath?: string;
  now?: () => Date;
};

const staleThresholdMs = 60 * 60 * 1000;

// @spec DFF-SM-010
// @spec DFF-SM-018 — pure algorithm output; no Claude invocation.
export function createSeasonOverviewRoute({ databasePath, now = () => new Date() }: SeasonRouteOptions = {}): RequestHandler {
  return (request, response) => {
    const leagueId = Array.isArray(request.params.league_id)
      ? request.params.league_id[0]
      : request.params.league_id;

    if (!leagueId) {
      response.status(400).json({ error: 'A league ID is required.' });
      return;
    }

    try {
      const context = assembleLeagueContext(databasePath, leagueId);
      const overview = evaluateRoster(context);

      // @spec DFF-SM-081 — flag stale data when the last sync is older than 1 hour.
      const lastSyncedMs = Date.parse(context.lastSyncedAt ?? '');
      const staleSince =
        Number.isNaN(lastSyncedMs) || now().getTime() - lastSyncedMs <= staleThresholdMs
          ? null
          : context.lastSyncedAt;

      response.status(200).json({ ...overview, staleSince, lastSyncedAt: context.lastSyncedAt });
    } catch (error) {
      if (error instanceof LeagueContextError) {
        response.status(error.statusCode).json({ error: error.message, code: error.code });
        return;
      }

      throw error;
    }
  };
}
