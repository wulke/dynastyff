// @spec DFF-ENGINE-001
// @spec DFF-ENGINE-003
// @spec DFF-ENGINE-020
// @spec DFF-ENGINE-021
// @spec DFF-ENGINE-022
// @spec DFF-ENGINE-010
// @spec DFF-ENGINE-060
// @spec DFF-ENGINE-062
// @spec DFF-ENGINE-063
import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';

import { and, asc, eq, isNull } from 'drizzle-orm';
import { createDrizzleDb } from '../db/client.js';
import { draftOrder, drafts, picks, players, teams } from '../db/schema.js';
import { createDraft, getDraftHistory, getDraftState, recordPick } from '../draft/service.js';
import { getDraftStateSyncPayload, subscribeToDraftStream, type DraftStreamEvent } from '../draft/stream.js';
import {
  DraftConfigValidationError,
  PickSubmissionValidationError,
  parseCreateDraftConfig,
  parsePickSubmission,
} from './config.js';

type CreateDraftServerOptions = {
  databasePath: string;
};

export function createDraftApp({ databasePath }: CreateDraftServerOptions): Express {
  const app = express();

  app.use(express.json());
  app.get('/drafts', createDraftHistoryRoute({ databasePath }));
  app.post('/drafts', createDraftRoute({ databasePath }));
  app.post('/drafts/:id/pick', createDraftPickRoute({ databasePath }));
  app.get('/drafts/:id/state', createDraftStateRoute({ databasePath }));
  app.get('/drafts/:id/stream', createDraftStreamRoute({ databasePath }));
  app.use(notFoundHandler);
  app.use(createDraftErrorHandler());

  return app;
}

export function createDraftRoute({ databasePath }: CreateDraftServerOptions): RequestHandler {
  return (request, response, next) => {
    try {
      const config = parseCreateDraftConfig(request.body);
      const draftId = createDraft({ databasePath, config });

      response.status(201).json({ draftId });
    } catch (error) {
      next(error);
    }
  };
}

// @spec DFF-ENGINE-020
// @spec DFF-ENGINE-021
// @spec DFF-ENGINE-022
export function createDraftPickRoute({ databasePath }: CreateDraftServerOptions): RequestHandler {
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

    if (error instanceof PickSubmissionValidationError) {
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
