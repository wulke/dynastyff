// @spec DFF-ENGINE-001
// @spec DFF-ENGINE-003
// @spec DFF-ENGINE-020
// @spec DFF-ENGINE-021
// @spec DFF-ENGINE-022
// @spec DFF-ENGINE-010
// @spec DFF-ENGINE-060
// @spec DFF-ENGINE-062
// @spec DFF-ENGINE-063
// @spec DFF-DATA-093
// @spec DFF-DATA-095
// @spec DFF-DATA-096
import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';

import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { createDrizzleDb } from '../db/client.js';
import {
  createBotChainCoordinator,
  TradeOfferCoordinatorError,
  type BotChainCoordinator,
} from '../draft/bot-chain.js';
import type { ArchetypeConfig } from '../draft/archetype-config.js';
import {
  draftOrder,
  drafts,
  leagueConfigs,
  picks,
  players,
  teams,
  tradeStatuses,
} from '../db/schema.js';
import {
  createDraft,
  deleteDraftQueueEntry,
  getDraftHistory,
  getDraftQueue,
  getDraftState,
  recordPick,
  upsertDraftQueueEntry,
} from '../draft/service.js';
import { getDraftStateSyncPayload, subscribeToDraftStream, type DraftStreamEvent } from '../draft/stream.js';
import {
  DraftConfigValidationError,
  PickSubmissionValidationError,
  QueueSubmissionValidationError,
  parseCreateDraftConfig,
  parsePickSubmission,
  parseQueueSubmission,
  parseSavedLeagueConfig,
  parseTradeOfferSubmission,
  TradeOfferSubmissionValidationError,
} from './config.js';

type CreateDraftServerOptions = {
  databasePath: string;
  archetypeConfig?: ArchetypeConfig;
  botChain?: BotChainCoordinator;
};

type SavedLeagueConfigRouteOptions = {
  databasePath: string;
  idGenerator?: () => string;
  now?: () => string;
};

type SavedLeagueConfigApiRecord = {
  id: string;
  name: string;
  team_count: number;
  rounds: number;
  scoring_format: string;
  roster_slots: {
    QB: number;
    RB: number;
    WR: number;
    TE: number;
    FLEX: number;
    SF: number;
    BN: number;
  };
  pick_position: number;
  future_pick_years: number;
  created_at: string;
};

export function createDraftApp({
  databasePath,
  archetypeConfig,
  botChain = createBotChainCoordinator({ databasePath, archetypeConfig }),
}: CreateDraftServerOptions): Express {
  const app = express();

  app.use(express.json());
  app.get('/configs', createLeagueConfigsListRoute({ databasePath }));
  app.post('/configs', createLeagueConfigsCreateRoute({ databasePath }));
  app.get('/drafts', createDraftHistoryRoute({ databasePath }));
  app.post('/drafts', createDraftRoute({ databasePath, botChain }));
  app.post('/drafts/:id/pick', createDraftPickRoute({ databasePath, botChain }));
  app.post('/drafts/:id/trade-offer', createDraftTradeOfferRoute({ databasePath, botChain }));
  app.post('/drafts/:id/trade-response', createDraftTradeResponseRoute({ databasePath, botChain }));
  app.post('/drafts/:id/queue', createDraftQueuePostRoute({ databasePath }));
  app.get('/drafts/:id/queue', createDraftQueueGetRoute({ databasePath }));
  app.delete('/drafts/:id/queue/:player_id', createDraftQueueDeleteRoute({ databasePath }));
  app.get('/drafts/:id/state', createDraftStateRoute({ databasePath }));
  app.get('/drafts/:id/stream', createDraftStreamRoute({ databasePath }));
  app.use(notFoundHandler);
  app.use(createDraftErrorHandler());

  return app;
}

