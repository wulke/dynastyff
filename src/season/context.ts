// @spec DFF-SM-070
// @spec DFF-SM-071
// @spec DFF-SM-080
// @spec DFF-SM-083
import type Database from 'better-sqlite3';

import { createDatabase } from '../db/client.js';

export type RosterSlotType = 'starter' | 'bench' | 'ir' | 'taxi';

export type RosterEntry = {
  sleeperPlayerId: string;
  playersId: string | null;
  name: string;
  position: string;
  age: number | null;
  dynastyValue: number;
  slotType: RosterSlotType;
  matched: boolean;
};

export type TeamRoster = {
  rosterId: number;
  displayName: string;
  teamName: string | null;
  wins: number;
  losses: number;
  ties: number;
  players: RosterEntry[];
};

export type PlayerWithValue = {
  id: string;
  name: string;
  position: string;
  age: number | null;
  dynastyValue: number;
};

export type SleeperTradeOfferRecord = {
  transactionId: number;
  status: string;
  proposerRosterId: number;
  responderRosterIds: number[];
  adds: Record<string, number>;
  drops: Record<string, number>;
  draftPicks: unknown[];
  createdAt: string;
};

export type LeagueInfo = {
  leagueId: string;
  name: string;
  season: string;
  totalRosters: number;
  status: string;
  rosterPositions: string[];
  scoringSettings: Record<string, unknown>;
  syncedAt: string;
};

export type LeagueContext = {
  league: LeagueInfo;
  userRosterId: number;
  userRoster: RosterEntry[];
  allRosters: TeamRoster[];
  freeAgents: PlayerWithValue[];
  pendingOffers: SleeperTradeOfferRecord[];
  leagueMedians: Record<string, number>;
  lastSyncedAt: string | null;
};

export type LeagueContextErrorCode = 'NOT_FOUND' | 'NOT_CONNECTED' | 'INSUFFICIENT_DATA';

export class LeagueContextError extends Error {
  readonly code: LeagueContextErrorCode;
  readonly statusCode: number;

  constructor(code: LeagueContextErrorCode, message: string) {
    super(message);
    this.code = code;
    this.statusCode = code === 'INSUFFICIENT_DATA' ? 422 : 404;
  }
}

const corePositions = ['QB', 'RB', 'WR', 'TE'] as const;

type SleeperRosterRow = {
  roster_id: number;
  sleeper_player_id: string;
  players_id: string | null;
  slot_type: string;
};

type PlayerRow = {
  id: string;
  name: string;
  position: string;
  age: number | null;
  dynasty_value: number;
};

type PlayerMapRow = {
  sleeper_player_id: string;
  sleeper_name: string;
  sleeper_position: string;
};

