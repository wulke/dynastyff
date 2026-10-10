// @spec DFF-DVR-009
// @spec DFF-DVR-011
// @spec DFF-DVR-012
// @spec DFF-DVR-013
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Request, RequestHandler, Response } from 'express';

import { createDevyNotePutRoute, createDevyNotesListRoute } from '../src/server/devy-notes.js';
import { initializeDatabase } from '../src/db/init.js';

async function invokeRoute({
  route,
  params,
  body,
}: {
  route: RequestHandler;
  params?: Record<string, string>;
  body?: unknown;
}): Promise<{ statusCode: number; json: unknown }> {
  const request = { params, body } as Request;
  let statusCode = 200;
  let responseBody: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      responseBody = payload;
      return this;
    },
  } as unknown as Response;

  await route(request, response, () => {});
  return { statusCode, json: responseBody };
}

function createNotesFixture(): { dbPath: string; cleanup: () => void } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-devy-notes-'));
  const dbPath = path.join(tempDir, 'test.sqlite');
  initializeDatabase(dbPath);
  return { dbPath, cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }) };
}

// @spec DFF-DVR-012
test('notes list route returns an empty mapping when no notes are stored', async () => {
  const fixture = createNotesFixture();

  try {
    const route = createDevyNotesListRoute({ databasePath: fixture.dbPath });
    const { statusCode, json } = await invokeRoute({ route });
    const body = json as { notes: Record<string, { note: string; updatedAt: string }> };

    assert.equal(statusCode, 200);
    assert.deepEqual(body.notes, {});
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-DVR-009
test('notes put route persists a note keyed by player id and the list route returns it', async () => {
  const fixture = createNotesFixture();

  try {
    const put = createDevyNotePutRoute({ databasePath: fixture.dbPath });
    const saved = await invokeRoute({
      route: put,
      params: { player_id: 'devy-1' },
      body: { note: '  Breakaway pace, 2027 first-rounder. ' },
    });
    const savedBody = saved.json as { playerId: string; note: string; updatedAt: string };

    assert.equal(saved.statusCode, 200);
    assert.equal(savedBody.playerId, 'devy-1');
    assert.equal(savedBody.note, 'Breakaway pace, 2027 first-rounder.');
    assert.ok(savedBody.updatedAt);

    const list = await invokeRoute({ route: createDevyNotesListRoute({ databasePath: fixture.dbPath }) });
    const listBody = list.json as { notes: Record<string, { note: string; updatedAt: string }> };

    assert.deepEqual(listBody.notes['devy-1'], { note: 'Breakaway pace, 2027 first-rounder.', updatedAt: savedBody.updatedAt });
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-DVR-009
test('notes put route overwrites an existing note and refreshes the timestamp', async () => {
  const fixture = createNotesFixture();

  try {
    let tick = 0;
    const put = createDevyNotePutRoute({ databasePath: fixture.dbPath, now: () => new Date(Date.UTC(2026, 9, 27, 12, 0, tick++)).toISOString() });
    const first = await invokeRoute({ route: put, params: { player_id: 'devy-1' }, body: { note: 'first' } });
    const second = await invokeRoute({ route: put, params: { player_id: 'devy-1' }, body: { note: 'second' } });
    const firstBody = first.json as { updatedAt: string };
    const secondBody = second.json as { note: string; updatedAt: string };

    assert.equal(firstBody.updatedAt, '2026-10-27T12:00:00.000Z');
    assert.equal(secondBody.note, 'second');
    assert.equal(secondBody.updatedAt, '2026-10-27T12:00:01.000Z');
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-DVR-011
test('notes put route deletes a note when the saved note is empty or whitespace', async () => {
  const fixture = createNotesFixture();

  try {
    const put = createDevyNotePutRoute({ databasePath: fixture.dbPath });
    await invokeRoute({ route: put, params: { player_id: 'devy-1' }, body: { note: 'first' } });
    const deleted = await invokeRoute({ route: put, params: { player_id: 'devy-1' }, body: { note: '   ' } });
    const deletedBody = deleted.json as { playerId: string; note: string; updatedAt: string | null };

    assert.equal(deleted.statusCode, 200);
    assert.deepEqual(deletedBody, { playerId: 'devy-1', note: '', updatedAt: null });

    const list = await invokeRoute({ route: createDevyNotesListRoute({ databasePath: fixture.dbPath }) });
    assert.deepEqual((list.json as { notes: Record<string, unknown> }).notes, {});
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-DVR-013
test('notes put route rejects non-string notes and blank player ids with 400', async () => {
  const fixture = createNotesFixture();

  try {
    const put = createDevyNotePutRoute({ databasePath: fixture.dbPath });

    const nonString = await invokeRoute({ route: put, params: { player_id: 'devy-1' }, body: { note: 42 } });
    assert.equal(nonString.statusCode, 400);

    const missingBody = await invokeRoute({ route: put, params: { player_id: 'devy-1' } });
    assert.equal(missingBody.statusCode, 400);

    const blankId = await invokeRoute({ route: put, params: { player_id: '  ' }, body: { note: 'x' } });
    assert.equal(blankId.statusCode, 400);

    const missingId = await invokeRoute({ route: put, body: { note: 'x' } });
    assert.equal(missingId.statusCode, 400);
  } finally {
    fixture.cleanup();
  }
});
