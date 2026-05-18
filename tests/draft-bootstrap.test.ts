// @spec DFF-ENGINE-001
// @spec DFF-ENGINE-002
// @spec DFF-ENGINE-004
// @spec DFF-ENGINE-005
// @spec DFF-ENGINE-016
// @spec DFF-DATA-020
// @spec DFF-DATA-023
// @spec DFF-DATA-030
// @spec DFF-DATA-031
// @spec DFF-DATA-032
// @spec DFF-DATA-040
// @spec DFF-DATA-041
// @spec DFF-DATA-070
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { initializeDatabase } from '../src/db/init.js';
import { createDraft, updateDraftStatus } from '../src/draft/service.js';
import { teamArchetypes } from '../src/db/schema.js';

function withDatabase(
  run: (db: Database.Database, databasePath: string) => void | Promise<void>,
): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-draft-bootstrap-'));
  const databasePath = path.join(tempDir, 'test.sqlite');
  initializeDatabase(databasePath);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  return Promise.resolve(run(db, databasePath)).finally(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
}

test('createDraft seeds teams, snake order, and future pick assets in one transaction', async () => {
  await withDatabase(async (db, databasePath) => {
    const draftId = createDraft({
      databasePath,
      config: {
        teamCount: 4,
        rounds: 3,
        scoringFormat: 'ppr',
        userPickPosition: 2,
        futurePickYears: 2,
        futurePickRounds: 2,
        rosterConfig: {
          QB: 1,
          RB: 2,
          WR: 3,
          TE: 1,
          FLEX: 1,
          SF: 1,
          bench: 6,
        },
      },
      now: () => '2026-05-18T20:00:00.000Z',
      random: () => 0,
    });

    const draft = db
      .prepare(
        `SELECT status, completed_at, team_count, rounds, user_pick_position, future_pick_years, future_pick_rounds
         FROM drafts
         WHERE id = ?`,
      )
      .get(draftId) as
      | {
          status: string;
          completed_at: string | null;
          team_count: number;
          rounds: number;
          user_pick_position: number;
          future_pick_years: number;
          future_pick_rounds: number;
        }
      | undefined;

    assert.ok(draft);
    assert.equal(draft.status, 'in_progress');
    assert.equal(draft.completed_at, null);
    assert.equal(draft.team_count, 4);
    assert.equal(draft.rounds, 3);
    assert.equal(draft.user_pick_position, 2);
    assert.equal(draft.future_pick_years, 2);
    assert.equal(draft.future_pick_rounds, 2);

    const teams = db
      .prepare(
        `SELECT name, is_user, pick_position, archetype
         FROM teams
         WHERE draft_id = ?
         ORDER BY pick_position`,
      )
      .all(draftId) as Array<{
      name: string;
      is_user: number;
      pick_position: number;
      archetype: string | null;
    }>;

    assert.equal(teams.length, 4);
    assert.equal(
      teams.filter((team) => team.is_user === 1).length,
      1,
    );
    assert.deepEqual(
      teams.map((team) => ({ pick_position: team.pick_position, is_user: team.is_user })),
      [
        { pick_position: 1, is_user: 0 },
        { pick_position: 2, is_user: 1 },
        { pick_position: 3, is_user: 0 },
        { pick_position: 4, is_user: 0 },
      ],
    );

    for (const team of teams.filter((entry) => entry.is_user === 0)) {
      assert.match(team.name, /^[A-Z][a-z]+$/);
      assert.ok(team.archetype);
      assert.equal(teamArchetypes.includes(team.archetype), true);
    }

    const draftOrder = db
      .prepare(
        `SELECT do.pick_number, do.round, do.pick_in_round, t.pick_position
         FROM draft_order do
         INNER JOIN teams t ON t.id = do.team_id
         WHERE do.draft_id = ?
         ORDER BY do.pick_number`,
      )
      .all(draftId) as Array<{
      pick_number: number;
      round: number;
      pick_in_round: number;
      pick_position: number;
    }>;

    assert.equal(draftOrder.length, 12);
    assert.deepEqual(
      draftOrder.map((entry) => ({
        pick_number: entry.pick_number,
        round: entry.round,
        pick_in_round: entry.pick_in_round,
        pick_position: entry.pick_position,
      })),
      [
        { pick_number: 1, round: 1, pick_in_round: 1, pick_position: 1 },
        { pick_number: 2, round: 1, pick_in_round: 2, pick_position: 2 },
        { pick_number: 3, round: 1, pick_in_round: 3, pick_position: 3 },
        { pick_number: 4, round: 1, pick_in_round: 4, pick_position: 4 },
        { pick_number: 5, round: 2, pick_in_round: 1, pick_position: 4 },
        { pick_number: 6, round: 2, pick_in_round: 2, pick_position: 3 },
        { pick_number: 7, round: 2, pick_in_round: 3, pick_position: 2 },
        { pick_number: 8, round: 2, pick_in_round: 4, pick_position: 1 },
        { pick_number: 9, round: 3, pick_in_round: 1, pick_position: 1 },
        { pick_number: 10, round: 3, pick_in_round: 2, pick_position: 2 },
        { pick_number: 11, round: 3, pick_in_round: 3, pick_position: 3 },
        { pick_number: 12, round: 3, pick_in_round: 4, pick_position: 4 },
      ],
    );

    const pickAssets = db
      .prepare(
        `SELECT t.pick_position, a.year, a.round
         FROM team_pick_assets a
         INNER JOIN teams t ON t.id = a.team_id
         WHERE a.draft_id = ?
         ORDER BY t.pick_position, a.year, a.round`,
      )
      .all(draftId) as Array<{
      pick_position: number;
      year: number;
      round: number;
    }>;

    assert.equal(pickAssets.length, 16);
    assert.deepEqual(
      pickAssets,
      [
        { pick_position: 1, year: 2027, round: 1 },
        { pick_position: 1, year: 2027, round: 2 },
        { pick_position: 1, year: 2028, round: 1 },
        { pick_position: 1, year: 2028, round: 2 },
        { pick_position: 2, year: 2027, round: 1 },
        { pick_position: 2, year: 2027, round: 2 },
        { pick_position: 2, year: 2028, round: 1 },
        { pick_position: 2, year: 2028, round: 2 },
        { pick_position: 3, year: 2027, round: 1 },
        { pick_position: 3, year: 2027, round: 2 },
        { pick_position: 3, year: 2028, round: 1 },
        { pick_position: 3, year: 2028, round: 2 },
        { pick_position: 4, year: 2027, round: 1 },
        { pick_position: 4, year: 2027, round: 2 },
        { pick_position: 4, year: 2028, round: 1 },
        { pick_position: 4, year: 2028, round: 2 },
      ],
    );
  });
});