function parseJsonRecord(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function toSlotType(raw: string): RosterSlotType {
  return raw === 'bench' || raw === 'ir' || raw === 'taxi' ? raw : 'starter';
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function loadRosterEntries(sqlite: Database.Database, leagueId: string): Map<number, RosterEntry[]> {
  const playerMapRows = sqlite
    .prepare('SELECT sleeper_player_id, sleeper_name, sleeper_position FROM sleeper_player_map')
    .all() as PlayerMapRow[];
  const playerMap = new Map(playerMapRows.map((row) => [row.sleeper_player_id, row]));

  const rosterRows = sqlite
    .prepare(
      'SELECT roster_id, sleeper_player_id, players_id, slot_type FROM sleeper_rosters WHERE league_id = ? ORDER BY roster_id, slot_type, sleeper_player_id',
    )
    .all(leagueId) as SleeperRosterRow[];

  const matchedIds = rosterRows
    .map((row) => row.players_id)
    .filter((id): id is string => id !== null);

  const playerRows = matchedIds.length
    ? (sqlite
        .prepare(`SELECT id, name, position, age, dynasty_value FROM players WHERE id IN (${matchedIds.map(() => '?').join(',')})`)
        .all(...matchedIds) as PlayerRow[])
    : [];
  const players = new Map(playerRows.map((row) => [row.id, row]));

  const entries = new Map<number, RosterEntry[]>();

  for (const row of rosterRows) {
    const player = row.players_id !== null ? players.get(row.players_id) : undefined;

    if (player) {
      const entry: RosterEntry = {
        sleeperPlayerId: row.sleeper_player_id,
        playersId: row.players_id,
        name: player.name,
        position: player.position,
        age: player.age,
        dynastyValue: player.dynasty_value,
        slotType: toSlotType(row.slot_type),
        matched: true,
      };
      pushEntry(entries, row.roster_id, entry);
      continue;
    }

    // @spec DFF-SM-080 — unmatched players keep Sleeper metadata and score 0.
    const sleeperMeta = playerMap.get(row.sleeper_player_id);
    const entry: RosterEntry = {
      sleeperPlayerId: row.sleeper_player_id,
      playersId: null,
      name: sleeperMeta?.sleeper_name ?? row.sleeper_player_id,
      position: sleeperMeta?.sleeper_position ?? 'UNK',
      age: null,
      dynastyValue: 0,
      slotType: toSlotType(row.slot_type),
      matched: false,
    };
    pushEntry(entries, row.roster_id, entry);
  }

  return entries;
}

function pushEntry(entries: Map<number, RosterEntry[]>, rosterId: number, entry: RosterEntry): void {
  const existing = entries.get(rosterId);
  if (existing) {
    existing.push(entry);
  } else {
    entries.set(rosterId, [entry]);
  }
}

function loadPendingOffers(sqlite: Database.Database, leagueId: string): SleeperTradeOfferRecord[] {
  // TODO(DFF-SM-030): these are all pending offers in the league. The trades/pending route must
  // scope this to offers involving the user's roster (proposer or responder) when the Trade
  // Scorer slice consumes this field; the league-wide list is kept as shared ground truth.
  const rows = sqlite
    .prepare(
      "SELECT transaction_id, proposer_roster_id, responder_roster_ids, adds, drops, draft_picks, created_at FROM sleeper_trade_offers WHERE league_id = ? AND status = 'pending' ORDER BY created_at DESC",
    )
    .all(leagueId) as {
    transaction_id: number;
    proposer_roster_id: number;
    responder_roster_ids: string;
    adds: string;
    drops: string;
    draft_picks: string;
    created_at: string;
  }[];

  return rows.map((row) => ({
    transactionId: row.transaction_id,
    status: 'pending',
    proposerRosterId: row.proposer_roster_id,
    responderRosterIds: parseResponderIds(row.responder_roster_ids),
    adds: parseIdToRosterMap(row.adds),
    drops: parseIdToRosterMap(row.drops),
    draftPicks: parseDraftPicks(row.draft_picks),
    createdAt: row.created_at,
  }));
}

function parseResponderIds(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is number => typeof entry === 'number')
      : [];
  } catch {
    return [];
  }
}

function parseIdToRosterMap(raw: string): Record<string, number> {
  const record = parseJsonRecord(raw);
  const map: Record<string, number> = {};

  for (const [playerId, rosterId] of Object.entries(record)) {
    if (typeof rosterId === 'number') {
      map[playerId] = rosterId;
    }
  }

  return map;
}

function parseDraftPicks(raw: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadFreeAgents(sqlite: Database.Database, leagueId: string): PlayerWithValue[] {
  const rows = sqlite
    .prepare(
      `SELECT id, name, position, age, dynasty_value FROM players
       WHERE dynasty_value > 0
         AND id NOT IN (SELECT players_id FROM sleeper_rosters WHERE league_id = ? AND players_id IS NOT NULL)
       ORDER BY dynasty_value DESC`,
    )
    .all(leagueId) as PlayerRow[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    position: row.position,
    age: row.age,
    dynastyValue: row.dynasty_value,
  }));
}

// Median positional dynasty value across all teams' rosters. Taxi counts toward the total;
// IR is excluded (DFF-SM-084). Shared by context assembly and the Roster Evaluator so there is
// a single source of truth for league-median numbers.
// @spec DFF-SM-084
export function leagueMedianPositionalValue(allRosters: TeamRoster[], position: string): number {
  const teamTotals = allRosters.map((team) =>
    team.players
      .filter(
        (entry) =>
          entry.position === position &&
          (entry.slotType === 'starter' || entry.slotType === 'bench' || entry.slotType === 'taxi'),
      )
      .reduce((sum, entry) => sum + entry.dynastyValue, 0),
  );

  return median(teamTotals);
}