// @spec DFF-DATA-095
export function createLeagueConfigsListRoute({
  databasePath,
}: SavedLeagueConfigRouteOptions): RequestHandler {
  return (_request, response, next) => {
    const { db, sqlite } = createDrizzleDb(databasePath);

    try {
      const rows = db
        .select()
        .from(leagueConfigs)
        .orderBy(desc(leagueConfigs.createdAt))
        .all();

      response.status(200).json(rows.map((row) => toSavedLeagueConfigApiRecord(row)));
    } catch (error) {
      next(error);
    } finally {
      sqlite.close();
    }
  };
}

// @spec DFF-DATA-096
export function createLeagueConfigsCreateRoute({
  databasePath,
  idGenerator = () => crypto.randomUUID(),
  now = () => new Date().toISOString(),
}: SavedLeagueConfigRouteOptions): RequestHandler {
  return (request, response, next) => {
    const { db, sqlite } = createDrizzleDb(databasePath);

    try {
      const config = parseSavedLeagueConfig(request.body);
      const record = {
        id: idGenerator(),
        name: config.name,
        teamCount: config.teamCount,
        rounds: config.rounds,
        scoringFormat: config.scoringFormat,
        rosterSlots: JSON.stringify({
          QB: config.rosterConfig.QB,
          RB: config.rosterConfig.RB,
          WR: config.rosterConfig.WR,
          TE: config.rosterConfig.TE,
          FLEX: config.rosterConfig.FLEX,
          SF: config.rosterConfig.SF,
          BN: config.rosterConfig.bench,
        }),
        pickPosition: config.userPickPosition,
        futurePickYears: config.futurePickYears,
        createdAt: now(),
      } as const;

      db.insert(leagueConfigs).values(record).run();

      response.status(201).json(
        toSavedLeagueConfigApiRecord({
          id: record.id,
          name: record.name,
          teamCount: record.teamCount,
          rounds: record.rounds,
          scoringFormat: record.scoringFormat,
          rosterSlots: record.rosterSlots,
          pickPosition: record.pickPosition,
          futurePickYears: record.futurePickYears,
          createdAt: record.createdAt,
        }),
      );
    } catch (error) {
      next(error);
    } finally {
      sqlite.close();
    }
  };
}

// @spec DFF-ENGINE-001
// @spec DFF-ENGINE-002
// @spec DFF-ENGINE-002b
// @spec DFF-ENGINE-030
export function createDraftRoute({
  databasePath,
  archetypeConfig,
  botChain = createBotChainCoordinator({ databasePath, archetypeConfig }),
}: CreateDraftServerOptions): RequestHandler {
  return (request, response, next) => {
    try {
      const config = parseCreateDraftConfig(request.body);
      const draftId = createDraft({ databasePath, config });
      botChain.trigger(draftId);

      response.status(201).json({ draftId });
    } catch (error) {
      next(error);
    }
  };
}

// @spec DFF-DATA-095
// @spec DFF-DATA-096
function toSavedLeagueConfigApiRecord(row: typeof leagueConfigs.$inferSelect): SavedLeagueConfigApiRecord {
  return {
    id: row.id,
    name: row.name,
    team_count: row.teamCount,
    rounds: row.rounds,
    scoring_format: row.scoringFormat,
    roster_slots: parseSavedLeagueConfigRosterSlots(row.rosterSlots),
    pick_position: row.pickPosition,
    future_pick_years: row.futurePickYears,
    created_at: row.createdAt,
  };
}

// @spec DFF-DATA-095
function parseSavedLeagueConfigRosterSlots(
  value: string,
): SavedLeagueConfigApiRecord['roster_slots'] {
  const parsed = JSON.parse(value) as Partial<SavedLeagueConfigApiRecord['roster_slots']>;

  if (
    typeof parsed.QB !== 'number' ||
    typeof parsed.RB !== 'number' ||
    typeof parsed.WR !== 'number' ||
    typeof parsed.TE !== 'number' ||
    typeof parsed.FLEX !== 'number' ||
    typeof parsed.SF !== 'number' ||
    typeof parsed.BN !== 'number'
  ) {
    throw new Error('Invalid saved league config roster_slots JSON.');
  }

  return {
    QB: parsed.QB,
    RB: parsed.RB,
    WR: parsed.WR,
    TE: parsed.TE,
    FLEX: parsed.FLEX,
    SF: parsed.SF,
    BN: parsed.BN,
  };
}

