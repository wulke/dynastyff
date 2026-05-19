// @spec DFF-ENGINE-001
// @spec DFF-ENGINE-003
import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
} from 'express';

import { createDraft } from '../draft/service.js';
import { DraftConfigValidationError, parseCreateDraftConfig } from './config.js';

type CreateDraftServerOptions = {
  databasePath: string;
};

export function createDraftApp({ databasePath }: CreateDraftServerOptions): Express {
  const app = express();

  app.use(express.json());
  app.post('/drafts', createDraftRoute({ databasePath }));
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
