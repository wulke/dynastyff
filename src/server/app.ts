// @spec DFF-ENGINE-001
// @spec DFF-ENGINE-003
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { createDraft } from '../draft/service.js';
import {
  DraftConfigValidationError,
  parseCreateDraftConfig,
} from './config.js';

type CreateDraftServerOptions = {
  databasePath: string;
};

type DraftRequest = AsyncIterable<Buffer | string> & {
  method?: string;
  url?: string;
};

type DraftResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: string): void;
};

export function createDraftServer({ databasePath }: CreateDraftServerOptions): Server {
  return createServer((request, response) => {
    void handleDraftRequest(request, response, { databasePath });
  });
}

export async function handleDraftRequest(
  request: DraftRequest,
  response: DraftResponse,
  { databasePath }: CreateDraftServerOptions,
): Promise<void> {
  try {
    if (request.method === 'POST' && request.url === '/drafts') {
      const body = await readJsonBody(request);
      const config = parseCreateDraftConfig(body);
      const draftId = createDraft({ databasePath, config });

      sendJson(response, 201, { draftId });
      return;
    }

    sendJson(response, 404, { error: 'Not found.' });
  } catch (error) {
    if (error instanceof DraftConfigValidationError) {
      sendJson(response, 400, { error: error.message });
      return;
    }

    if (error instanceof SyntaxError) {
      sendJson(response, 400, { error: 'Invalid draft config: request body must be valid JSON.' });
      return;
    }

    console.error(error);
    sendJson(response, 500, { error: 'Internal server error.' });
  }
}

async function readJsonBody(request: DraftRequest): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    throw new DraftConfigValidationError('Invalid draft config: request body must be a JSON object.');
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function sendJson(response: DraftResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}
