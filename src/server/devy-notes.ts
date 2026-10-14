// @spec DFF-DVR-009
// @spec DFF-DVR-011
// @spec DFF-DVR-012
// @spec DFF-DVR-013
// @spec DFF-DVR-016
import Database from 'better-sqlite3';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { createDatabase } from '../db/client.js';

type NoteRow = { player_id: string; note: string; updated_at: string };

export type DevyNotesRouteOptions = {
  databasePath?: string;
  /** Injectable clock for tests; defaults to wall-clock ISO timestamps. */
  now?: () => string;
};

// Opens through the schema-guarded client (DFF-DATA-099) so a database with
// pending migrations fails with the actionable `npm run db:migrate` error.
// A schema/open failure is forwarded to `next(error)` rather than escaping the
// handler (mirrors the route contract fixed for the sibling routes in #241).
// @spec DFF-DATA-099
// @spec DFF-DVR-016
function openRouteDatabase(databasePath: string | undefined, next: NextFunction): Database.Database | undefined {
  try {
    return createDatabase(databasePath);
  } catch (error) {
    next(error);
    return undefined;
  }
}

// @spec DFF-DVR-012 — every stored devy note, keyed by player id.
export function createDevyNotesListRoute({ databasePath }: DevyNotesRouteOptions = {}): RequestHandler {
  return (_request, response, next) => {
    const sqlite = openRouteDatabase(databasePath, next);

    if (!sqlite) {
      return;
    }

    try {
      const rows = sqlite.prepare('SELECT player_id, note, updated_at FROM devy_player_notes').all() as NoteRow[];
      const notes: Record<string, { note: string; updatedAt: string }> = {};

      for (const row of rows) {
        notes[row.player_id] = { note: row.note, updatedAt: row.updated_at };
      }

      response.status(200).json({ notes });
    } finally {
      sqlite.close();
    }
  };
}

// @spec DFF-DVR-009 — upsert a note keyed by devy player id.
// @spec DFF-DVR-011 — trimmed-empty notes delete the stored row (idempotent).
// @spec DFF-DVR-013 — non-string notes and blank player ids are rejected with 400.
export function createDevyNotePutRoute({ databasePath, now }: DevyNotesRouteOptions = {}): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    const params = (request.params ?? {}) as { player_id?: string };
    const playerId = typeof params.player_id === 'string' ? params.player_id.trim() : '';
    const body = request.body as { note?: unknown } | undefined;
    const note = body?.note;

    if (!playerId || typeof note !== 'string') {
      response.status(400).json({ error: 'A player id and a string note are required.' });
      return;
    }

    const trimmed = note.trim();
    const sqlite = openRouteDatabase(databasePath, next);

    if (!sqlite) {
      return;
    }

    try {
      if (trimmed === '') {
        sqlite.prepare('DELETE FROM devy_player_notes WHERE player_id = ?').run(playerId);
        response.status(200).json({ playerId, note: '', updatedAt: null });
        return;
      }

      const updatedAt = (now ?? (() => new Date().toISOString()))();
      sqlite
        .prepare(
          `INSERT INTO devy_player_notes (player_id, note, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(player_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at`,
        )
        .run(playerId, trimmed, updatedAt);

      response.status(200).json({ playerId, note: trimmed, updatedAt });
    } finally {
      sqlite.close();
    }
  };
}
