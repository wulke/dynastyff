import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import DatabaseConstructor from 'better-sqlite3';

import { initializeDatabase } from '../src/db/init.js';

export type SeasonFixture = {
  dbPath: string;
  db: Database.Database;
  cleanup: () => void;
};

export const seasonLeagueId = 'L1';
export const seasonSyncedAt = '2026-09-27T11:00:00.000Z';

type PlayerSeed = {
  id: string;
  name: string;
  position: string;
  age: number | null;
  value: number;
};

const fixturePlayers: PlayerSeed[] = [
  { id: 'p-qb1', name: 'Josh Allen', position: 'QB', age: 30, value: 6500 },
  { id: 'p-rb1', name: 'Bijan Robinson', position: 'RB', age: 24, value: 5200 },
  { id: 'p-wr1', name: 'Justin Jefferson', position: 'WR', age: 25, value: 6100 },
  { id: 'p-wr2', name: 'Chris Olave', position: 'WR', age: 24, value: 3400 },
  { id: 'p-te1', name: 'Travis Kelce', position: 'TE', age: 36, value: 1800 },
  { id: 'p-taxi', name: 'Trey Benson', position: 'RB', age: 23, value: 1100 },
  { id: 'p-ir', name: 'Kirk Cousins', position: 'QB', age: 37, value: 600 },
  { id: 'p2-qb', name: 'Jordan Love', position: 'QB', age: 26, value: 3800 },
  { id: 'p2-wr', name: 'DK Metcalf', position: 'WR', age: 28, value: 3300 },
  { id: 'p3-qb', name: 'Bryce Young', position: 'QB', age: 24, value: 2900 },
  { id: 'p4-te', name: 'Mark Andrews', position: 'TE', age: 30, value: 2600 },
  { id: 'p-fa1', name: 'Free Agent QB', position: 'QB', age: 28, value: 900 },
  { id: 'p-fa2', name: 'Free Agent WR', position: 'WR', age: 23, value: 400 },
];

type RosterSeed = {
  id: string;
  rosterId: number;
  sleeperPlayerId: string;
  playersId: string | null;
  slotType: string;
};

const fixtureRosters: RosterSeed[] = [
  { id: 'r-1-1', rosterId: 1, sleeperPlayerId: 's-qb1', playersId: 'p-qb1', slotType: 'starter' },
  { id: 'r-1-2', rosterId: 1, sleeperPlayerId: 's-rb1', playersId: 'p-rb1', slotType: 'starter' },
  { id: 'r-1-3', rosterId: 1, sleeperPlayerId: 's-wr1', playersId: 'p-wr1', slotType: 'starter' },
  { id: 'r-1-4', rosterId: 1, sleeperPlayerId: 's-wr2', playersId: 'p-wr2', slotType: 'bench' },
  { id: 'r-1-5', rosterId: 1, sleeperPlayerId: 's-te1', playersId: 'p-te1', slotType: 'starter' },
  { id: 'r-1-6', rosterId: 1, sleeperPlayerId: 's-taxi', playersId: 'p-taxi', slotType: 'taxi' },
  { id: 'r-1-7', rosterId: 1, sleeperPlayerId: 's-ir', playersId: 'p-ir', slotType: 'ir' },
  { id: 'r-1-8', rosterId: 1, sleeperPlayerId: 's-unmatched', playersId: null, slotType: 'bench' },
  { id: 'r-2-1', rosterId: 2, sleeperPlayerId: 's-p2-qb', playersId: 'p2-qb', slotType: 'starter' },
  { id: 'r-2-2', rosterId: 2, sleeperPlayerId: 's-p2-wr', playersId: 'p2-wr', slotType: 'starter' },
  { id: 'r-3-1', rosterId: 3, sleeperPlayerId: 's-p3-qb', playersId: 'p3-qb', slotType: 'starter' },
  { id: 'r-4-1', rosterId: 4, sleeperPlayerId: 's-p4-te', playersId: 'p4-te', slotType: 'starter' },
];

