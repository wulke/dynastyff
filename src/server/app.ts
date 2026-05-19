// @spec DFF-ENGINE-001
// @spec DFF-ENGINE-003
// @spec DFF-ENGINE-010
import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
} from 'express';

import { createDraft } from '../draft/service.js';
import { getDraftStateSyncPayload, subscribeToDraftStream, type DraftStreamEvent } from '../draft/stream.js';
import { DraftConfigValidationError, parseCreateDraftConfig } from './config.js';

type CreateDraftServerOptions = {
  databasePath: string;
};

export function createDraftApp({ databasePath }: CreateDraftServerOptions): Express {
  const app = express();

  app.use(express.json());
  app.post('/drafts', createDraftRoute({ databasePath }));
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

export function createDraftStreamRoute({ databasePath }: CreateDraftServerOptions): RequestHandler {
  return (request, response) => {
    const draftId = request.params.id;
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

    if (error instanceof SyntaxError) {
      response.status(400).json({ error: 'Invalid draft config: request body must be valid JSON.' });
      return;
    }

    console.error(error);
    response.status(500).json({ error: 'Internal server error.' });
  };
}

function writeSseEvent(
  response: Parameters<RequestHandler>[1],
  event: DraftStreamEvent,
): void {
  response.write(`event: ${event.event}\n`);
  response.write(`data: ${JSON.stringify(event.data)}\n\n`);
}
