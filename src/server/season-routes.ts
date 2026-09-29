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

import { assembleLeagueContext, LeagueContextError, type SleeperTradeOfferRecord } from '../season/context.js';
import { evaluateRoster } from '../season/rosterEvaluator.js';
import { recommendTrades } from '../season/tradeRecommender.js';
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

function numericRecord(raw: unknown): Record<string, number> | null {
  if (raw === undefined || raw === null) {
    return {};
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const record: Record<string, number> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'number') {
      return null;
    }

    record[key] = value;
  }

  return record;
}

// @spec DFF-SM-031 — the `trade_offer` body carries the same JSON shape a recommendation's
// `offer` field returns (camelCase `transactionId`; when both `trade_offer` and `transaction_id`
// are present, `trade_offer` takes precedence). It must involve the user's roster; anything else
// is rejected so malformed payloads fail as 400s, never 500s.
function parseTradeOffer(raw: unknown, userRosterId: number): SleeperTradeOfferRecord | null {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }

  const body = raw as Record<string, unknown>;
  const proposerRosterId = typeof body.proposerRosterId === 'number' ? body.proposerRosterId : null;

  if (proposerRosterId === null) {
    return null;
  }

  if (
    body.responderRosterIds !== undefined &&
    !(Array.isArray(body.responderRosterIds) && body.responderRosterIds.every((id) => typeof id === 'number'))
  ) {
    return null;
  }

  const responderRosterIds =
    body.responderRosterIds !== undefined ? (body.responderRosterIds as number[]) : [];
  const adds = numericRecord(body.adds);
  const drops = numericRecord(body.drops);

  if (adds === null || drops === null) {
    return null;
  }

  const draftPicks: unknown[] = [];

  if (body.draftPicks !== undefined) {
    if (!Array.isArray(body.draftPicks)) {
      return null;
    }

    for (const element of body.draftPicks) {
      const pick = parseTradeOfferPick(element);

      if (pick === null) {
        return null;
      }

      draftPicks.push(pick);
    }
  }

  const involvesUser =
    proposerRosterId === userRosterId ||
    responderRosterIds.includes(userRosterId) ||
    Object.values(adds).includes(userRosterId) ||
    Object.values(drops).includes(userRosterId);

  if (!involvesUser) {
    return null;
  }

  const rawTransactionId = body.transactionId;
  const transactionId =
    typeof rawTransactionId === 'number' && Number.isFinite(rawTransactionId)
      ? rawTransactionId
      : typeof rawTransactionId === 'string' && /^-?\d+$/.test(rawTransactionId.trim())
        ? Number(rawTransactionId.trim())
        : -1;

  return {
    transactionId,
    status: typeof body.status === 'string' ? body.status : 'hypothetical',
    proposerRosterId,
    responderRosterIds,
    adds,
    drops,
    draftPicks,
    createdAt: typeof body.createdAt === 'string' ? body.createdAt : '',
  };
}

// Pick legs must carry a season and a positive integer round; roster IDs may be absent but
// must be numbers when present. Unknown extra fields are dropped rather than passed through.
function parseTradeOfferPick(raw: unknown): unknown | null {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }

  const pick = raw as Record<string, unknown>;

  const seasonOk = typeof pick.season === 'string' || typeof pick.season === 'number';
  const roundOk = typeof pick.round === 'number' && Number.isInteger(pick.round) && pick.round >= 1;
  const idsOk = ['roster_id', 'previous_owner_id', 'owner_id'].every(
    (key) => pick[key] === undefined || typeof pick[key] === 'number',
  );

  if (!seasonOk || !roundOk || !idsOk) {
    return null;
  }

  const normalized: Record<string, unknown> = { season: String(pick.season), round: pick.round };

  for (const key of ['roster_id', 'previous_owner_id', 'owner_id']) {
    if (pick[key] !== undefined) {
      normalized[key] = pick[key];
    }
  }

  return normalized;
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

// @spec DFF-SM-050
// @spec DFF-SM-056 — pure five-signal computation; Claude is never invoked here.
// @spec DFF-SM-085 — recomputed on every request; `lastComputedAt` is the actual computation time.
export function createSeasonTradeRecommendationsRoute({
  databasePath,
  now = () => new Date(),
}: SeasonRouteOptions = {}): RequestHandler {
  return (request, response) => {
    const leagueId = leagueIdFrom(request);

    if (!leagueId) {
      response.status(400).json({ error: 'A league ID is required.' });
      return;
    }

    try {
      const context = assembleLeagueContext(databasePath, leagueId);
      const { groups } = recommendTrades(context, now);

      response.status(200).json({ groups, lastComputedAt: now().toISOString() });
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

    const body = (request.body ?? {}) as { transaction_id?: unknown; trade_offer?: unknown };
    const transactionId =
      typeof body.transaction_id === 'number' || typeof body.transaction_id === 'string'
        ? String(body.transaction_id)
        : null;

    try {
      const context = assembleLeagueContext(databasePath, leagueId);
      let offer: SleeperTradeOfferRecord | null = null;

      if (body.trade_offer !== undefined) {
        offer = parseTradeOffer(body.trade_offer, context.userRosterId);

        if (offer === null) {
          response.status(400).json({ error: 'trade_offer must describe a trade involving your roster.' });
          return;
        }
      } else if (transactionId !== null) {
        offer =
          context.pendingOffers.find(
            (entry) =>
              String(entry.transactionId) === transactionId && involvesUser(entry, context.userRosterId),
          ) ?? null;

        if (offer === null) {
          response.status(404).json({ error: `No pending offer ${transactionId} involving your roster.` });
          return;
        }
      } else {
        response.status(400).json({ error: 'A transaction_id or trade_offer is required.' });
        return;
      }

      const score = scoreTrade(context, offer);
      const analysis = await advisor.explainTrade(context, score, offer);

      response.status(200).json({
        transactionId: String(offer.transactionId),
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