function computeLeagueMedians(allRosters: TeamRoster[]): Record<string, number> {
  const medians: Record<string, number> = {};

  for (const position of corePositions) {
    medians[position] = leagueMedianPositionalValue(allRosters, position);
  }

  return medians;
}

// @spec DFF-SM-070
// @spec DFF-SM-071 — assembled fresh from SQLite on every call; no caching between requests.
export function assembleLeagueContext(databasePath: string | undefined, leagueId: string): LeagueContext;
export function assembleLeagueContext(sqlite: Database.Database, leagueId: string): LeagueContext;
export function assembleLeagueContext(
  source: Database.Database | string | undefined,
  leagueId: string,
): LeagueContext {
  const sqlite = typeof source === 'string' || source === undefined ? createDatabase(source) : source;

  const leagueRow = sqlite
    .prepare(
      'SELECT league_id, name, season, total_rosters, status, roster_positions, scoring_settings, synced_at FROM sleeper_leagues WHERE league_id = ?',
    )
    .get(leagueId) as
    | {
        league_id: string;
        name: string;
        season: string;
        total_rosters: number;
        status: string;
        roster_positions: string;
        scoring_settings: string;
        synced_at: string;
      }
    | undefined;

  if (!leagueRow) {
    throw new LeagueContextError('NOT_FOUND', `League ${leagueId} has not been synced.`);
  }

  const connection = sqlite
    .prepare('SELECT roster_id, last_synced_at FROM sleeper_connections WHERE league_id = ?')
    .get(leagueId) as { roster_id: number; last_synced_at: string | null } | undefined;

  if (!connection) {
    throw new LeagueContextError('NOT_CONNECTED', `League ${leagueId} is not connected to a user roster.`);
  }

  const teamRows = sqlite
    .prepare(
      'SELECT roster_id, display_name, team_name, wins, losses, ties FROM sleeper_teams WHERE league_id = ? ORDER BY roster_id',
    )
    .all(leagueId) as {
    roster_id: number;
    display_name: string | null;
    team_name: string | null;
    wins: number;
    losses: number;
    ties: number;
  }[];

  // @spec DFF-SM-083 — fewer than 4 teams with data is insufficient for evaluation.
  if (teamRows.length < 4) {
    throw new LeagueContextError(
      'INSUFFICIENT_DATA',
      `League ${leagueId} has only ${teamRows.length} team(s) synced; at least 4 are required for evaluation.`,
    );
  }

  const rosterEntries = loadRosterEntries(sqlite, leagueId);

  const allRosters: TeamRoster[] = teamRows.map((team) => ({
    rosterId: team.roster_id,
    displayName: team.display_name ?? `Team ${team.roster_id}`,
    teamName: team.team_name,
    wins: team.wins,
    losses: team.losses,
    ties: team.ties,
    players: rosterEntries.get(team.roster_id) ?? [],
  }));

  const userTeam = allRosters.find((team) => team.rosterId === connection.roster_id);

  return {
    league: {
      leagueId: leagueRow.league_id,
      name: leagueRow.name,
      season: leagueRow.season,
      totalRosters: leagueRow.total_rosters,
      status: leagueRow.status,
      rosterPositions: parseStringArray(leagueRow.roster_positions),
      scoringSettings: parseJsonRecord(leagueRow.scoring_settings),
      syncedAt: leagueRow.synced_at,
    },
    userRosterId: connection.roster_id,
    userRoster: userTeam?.players ?? [],
    allRosters,
    freeAgents: loadFreeAgents(sqlite, leagueId),
    pendingOffers: loadPendingOffers(sqlite, leagueId),
    leagueMedians: computeLeagueMedians(allRosters),
    lastSyncedAt: connection.last_synced_at ?? leagueRow.synced_at,
  };
}