// @spec DFF-ENGINE-020
// @spec DFF-ENGINE-021
// @spec DFF-ENGINE-022
export function createDraftPickRoute({
  databasePath,
  archetypeConfig,
  botChain = createBotChainCoordinator({ databasePath, archetypeConfig }),
}: CreateDraftServerOptions): RequestHandler {
  return (request, response, next) => {
    try {
      const draftId = readDraftIdParam(request);

      if (!draftId) {
        response.status(404).json({ error: 'Draft not found.' });
        return;
      }

      const { playerId } = parsePickSubmission(request.body);
      const validation = validateUserPickSubmission({
        databasePath,
        draftId,
        playerId,
      });

      if (validation.status === 'draft_not_found') {
        response.status(404).json({ error: 'Draft not found.' });
        return;
      }

      if (validation.status !== 'ok') {
        response.status(400).json({ error: validation.error });
        return;
      }

      recordPick({
        databasePath,
        draftOrderId: validation.draftOrderId,
        playerId,
      });
      botChain.trigger(draftId);

      response.status(200).json({ ok: true });
    } catch (error) {
      next(error);
    }
  };
}

// @spec DFF-ENGINE-033
// @spec DFF-ENGINE-039
// @spec DFF-ENGINE-039b
// @spec DFF-ENGINE-043
export function createDraftTradeResponseRoute({
  databasePath,
  archetypeConfig,
  botChain = createBotChainCoordinator({ databasePath, archetypeConfig }),
}: CreateDraftServerOptions): RequestHandler {
  return (request, response, next) => {
    try {
      const draftId = readDraftIdParam(request);

      if (!draftId) {
        response.status(404).json({ error: 'Draft not found.' });
        return;
      }

      const status = readTradeResponseStatus(request.body);

      if (!status) {
        response.status(400).json({
          error: 'Invalid trade response: status must be accepted, declined, or force_declined.',
        });
        return;
      }

      const resumed = botChain.resolvePendingTrade(draftId, status);

      if (!resumed) {
        response.status(409).json({ error: 'No pending trade for this draft.' });
        return;
      }

      response.status(200).json({ ok: true });
    } catch (error) {
      next(error);
    }
  };
}

// @spec DFF-ENGINE-034
// @spec DFF-ENGINE-038
export function createDraftTradeOfferRoute({
  databasePath,
  archetypeConfig,
  botChain = createBotChainCoordinator({ databasePath, archetypeConfig }),
}: CreateDraftServerOptions): RequestHandler {
  return (request, response, next) => {
    try {
      const draftId = readDraftIdParam(request);

      if (!draftId) {
        response.status(404).json({ error: 'Draft not found.' });
        return;
      }

      const submission = parseTradeOfferSubmission(request.body);
      const tradeId = botChain.submitUserTradeOffer({
        draftId,
        targetTeamId: submission.targetTeamId,
        offeredAssets: submission.offeredAssets,
        requestedAssets: submission.requestedAssets,
      });

      response.status(202).json({ ok: true, tradeId });
    } catch (error) {
      if (error instanceof TradeOfferCoordinatorError) {
        response.status(error.statusCode).json({ error: error.message });
        return;
      }

      next(error);
    }
  };
}

// @spec DFF-DATA-093
export function createDraftQueuePostRoute({ databasePath }: CreateDraftServerOptions): RequestHandler {
  return (request, response, next) => {
    try {
      const draftId = readDraftIdParam(request);

      if (!draftId) {
        response.status(404).json({ error: 'Draft not found.' });
        return;
      }

      const { playerId, rank } = parseQueueSubmission(request.body);
      const result = upsertDraftQueueEntry({
        databasePath,
        draftId,
        playerId,
        rank,
      });

      if (result.status === 'draft_not_found') {
        response.status(404).json({ error: 'Draft not found.' });
        return;
      }

      if (result.status === 'player_not_found') {
        response.status(400).json({ error: 'Invalid queue submission: player does not exist.' });
        return;
      }

      response.status(200).json({ ok: true });
    } catch (error) {
      next(error);
    }
  };
}

