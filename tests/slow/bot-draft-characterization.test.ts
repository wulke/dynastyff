// @spec DFF-BOT-063
// @spec DFF-BOT-064
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import Database from 'better-sqlite3';

import { initializeDatabase } from '../../src/db/init.js';
import { loadArchetypeConfigFile } from '../../src/draft/archetype-config.js';
import { createBotChainCoordinator } from '../../src/draft/bot-chain.js';
import { createDraft } from '../../src/draft/service.js';
import { buildRealisticPlayerPool } from '../fixtures/realistic-player-pool.js';

type TeamArchetype = 'win_now' | 'punt' | 'rb_heavy' | 'qb_early' | 'bpa' | 'balanced';

const archetypes: TeamArchetype[] = ['rb_heavy', 'bpa', 'punt', 'win_now', 'qb_early', 'balanced'];

// @spec DFF-BOT-064
function withDatabase(run: (db: Database.Database, databasePath: string) => Promise<void>): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-bot-characterization-'));
  const databasePath = path.join(tempDir, 'test.sqlite');
  initializeDatabase(databasePath);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  return run(db, databasePath).finally(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
}

// @spec DFF-BOT-064
function seedRealisticPlayerPool(db: Database.Database): void {
  const insert = db.prepare(
    `INSERT INTO players (id, name, position, nfl_team, age, is_rookie, dynasty_value, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const player of buildRealisticPlayerPool()) {
    insert.run(
      player.id,
      player.name,
      player.position,
      player.nflTeam,
      player.age,
      Number(player.isRookie),
      player.dynastyValue,
      '2026-08-09T00:00:00.000Z',
    );
  }
}

// @spec DFF-BOT-064
function seededRandom(): () => number {
  let state = 147;

  return () => {
    state = (state * 48271) % 0x7fffffff;
    return state / 0x7fffffff;
  };
}

// @spec DFF-BOT-064
function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

// @spec DFF-BOT-064
test('[slow] full bot draft characterizes differentiated archetype rosters', async () => {
  await withDatabase(async (db, databasePath) => {
    seedRealisticPlayerPool(db);
    const draftId = createDraft({
      databasePath,
      config: {
        teamCount: 12,
        rounds: 20,
        scoringFormat: 'ppr',
        userPickPosition: 12,
        futurePickYears: 1,
        futurePickRounds: 1,
        rosterConfig: { QB: 2, RB: 4, WR: 5, TE: 2, FLEX: 2, SF: 1, bench: 4 },
      },
      now: () => '2026-08-09T00:00:00.000Z',
      random: seededRandom(),
    });

    const teams = db
      .prepare('SELECT id, pick_position FROM teams WHERE draft_id = ? ORDER BY pick_position')
      .all(draftId) as Array<{ id: string; pick_position: number }>;
    for (const team of teams) {
      db.prepare('UPDATE teams SET is_user = 0, archetype = ? WHERE id = ?').run(
        archetypes[(team.pick_position - 1) % archetypes.length]!,
        team.id,
      );
    }

    const archetypeConfig = loadArchetypeConfigFile();
    for (const profile of Object.values(archetypeConfig.archetypes)) {
      profile.tradeAggressivenessProbability = 0;
    }
    let sleepCalls = 0;
    const coordinator = createBotChainCoordinator({
      databasePath,
      archetypeConfig,
      pickDelayMs: 0,
      random: seededRandom(),
      now: () => '2026-08-09T00:00:00.000Z',
      sleep: async () => {
        sleepCalls += 1;
      },
    });

    const startedAt = performance.now();
    coordinator.trigger(draftId);
    await coordinator.waitForIdle(draftId);
    const elapsedMs = performance.now() - startedAt;

    const picks = db.prepare('SELECT COUNT(*) AS count FROM picks WHERE draft_id = ?').get(draftId) as { count: number };
    const rosterRows = db.prepare(
      `SELECT teams.archetype, players.position, players.age, players.dynasty_value, picks.pick_number
       FROM picks
       INNER JOIN teams ON teams.id = picks.team_id
       INNER JOIN players ON players.id = picks.player_id
       WHERE picks.draft_id = ?`,
    ).all(draftId) as Array<{
      archetype: TeamArchetype;
      position: 'QB' | 'RB' | 'WR' | 'TE';
      age: number;
      dynasty_value: number;
      pick_number: number;
    }>;
    const forArchetype = (archetype: TeamArchetype) => rosterRows.filter((row) => row.archetype === archetype);
    const rbShare = (archetype: TeamArchetype) => {
      const roster = forArchetype(archetype);
      return roster.filter((row) => row.position === 'RB').length / roster.length;
    };
    const firstQbPick = (archetype: TeamArchetype) =>
      Math.min(...forArchetype(archetype).filter((row) => row.position === 'QB').map((row) => row.pick_number));

    assert.equal(buildRealisticPlayerPool().length, 300);
    assert.equal(sleepCalls, 0);
    assert.ok(elapsedMs < 5000, `expected zero-delay simulation under 5 s; took ${elapsedMs.toFixed(0)} ms`);
    assert.equal(picks.count, 12 * 20);
    assert.ok(rbShare('rb_heavy') > rbShare('bpa'));
    assert.ok(average(forArchetype('punt').map((row) => row.age)) < average(forArchetype('win_now').map((row) => row.age)));
    assert.ok(firstQbPick('qb_early') < firstQbPick('balanced'));
    const averageValue = (archetype: TeamArchetype) => average(forArchetype(archetype).map((row) => row.dynasty_value));
    assert.ok(
      averageValue('bpa') > Math.max(...archetypes.filter((archetype) => archetype !== 'bpa').map(averageValue)),
    );
  });
});
