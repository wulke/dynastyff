import type Database from 'better-sqlite3';

import { loadAliasFamilies, matchPlayerCandidate, type AliasFamily, type PlayerMatchCandidate } from '../player-matching.js';
import type { PlayerRegistry, SyncLogger } from './types.js';

type PlayerMapRow = {
  sleeper_player_id: string;
  players_id: string | null;
  sleeper_name: string;
  sleeper_position: string;
};

// @spec DFF-SLS-040
// @spec DFF-SLS-041
// @spec DFF-SLS-042
// @spec DFF-SLS-043
// Resolves Sleeper player IDs to canonical players.id values. Successful
// matches are persisted to sleeper_player_map and reused across runs;
// unmatched players re-attempt on the next sync (so ETL additions match
// automatically) and are warned about once per run via the in-memory cache.
export function createSleeperPlayerMatcher(
  sqlite: Database.Database,
  aliasFamilies: AliasFamily[],
  logger?: SyncLogger,
) {
  const persisted = sqlite
    .prepare('SELECT sleeper_player_id, players_id FROM sleeper_player_map')
    .all() as Array<Pick<PlayerMapRow, 'sleeper_player_id' | 'players_id'>>;

  const known = new Map<string, string | null>(
    persisted.map((row) => [row.sleeper_player_id, row.players_id]),
  );

  const insertMapping = sqlite.prepare(
    `INSERT INTO sleeper_player_map (sleeper_player_id, players_id, sleeper_name, sleeper_position, matched_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(sleeper_player_id) DO UPDATE SET
       players_id = excluded.players_id,
       sleeper_name = excluded.sleeper_name,
       sleeper_position = excluded.sleeper_position,
       matched_at = excluded.matched_at`,
  );

  const candidateRows = sqlite
    .prepare(
      `SELECT id, name, position, nfl_team, age, is_rookie, adp,
              value_ktc, value_fantasycalc, value_dynastydaddy, value_rosteraudit
       FROM players`,
    )
    .all() as unknown as PlayerMatchCandidate[];

  const candidatesByPosition = new Map<string, PlayerMatchCandidate[]>();

  for (const candidate of candidateRows) {
    const bucket = candidatesByPosition.get(candidate.position) ?? [];
    bucket.push(candidate);
    candidatesByPosition.set(candidate.position, bucket);
  }

  return function matchSleeperPlayer(
    sleeperPlayerId: string,
    registry: PlayerRegistry,
    matchedAt: string,
  ): string | null {
    const cached = known.get(sleeperPlayerId);

    if (cached !== undefined) {
      return cached;
    }

    const entry = registry[sleeperPlayerId];

    if (!entry) {
      logger?.warn(
        `[Sleeper] WARN: player ${sleeperPlayerId} missing from the Sleeper registry. Storing with players_id = NULL.`,
      );
      known.set(sleeperPlayerId, null);
      return null;
    }

    const matched = matchPlayerCandidate(
      entry.fullName,
      candidatesByPosition.get(entry.position) ?? [],
      aliasFamilies,
    );

    if (!matched) {
      logger?.warn(
        `[Sleeper] WARN: player '${entry.fullName}' (${entry.position}) could not be matched to a canonical player. Storing with players_id = NULL.`,
      );
      known.set(sleeperPlayerId, null);
      return null;
    }

    insertMapping.run(sleeperPlayerId, matched.id, entry.fullName, entry.position, matchedAt);
    known.set(sleeperPlayerId, matched.id);

    return matched.id;
  }
}

export function loadSleeperAliasFamilies(aliasesPath: string): AliasFamily[] {
  return loadAliasFamilies(aliasesPath);
}
