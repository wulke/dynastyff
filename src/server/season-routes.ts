// @spec DFF-SM-004
// @spec DFF-SM-010
// @spec DFF-SM-018
// @spec DFF-SM-030
// @spec DFF-SM-031
// @spec DFF-SM-032
// @spec DFF-SM-038
// @spec DFF-SM-043
// @spec DFF-SM-081
// @spec DFF-SM-083
import type { RequestHandler, Response } from 'express';

import { assembleLeagueContext, LeagueContextError } from '../season/context.js';
import { evaluateRoster } from '../season/rosterEvaluator.js';
import { createSeasonAdvisor, type SeasonAdvisor } from '../season/seasonAdvisor.js';
import { scoreTrade } from '../season/tradeScorer.js';

export type SeasonRouteOptions = {
  databasePath?: string;
  now?: () => Date;
};

export type SeasonAdvisorRouteOptions = SeasonRouteOptions & {
  advisor?: SeasonAdvisor;
};

const staleThresholdMs = 60 * 60 * 1000;

function leagueIdFrom(request: { params: { league_id?: string | string[] } }): string | null {
  const leagueId = Array.isArray(request.params.league_id)
    ? request.params.league_id[0]
    : request.params.league_id;

  return leagueId ?? null;
}

function handleContextError(error: unknown, response: Response): boolean {
  if (error instanceof LeagueContextError) {
    response.status(error.statusCode).json({ error: error.message, code: error.code });
    return true;
  }

  return false;
}

function involvesUser(
  offer: { proposerRosterId: number; responderRosterIds: number[] },
  userRosterId: number,
): boolean {
  return offer.proposerRosterId === userRosterId || offer.responderRosterIds.includes(userRosterId);
}

// @spec DFF-SM-010
// @spec DFF-SM-018 — pure algorithm output; no Claude invocation.
export function createSeasonOverviewRoute({ databasePath, now = () => new Date() }: SeasonRouteOptions = {}): RequestHandler {
  return (request, response) => {
    const leagueId = leagueIdFrom(request);

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
      if (!handleContextError(error, response)) {
        throw error;
      }
    }
  };
}

// @spec DFF-SM-030 — only offers involving the user's roster (proposer or responder).
export function createSeasonTradesPendingRoute({ databasePath }: SeasonRouteOptions = {}): RequestHandler {
  return (request, response) => {
    const leagueId = leagueIdFrom(request);

    if (!leagueId) {
      response.status(400).json({ error: 'A league ID is required.' });
      return;
    }

    try {
      const context = assembleLeagueContext(databasePath, leagueId);
      const relevant = context.pendingOffers.filter((offer) =>
        involvesUser(offer, context.userRosterId),
      );

      response.status(200).json({ trades: relevant.map((offer) => scoreTrade(context, offer)) });
    } catch (error) {
      if (!handleContextError(error, response)) {
        throw error;
      }
    }
  };
}

// @spec DFF-SM-031
// @spec DFF-SM-043 — Claude failure returns the raw score with `claudeUnavailable`.
export function createSeasonTradeAnalyzeRoute({
  databasePath,
  advisor = createSeasonAdvisor(),
}: SeasonAdvisorRouteOptions = {}): RequestHandler {
  return async (request, response) => {
    const leagueId = leagueIdFrom(request);

    if (!leagueId) {
      response.status(400).json({ error: 'A league ID is required.' });
      return;
    }

    const body = (request.body ?? {}) as { transaction_id?: unknown };
    const transactionId =
      typeof body.transaction_id === 'number' || typeof body.transaction_id === 'string'
        ? String(body.transaction_id)
        : null;

    if (!transactionId) {
      response.status(400).json({ error: 'A transaction_id is required.' });
      return;
    }

    try {
      const context = assembleLeagueContext(databasePath, leagueId);
      const offer = context.pendingOffers.find(
        (entry) => String(entry.transactionId) === transactionId && involvesUser(entry, context.userRosterId),
      );

      if (!offer) {
        response.status(404).json({ error: `No pending offer ${transactionId} involving your roster.` });
        return;
      }

      const score = scoreTrade(context, offer);
      const analysis = await advisor.explainTrade(context, score);

      response.status(200).json({
        transactionId,
        score,
        narrative: analysis.narrative,
        claudeUnavailable: analysis.claudeUnavailable,
      });
    } catch (error) {
      if (!handleContextError(error, response)) {
        throw error;
      }
    }
  };
}
