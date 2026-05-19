// @spec DFF-ENGINE-001
// @spec DFF-ENGINE-003
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { initializeDatabase } from '../src/db/init.js';
import { handleDraftRequest } from '../src/server/app.js';
import { parseCreateDraftConfig } from '../src/server/config.js';
import { resolveApiBaseUrl } from '../src/server/runtime.js';
import viteConfig from '../src/ui/vite.config.js';

function createTempDatabasePath(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(tempDir, 'test.sqlite');
}

function createDraftRequestBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
    ...overrides,
  };
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

async function invokeDraftRoute(
  databasePath: string,
  body: Record<string, unknown>,
): Promise<{
  statusCode: number;
  headers: Record<string, number | string | string[] | undefined>;
  json: unknown;
}> {
  const request = {
    method: 'POST',
    url: '/drafts',
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body), 'utf8');
    },
  };

  let responseBody = '';
  const headers: Record<string, number | string | string[] | undefined> = {};
  const response = {
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    end(bodyText: string) {
      responseBody = bodyText;
    },
  };

  await handleDraftRequest(request, response, { databasePath });

  return {
    statusCode: response.statusCode,
    headers,
    json: JSON.parse(responseBody) as unknown,
  };
}

test('POST /drafts returns 201 and the created draft id for a valid camelCase config payload', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-valid-');
  initializeDatabase(databasePath);
  const response = await invokeDraftRoute(
    databasePath,
    createDraftRequestBody({
      configName: 'Superflex Sprint',
      teamCount: 10,
      rounds: 18,
      scoringFormat: 'half_ppr',
      rosterSlots: {
        QB: 2,
        RB: 2,
        WR: 2,
        TE: 1,
        FLEX: 2,
        SF: 1,
        BN: 8,
      },
      pickPosition: 4,
      futurePickYears: 2,
    }),
  );

  assert.equal(response.statusCode, 201);
  assert.equal(response.headers['content-type'], 'application/json');

  const body = response.json as { draftId: string };

  assert.match(body.draftId, /^[0-9a-f-]{36}$/i);

  const draft = readDraft(databasePath, body.draftId);

  assert.ok(draft);
  assert.deepEqual(draft, {
    team_count: 10,
    rounds: 18,
    scoring_format: 'half_ppr',
    user_pick_position: 4,
    future_pick_years: 2,
    future_pick_rounds: 18,
    roster_config: JSON.stringify({
      QB: 2,
      RB: 2,
      WR: 2,
      TE: 1,
      FLEX: 2,
      SF: 1,
      bench: 8,
    }),
  });

  fs.rmSync(path.dirname(databasePath), { recursive: true, force: true });
});

test('POST /drafts returns 400 with a descriptive error and does not create a draft when a required field is missing', async () => {
  const databasePath = createTempDatabasePath('dynastyff-http-api-missing-');
  initializeDatabase(databasePath);
  const invalidBody = createDraftRequestBody();
  delete invalidBody.teamCount;
  const response = await invokeDraftRoute(databasePath, invalidBody);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json, {
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
  const response = await invokeDraftRoute(
    databasePath,
    createDraftRequestBody({
      configName: 'Invalid Team Count',
      teamCount: 7,
    }),
  );

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json, {
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
  const proxyConfig = serverConfig?.proxy?.['/drafts'];

  assert.ok(serverConfig);
  assert.ok(proxyConfig && typeof proxyConfig !== 'string');
  assert.equal(proxyConfig.target, resolveApiBaseUrl());
});

test('parseCreateDraftConfig maps UI camelCase config into the service draft config shape', () => {
  const config = parseCreateDraftConfig(
    createDraftRequestBody({
      configName: 'Standard Build',
      teamCount: 8,
      rounds: 10,
      scoringFormat: 'standard',
      rosterSlots: {
        QB: 1,
        RB: 3,
        WR: 2,
        TE: 2,
        FLEX: 0,
        SF: 0,
        BN: 5,
      },
      pickPosition: 8,
      futurePickYears: 1,
    }),
  );

  assert.deepEqual(config, {
    teamCount: 8,
    rounds: 10,
    scoringFormat: 'standard',
    userPickPosition: 8,
    futurePickYears: 1,
    futurePickRounds: 10,
    rosterConfig: {
      QB: 1,
      RB: 3,
      WR: 2,
      TE: 2,
      FLEX: 0,
      SF: 0,
      bench: 5,
    },
  });
});

test('parseCreateDraftConfig rejects invalid request bodies and config values with descriptive validation errors', () => {
  assert.throws(
    () => parseCreateDraftConfig(null),
    /Invalid draft config: request body must be a JSON object\./,
  );
  assert.throws(
    () => parseCreateDraftConfig(createDraftRequestBody({ configName: 12 })),
    /Invalid draft config: configName must be a string\./,
  );
  assert.throws(
    () => parseCreateDraftConfig(createDraftRequestBody({ scoringFormat: 'dynasty' })),
    /Invalid draft config: scoringFormat must be one of ppr, half_ppr, standard\./,
  );
  assert.throws(
    () => parseCreateDraftConfig(createDraftRequestBody({ pickPosition: 13 })),
    /Invalid draft config: pickPosition must be an integer between 1 and 12\./,
  );
  assert.throws(
    () =>
      parseCreateDraftConfig(
        createDraftRequestBody({
          rosterSlots: {
            QB: 1,
            RB: 2,
            WR: 3,
            TE: 1,
            FLEX: 1,
            SF: 1,
            BN: -1,
          },
        }),
      ),
    /Invalid draft config: rosterSlots.BN must be a non-negative integer\./,
  );
  assert.throws(
    () => parseCreateDraftConfig(createDraftRequestBody({ futurePickYears: 0 })),
    /Invalid draft config: futurePickYears must be an integer between 1 and 5\./,
  );
});
