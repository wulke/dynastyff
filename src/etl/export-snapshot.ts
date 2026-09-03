// @spec DFF-STATIC-010
// @spec DFF-STATIC-011
// @spec DFF-STATIC-012
import fs from 'node:fs';
import path from 'node:path';

import type Database from 'better-sqlite3';

import { createDatabase } from '../db/client.js';
import { resolveDatabasePath } from '../db/init.js';

export type SnapshotPlayer = {
  id: string;
  name: string;
  position: 'QB' | 'RB' | 'WR' | 'TE';
  nflTeam: string | null;
  age: number | null;
  isRookie: boolean;
  dynastyValue: number;
  adp: number | null;
};

export type SnapshotPickValue = {
  year: number;
  round: number;
  dynastyValue: number;
};

// @spec DFF-DEVY-030
export type SnapshotDevyPlayer = {
  id: string;
  name: string;
  position: 'QB' | 'RB' | 'WR' | 'TE';
  school: string | null;
  schoolCode: string | null;
  draftYear: number;
  valueSuperflex: number;
  valueOneQb: number | null;
};

export type Snapshot = {
  exportedAt: string;
  players: SnapshotPlayer[];
  pickValues: SnapshotPickValue[];
  devyPlayers?: SnapshotDevyPlayer[];
};

type PlayerRow = SnapshotPlayer;
type PickValueRow = SnapshotPickValue;
type DevyPlayerRow = SnapshotDevyPlayer;

const defaultSnapshotPath = path.resolve(process.cwd(), 'data', 'snapshot.json');

// @spec DFF-STATIC-010
export function resolveSnapshotPath(inputPath = process.env.DYNASTYFF_SNAPSHOT_PATH): string {
  return inputPath ? path.resolve(process.cwd(), inputPath) : defaultSnapshotPath;
}

// @spec DFF-STATIC-012
function isMissingPlayersTableError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'SQLITE_ERROR' &&
    error.message.includes('no such table: players')
  );
}

// @spec DFF-STATIC-011
function loadPlayers(sqlite: Database.Database): SnapshotPlayer[] {
  const rows = sqlite
    .prepare(
      `SELECT
         id,
         name,
         position,
         nfl_team AS nflTeam,
         age,
         is_rookie AS isRookie,
         dynasty_value AS dynastyValue,
         adp
       FROM players
       ORDER BY dynasty_value DESC, name ASC`,
    )
    .all() as PlayerRow[];

  return rows.map((row) => ({
    ...row,
    isRookie: Boolean(row.isRookie),
  }));
}

// @spec DFF-STATIC-011
// @spec DFF-SPKV-015
function loadPickValues(sqlite: Database.Database): SnapshotPickValue[] {
  return sqlite
    .prepare(
      `SELECT
         year,
         round,
         dynasty_value AS dynastyValue
       FROM pick_values
       WHERE pick_in_round = 0
       ORDER BY year ASC, round ASC`,
    )
    .all() as PickValueRow[];
}

// @spec DFF-DEVY-030
function loadDevyPlayers(sqlite: Database.Database): SnapshotDevyPlayer[] {
  return sqlite.prepare(`SELECT id, name, position, school, school_code AS schoolCode, draft_year AS draftYear, value_superflex AS valueSuperflex, value_one_qb AS valueOneQb FROM devy_players ORDER BY value_superflex DESC, name ASC`).all() as DevyPlayerRow[];
}

// @spec DFF-STATIC-011
export function buildSnapshot(sqlite: Database.Database, now = () => new Date().toISOString()): Snapshot {
  return {
    exportedAt: now(),
    players: loadPlayers(sqlite),
    pickValues: loadPickValues(sqlite),
    devyPlayers: loadDevyPlayers(sqlite),
  };
}

// @spec DFF-STATIC-010
function writeSnapshot(snapshotPath: string, snapshot: Snapshot): void {
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
}

// @spec DFF-STATIC-010
// @spec DFF-STATIC-011
// @spec DFF-STATIC-012
export function exportSnapshot(options?: {
  databasePath?: string;
  snapshotPath?: string;
  now?: () => string;
}): Snapshot {
  const databasePath = options?.databasePath ?? resolveDatabasePath();
  const snapshotPath = options?.snapshotPath ?? resolveSnapshotPath();

  if (!fs.existsSync(databasePath)) {
    throw new Error(
      `[export:snapshot] Database file not found at ${databasePath}. Run \`npm run etl\` first.`,
    );
  }

  const sqlite = createDatabase(databasePath);

  try {
    const snapshot = buildSnapshot(sqlite, options?.now);

    if (snapshot.players.length === 0) {
      throw new Error('[export:snapshot] No players found. Run `npm run etl` first.');
    }

    writeSnapshot(snapshotPath, snapshot);
    return snapshot;
  } catch (error) {
    if (isMissingPlayersTableError(error)) {
      throw new Error('[export:snapshot] No players found. Run `npm run etl` first.');
    }

    throw error;
  } finally {
    sqlite.close();
  }
}

// @spec DFF-STATIC-010
// @spec DFF-STATIC-012
function main(): void {
  try {
    const snapshot = exportSnapshot();
    console.log(
      `[export:snapshot] wrote ${snapshot.players.length} players and ${snapshot.pickValues.length} pick values to ${resolveSnapshotPath()}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