// @spec DFF-DATA-093
export function createDraftQueueGetRoute({ databasePath }: CreateDraftServerOptions): RequestHandler {
  return (request, response, next) => {
    try {
      const draftId = readDraftIdParam(request);

      if (!draftId) {
        response.status(404).json({ error: 'Draft not found.' });
        return;
      }

      const queue = getDraftQueue({ databasePath, draftId });

      if (!queue) {
        response.status(404).json({ error: 'Draft not found.' });
        return;
      }

      response.status(200).json(queue);
    } catch (error) {
      next(error);
    }
  };
}

// @spec DFF-DATA-093
export function createDraftQueueDeleteRoute({ databasePath }: CreateDraftServerOptions): RequestHandler {
  return (request, response, next) => {
    try {
      const draftId = readDraftIdParam(request);

      if (!draftId) {
        response.status(404).json({ error: 'Draft not found.' });
        return;
      }

      const playerId = readPlayerIdParam(request);

      if (!playerId) {
        response.status(400).json({ error: 'Invalid queue submission: playerId is required.' });
        return;
      }

      const result = deleteDraftQueueEntry({
        databasePath,
        draftId,
        playerId,
      });

      if (result.status === 'draft_not_found') {
        response.status(404).json({ error: 'Draft not found.' });
        return;
      }

      if (result.status === 'queue_entry_not_found') {
        response.status(404).json({ error: 'Queue entry not found.' });
        return;
      }

      response.status(200).json({ ok: true });
    } catch (error) {
      next(error);
    }
  };
}

// @spec DFF-ENGINE-060
// @spec DFF-ENGINE-063
export function createDraftStateRoute({ databasePath }: CreateDraftServerOptions): RequestHandler {
  return (request, response, next) => {
    try {
      const draftId = readDraftIdParam(request);

      if (!draftId) {
        response.status(404).json({ error: 'Draft not found.' });
        return;
      }

      const state = getDraftState({ databasePath, draftId });

      if (!state) {
        response.status(404).json({ error: 'Draft not found.' });
        return;
      }

      response.status(200).json(state);
    } catch (error) {
      next(error);
    }
  };
}

// @spec DFF-ENGINE-062
// @spec DFF-ENGINE-063
export function createDraftHistoryRoute({ databasePath }: CreateDraftServerOptions): RequestHandler {
  return (_request, response, next) => {
    try {
      response.status(200).json(getDraftHistory({ databasePath }));
    } catch (error) {
      next(error);
    }
  };
}

// @spec DFF-ENGINE-010
export function createDraftStreamRoute({ databasePath }: CreateDraftServerOptions): RequestHandler {
  return (request, response) => {
    const draftId = readDraftIdParam(request);

    if (!draftId) {
      response.status(404).json({ error: 'Draft not found.' });
      return;
    }

    const state = getDraftStateSyncPayload({ databasePath, draftId });

    if (!state) {
      response.status(404).json({ error: 'Draft not found.' });
      return;
    }

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    const unsubscribe = subscribeToDraftStream(draftId, (event) => {
      writeSseEvent(response, event);
    });

    writeSseEvent(response, {
      event: 'state_sync',
      data: state,
    });

    request.on('close', () => {
      unsubscribe();
      response.end();
    });
  };
}

const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({ error: 'Not found.' });
};