export function createSeasonFixture(options: { teamCount?: number; withConnection?: boolean } = {}): SeasonFixture {
  const { teamCount = 4, withConnection = true } = options;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynastyff-season-'));
  const dbPath = path.join(tempDir, 'test.sqlite');
  initializeDatabase(dbPath);

  const db = new DatabaseConstructor(dbPath);
  db.pragma('foreign_keys = ON');

  const insertPlayer = db.prepare(
    'INSERT INTO players (id, name, position, age, is_rookie, dynasty_value, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
  );
  for (const player of fixturePlayers) {
    insertPlayer.run(player.id, player.name, player.position, player.age, player.value, seasonSyncedAt);
  }

  db.prepare(
    "INSERT INTO sleeper_player_map (sleeper_player_id, players_id, sleeper_name, sleeper_position, matched_at) VALUES ('s-unmatched', NULL, 'Rookie Unknown', 'QB', ?)",
  ).run(seasonSyncedAt);

  db.prepare(
    'INSERT INTO sleeper_leagues (league_id, name, season, scoring_settings, roster_positions, total_rosters, status, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    seasonLeagueId,
    'Season Fixture League',
    '2026',
    JSON.stringify({ pass_td: 4 }),
    JSON.stringify(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN']),
    4,
    'in_season',
    seasonSyncedAt,
  );

  const insertTeam = db.prepare(
    'INSERT INTO sleeper_teams (id, league_id, roster_id, owner_id, display_name, team_name, wins, losses, ties, points_for, points_against) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const records = [
    { rosterId: 1, display: 'Trev', wins: 10, losses: 2 },
    { rosterId: 2, display: 'Rival', wins: 7, losses: 5 },
    { rosterId: 3, display: 'Middle', wins: 5, losses: 7 },
    { rosterId: 4, display: 'Basement', wins: 2, losses: 10 },
  ];
  for (const team of records.slice(0, teamCount)) {
    insertTeam.run(
      `t-${team.rosterId}`,
      seasonLeagueId,
      team.rosterId,
      `u-${team.rosterId}`,
      team.display,
      `${team.display} Squad`,
      team.wins,
      team.losses,
      0,
      1500.5,
      1200.25,
    );
  }

  const insertRoster = db.prepare(
    'INSERT INTO sleeper_rosters (id, league_id, roster_id, sleeper_player_id, players_id, slot_type, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const entry of fixtureRosters.filter((row) => row.rosterId <= teamCount)) {
    insertRoster.run(
      entry.id,
      seasonLeagueId,
      entry.rosterId,
      entry.sleeperPlayerId,
      entry.playersId,
      entry.slotType,
      seasonSyncedAt,
    );
  }

  if (withConnection) {
    db.prepare(
      'INSERT INTO sleeper_connections (id, league_id, league_name, season, user_id, roster_id, connected_at, last_synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('c1', seasonLeagueId, 'Season Fixture League', '2026', 'u1', 1, '2026-09-20T10:00:00.000Z', '2026-09-27T11:30:00.000Z');
  }

  db.prepare(
    "INSERT INTO sleeper_trade_offers (id, league_id, transaction_id, status, proposer_roster_id, responder_roster_ids, adds, drops, draft_picks, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    't1',
    seasonLeagueId,
    555,
    2,
    JSON.stringify([1]),
    JSON.stringify({ 's-p2-qb': 1 }),
    JSON.stringify({ 's-wr2': 1 }),
    JSON.stringify([]),
    '2026-09-26T18:00:00.000Z',
    '2026-09-26T18:00:00.000Z',
  );

  db.prepare(
    "INSERT INTO sleeper_trade_offers (id, league_id, transaction_id, status, proposer_roster_id, responder_roster_ids, adds, drops, draft_picks, created_at, updated_at) VALUES (?, ?, ?, 'complete', ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    't2',
    seasonLeagueId,
    556,
    3,
    JSON.stringify([4]),
    JSON.stringify({}),
    JSON.stringify({}),
    JSON.stringify([]),
    '2026-09-25T18:00:00.000Z',
    '2026-09-25T18:00:00.000Z',
  );

  return { dbPath, db, cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }) };
}
