// @spec DFF-ENGINE-001
// @spec DFF-ENGINE-003
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { initializeDatabase } from '../src/db/init.js';
import { createDraftServer } from '../src/server/app.js';
import viteConfig from '../src/ui/vite.config.js';

type StartedServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

const openServers: StartedServer[] = [];

afterEach(async () => {
  while (openServers.length > 0) {
    const server = openServers.pop();

    if (server) {
      await server.close();
    }
  }
});

function createTempDatabasePath(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(tempDir, 'test.sqlite');
}

async function startServer(databasePath: string): Promise<StartedServer> {
  const server = createDraftServer({ databasePath });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Expected server to listen on an ephemeral TCP port');
  }

  const startedServer = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };

  openServers.push(startedServer);

  return startedServer;
}

function readDraft(databasePath: string, draftId: string) {
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  try {
    return db
      .prepare(
        `SELECT team_count, rounds, scoring_format, user_pick_position, future_pick_years, future_pick_rounds, roster_config
         FROM drafts
         WHERE id = ?`,
      )
      .get(draftId) as
      | {
          team_count: number;
          rounds: number;
          scoring_format: string;
          user_pick_position: number;
          future_pick_years: number;
          future_pick_rounds: number;
          roster_config: string;
        }
      | undefined;
  } finally {
    db.close();
  }
}

test('POST /drafts returns 201 and the created draft id for a valid camelCase config payload', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-valid-');
  initializeDatabase(databasePath);
  const server = await startServer(databasePath);

  const response = await fetch(`${server.baseUrl}/drafts`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      configName: 'Startup 12',
      teamCount: 12,
      rounds: 20,
      scoringFormat: 'ppr',
      rosterSlots: {
        QB: 1,
        RB: 2,
        WR: 3,
        TE: 1,
        FLEX: 1,
        SF: 1,
        BN: 6,
      },
      pickPosition: 6,
      futurePickYears: 3,
    }),
  });

  assert.equal(response.status, 201);
  assert.equal(response.headers.get('content-type'), 'application/json');

  const body = (await response.json()) as { draftId: string };

  assert.match(body.draftId, /^[0-9a-f-]{36}$/i);

  const draft = readDraft(databasePath, body.draftId);

  assert.ok(draft);
  assert.deepEqual(draft, {
    team_count: 12,
    rounds: 20,
    scoring_format: 'ppr',
    user_pick_position: 6,
    future_pick_years: 3,
    future_pick_rounds: 20,
    roster_config: JSON.stringify({
      QB: 1,
      RB: 2,
      WR: 3,
      TE: 1,
      FLEX: 1,
      SF: 1,
      bench: 6,
    }),
  });

  fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
});

test('POST /drafts returns 400 with a descriptive error and does not create a draft when a required field is missing', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-missing-');
  initializeDatabase(databasePath);
  const server = await startServer(databasePath);

  const response = await fetch(`${server.baseUrl}/drafts`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      configName: 'Missing Team Count',
      rounds: 20,
      scoringFormat: 'ppr',
      rosterSlots: {
        QB: 1,
        RB: 2,
        WR: 3,
        TE: 1,
        FLEX: 1,
        SF: 1,
        BN: 6,
      },
      pickPosition: 6,
      futurePickYears: 3,
    }),
  });

  assert.equal(response.status, 400);
  assert.equal(await response.json(), {
    error: 'Invalid draft config: teamCount is required.',
  });

  const db = new Database(databasePath);

  try {
    const draftCount = db.prepare('SELECT COUNT(*) AS count FROM drafts').get() as { count: number };
    assert.equal(draftCount.count, 0);
  } finally {
    db.close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

test('POST /drafts returns 400 with a descriptive error and does not create a draft when a field is out of range', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-invalid-');
  initializeDatabase(databasePath);
  const server = await startServer(databasePath);

  const response = await fetch(`${server.baseUrl}/drafts`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      configName: 'Invalid Team Count',
      teamCount: 7,
      rounds: 20,
      scoringFormat: 'ppr',
      rosterSlots: {
        QB: 1,
        RB: 2,
        WR: 3,
        TE: 1,
        FLEX: 1,
        SF: 1,
        BN: 6,
      },
      pickPosition: 6,
      futurePickYears: 3,
    }),
  });

  assert.equal(response.status, 400);
  assert.equal(await response.json(), {
    error: 'Invalid draft config: teamCount must be an integer between 8 and 16.',
  });

  const db = new Database(databasePath);

  try {
    const draftCount = db.prepare('SELECT COUNT(*) AS count FROM drafts').get() as { count: number };
    assert.equal(draftCount.count, 0);
  } finally {
    db.close();
    fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
  }
});

test('Vite dev server proxies /drafts requests to the backend server', () => {
  const serverConfig = viteConfig.server;

  assert.ok(serverConfig);
  assert.equal(serverConfig.proxy?.['/drafts']?.target, 'http://localhost:3001');
});