export function createDraftErrorHandler(): ErrorRequestHandler {
  return (error, _request, response, _next) => {
    if (error instanceof DraftConfigValidationError) {
      response.status(400).json({ error: error.message });
      return;
    }

    // @spec DFF-ENGINE-021
    if (error instanceof PickSubmissionValidationError) {
      response.status(400).json({ error: error.message });
      return;
    }

    // @spec DFF-DATA-093
  if (error instanceof QueueSubmissionValidationError) {
    response.status(400).json({ error: error.message });
    return;
  }

  if (error instanceof TradeOfferSubmissionValidationError) {
    response.status(400).json({ error: error.message });
    return;
  }

    if (isJsonBodyParseError(error)) {
      response.status(400).json({ error: 'Invalid draft config: request body must be valid JSON.' });
      return;
    }

    console.error(error);
    response.status(500).json({ error: 'Internal server error.' });
  };
}

function writeSseEvent(
  response: Response,
  event: DraftStreamEvent,
): void {
  response.write(`event: ${event.event}\n`);
  response.write(`data: ${JSON.stringify(event.data)}\n\n`);
}

function readDraftIdParam(request: Request): string | null {
  const draftId = request.params.id;
  return typeof draftId === 'string' ? draftId : null;
}

function readPlayerIdParam(request: Request): string | null {
  const playerId = request.params.player_id;

  if (typeof playerId !== 'string' || playerId.trim() === '') {
    return null;
  }

  return playerId;
}

function readTradeResponseStatus(requestBody: unknown): (typeof tradeStatuses)[number] | null {
  if (typeof requestBody !== 'object' || requestBody === null || Array.isArray(requestBody)) {
    return null;
  }

  const status = (requestBody as { status?: unknown }).status;

  return typeof status === 'string' && tradeStatuses.includes(status as (typeof tradeStatuses)[number])
    ? (status as (typeof tradeStatuses)[number])
    : null;
}

type UserPickValidationResult =
  | { status: 'ok'; draftOrderId: string }
  | { status: 'draft_not_found' }
  | { status: 'invalid'; error: string };

// @spec DFF-ENGINE-020
// @spec DFF-ENGINE-021
function validateUserPickSubmission({
  databasePath,
  draftId,
  playerId,
}: {
  databasePath: string;
  draftId: string;
  playerId: string;
}): UserPickValidationResult {
  const { sqlite, db } = createDrizzleDb(databasePath);

  try {
    const draft = db
      .select({
        id: drafts.id,
      })
      .from(drafts)
      .where(eq(drafts.id, draftId))
      .get();

    if (!draft) {
      return { status: 'draft_not_found' };
    }

    const currentSlot = db
      .select({
        id: draftOrder.id,
        isUser: teams.isUser,
      })
      .from(draftOrder)
      .innerJoin(teams, eq(draftOrder.teamId, teams.id))
      .leftJoin(picks, eq(draftOrder.id, picks.draftOrderId))
      .where(and(eq(draftOrder.draftId, draftId), isNull(picks.id)))
      .orderBy(asc(draftOrder.pickNumber))
      .get();

    if (!currentSlot) {
      return {
        status: 'invalid',
        error: 'Invalid pick submission: draft is already complete.',
      };
    }

    if (!currentSlot.isUser) {
      return {
        status: 'invalid',
        error: 'Invalid pick submission: it is not currently the user team turn.',
      };
    }

    const player = db
      .select({
        id: players.id,
      })
      .from(players)
      .where(eq(players.id, playerId))
      .get();

    if (!player) {
      return {
        status: 'invalid',
        error: 'Invalid pick submission: player does not exist.',
      };
    }

    const existingPick = db
      .select({
        id: picks.id,
      })
      .from(picks)
      .where(and(eq(picks.draftId, draftId), eq(picks.playerId, playerId)))
      .get();

    if (existingPick) {
      return {
        status: 'invalid',
        error: 'Invalid pick submission: player has already been picked.',
      };
    }

    return {
      status: 'ok',
      draftOrderId: currentSlot.id,
    };
  } finally {
    sqlite.close();
  }
}

function isJsonBodyParseError(error: unknown): error is SyntaxError & {
  status: number;
  body: unknown;
} {
  return (
    error instanceof SyntaxError &&
    'status' in error &&
    (error as { status?: unknown }).status === 400 &&
    'body' in error
  );
}
