// @spec DFF-HIST-062
import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import { createDrizzleDb } from '../db/client.js';
import { drafts, picks, playerValueSnapshots, players } from '../db/schema.js';
import { createNormalizationContext, normalizeRawValue } from '../etl/normalize.js';

export type DraftAvailablePlayer = {
  id: string;
  name: string;
  position: string;
  nfl_team: string | null;
  age: number | null;
  is_rookie: boolean;
  dynasty_value: number;
  adp: number | null;
};

// @spec DFF-HIST-062
export function getDraftedPlayersForDraft({
  databasePath,
  draftId,
}: {
  databasePath: string;
  draftId: string;
}): DraftAvailablePlayer[] {
  const { sqlite, db } = createDrizzleDb(databasePath);

  try {
    return db
      .select({
        id: players.id,
        name: players.name,
        position: players.position,
        nfl_team: players.nflTeam,
        age: players.age,
        is_rookie: players.isRookie,
        dynasty_value: players.dynastyValue,
        adp: players.adp,
      })
      .from(players)
      .innerJoin(picks, and(eq(players.id, picks.playerId), eq(picks.draftId, draftId)))
      .orderBy(asc(picks.pickNumber))
      .all() as DraftAvailablePlayer[];
  } finally {
    sqlite.close();
  }
}

// @spec DFF-HIST-062
export function getAvailablePlayersForDraft({
  databasePath,
  draftId,
}: {
  databasePath: string;
  draftId: string;
}): DraftAvailablePlayer[] {
  const { sqlite, db } = createDrizzleDb(databasePath);

  try {
    const draft = db
      .select({
        etl_run_id: drafts.etlRunId,
      })
      .from(drafts)
      .where(eq(drafts.id, draftId))
      .get() as { etl_run_id: string | null } | undefined;

    if (!draft) {
      return [];
    }

    if (draft.etl_run_id === null) {
      return db
        .select({
          id: players.id,
          name: players.name,
          position: players.position,
          nfl_team: players.nflTeam,
          age: players.age,
          is_rookie: players.isRookie,
          dynasty_value: players.dynastyValue,
          adp: players.adp,
        })
        .from(players)
        .leftJoin(picks, and(eq(players.id, picks.playerId), eq(picks.draftId, draftId)))
        .where(isNull(picks.id))
        .orderBy(desc(players.dynastyValue), asc(players.name))
        .all() as DraftAvailablePlayer[];
    }

    const snapshotRows = db
      .select({
        player_id: playerValueSnapshots.playerId,
        source: playerValueSnapshots.source,
        raw_value: playerValueSnapshots.rawValue,
      })
      .from(playerValueSnapshots)
      .where(eq(playerValueSnapshots.runId, draft.etl_run_id))
      .all() as Array<{
      player_id: string;
      source: string;
      raw_value: number;
    }>;

    const normalizationContexts = new Map(
      Array.from(
        snapshotRows.reduce((rowsBySource, snapshot) => {
          const rows = rowsBySource.get(snapshot.source) ?? [];
          rows.push({ rawValue: snapshot.raw_value });
          rowsBySource.set(snapshot.source, rows);
          return rowsBySource;
        }, new Map<string, Array<{ rawValue: number }>>()),
      ).flatMap(([source, rows]) => {
        const context = createNormalizationContext(rows);
        return context ? [[source, context] as const] : [];
      }),
    );

    const availableSnapshotRows = db
      .select({
        id: players.id,
        name: players.name,
        position: players.position,
        nfl_team: players.nflTeam,
        age: players.age,
        is_rookie: players.isRookie,
        adp: players.adp,
        source: playerValueSnapshots.source,
        raw_value: playerValueSnapshots.rawValue,
      })
      .from(playerValueSnapshots)
      .innerJoin(players, eq(playerValueSnapshots.playerId, players.id))
      .leftJoin(picks, and(eq(players.id, picks.playerId), eq(picks.draftId, draftId)))
      .where(and(eq(playerValueSnapshots.runId, draft.etl_run_id), isNull(picks.id)))
      .all() as Array<{
      id: string;
      name: string;
      position: string;
      nfl_team: string | null;
      age: number | null;
      is_rookie: boolean;
      adp: number | null;
      source: string;
      raw_value: number;
    }>;

    const playersById = new Map<string, DraftAvailablePlayer>();
    const valuesByPlayerId = new Map<string, number[]>();

    for (const row of availableSnapshotRows) {
      if (!playersById.has(row.id)) {
        playersById.set(row.id, {
          id: row.id,
          name: row.name,
          position: row.position,
          nfl_team: row.nfl_team,
          age: row.age,
          is_rookie: row.is_rookie,
          dynasty_value: 0,
          adp: row.adp,
        });
      }

      const context = normalizationContexts.get(row.source);

      if (!context) {
        continue;
      }

      const normalizedValues = valuesByPlayerId.get(row.id) ?? [];
      normalizedValues.push(normalizeRawValue(row.raw_value, context));
      valuesByPlayerId.set(row.id, normalizedValues);
    }

    return Array.from(playersById.values())
      .map((player) => {
        const normalizedValues = valuesByPlayerId.get(player.id) ?? [];

        return {
          ...player,
          dynasty_value:
            normalizedValues.length === 0
              ? 0
              : Math.round(
                  normalizedValues.reduce((sum, value) => sum + value, 0) / normalizedValues.length,
                ),
        };
      })
      .sort(
        (left, right) =>
          right.dynasty_value - left.dynasty_value || left.name.localeCompare(right.name),
      );
  } finally {
    sqlite.close();
  }
}