test('createDraft rolls back the draft row and all derived rows when bootstrap fails mid-transaction', async () => {
  await withDatabase(async (db, databasePath) => {
    assert.throws(
      () =>
        createDraft({
          databasePath,
          config: {
            teamCount: 2,
            rounds: 2,
            scoringFormat: 'ppr',
            userPickPosition: 1,
            futurePickYears: 1,
            futurePickRounds: 1,
            rosterConfig: {
              QB: 1,
              RB: 2,
              WR: 3,
              TE: 1,
              FLEX: 1,
              SF: 1,
              bench: 6,
            },
          },
          now: () => '2026-05-18T21:00:00.000Z',
          random: () => 0,
          idGenerator: (() => {
            const ids = ['draft-1', 'team-1', 'team-2', 'order-1', 'order-1'];
            let index = 0;

            return () => ids[index++] ?? `extra-${index}`;
          })(),
        }),
      /UNIQUE constraint failed/,
    );

    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM drafts').get() as { count: number }).count,
      0,
    );
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM teams').get() as { count: number }).count,
      0,
    );
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM draft_order').get() as { count: number }).count,
      0,
    );
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM team_pick_assets').get() as { count: number }).count,
      0,
    );
  });
});

test('updateDraftStatus sets completed_at when a draft transitions to completed', async () => {
  await withDatabase(async (db, databasePath) => {
    const draftId = createDraft({
      databasePath,
      config: {
        teamCount: 2,
        rounds: 1,
        scoringFormat: 'ppr',
        userPickPosition: 1,
        futurePickYears: 1,
        futurePickRounds: 1,
        rosterConfig: {
          QB: 1,
          RB: 2,
          WR: 3,
          TE: 1,
          FLEX: 1,
          SF: 1,
          bench: 6,
        },
      },
      now: () => '2026-05-18T22:00:00.000Z',
      random: () => 0,
    });

    updateDraftStatus({
      databasePath,
      draftId,
      status: 'completed',
      now: () => '2026-05-18T22:30:00.000Z',
    });

    const draft = db
      .prepare('SELECT status, completed_at FROM drafts WHERE id = ?')
      .get(draftId) as { status: string; completed_at: string | null };

    assert.deepEqual(draft, {
      status: 'completed',
      completed_at: '2026-05-18T22:30:00.000Z',
    });
  });
});
