// @spec DFF-DVC-003
// @spec DFF-DVC-004
// @spec DFF-DVC-006
// @spec DFF-DVC-007
// @spec DFF-DVC-012
import Database from 'better-sqlite3';

import { resolveDatabasePath } from '../db/path.js';
import { loadAliasFamilies, normalizePlayerName, type AliasFamily } from '../etl/player-matching.js';

export type DevyMatch = {
  matched: boolean;
  position: string | null;
  school: string | null;
  draftYear: number | null;
  dynastyValue: number | null;
};

export type DevyClaimView = {
  rosterId: number;
  // @spec DFF-DVC-012 — taxi placeholder id; unique per claim even when names repeat.
  sleeperPlayerId: string;
  teamName: string;
  devyName: string;
  devyMatch: DevyMatch;
};

export type DevyAvailableView = {
  name: string;
  position: string;
  school: string | null;
  draftYear: number;
  dynastyValue: number;
};

type DevyBoardRow = {
  id: string;
  name: string;
  position: string;
  school: string | null;
  draft_year: number;
  value_superflex: number;
};

const noMatch: DevyMatch = {
  matched: false,
  position: null,
  school: null,
  draftYear: null,
  dynastyValue: null,
};

export type DevyOwnershipClaim = { devyName: string; teamName: string };

export type DevyBoardMatcher = {
  /** Resolve a devy claim name against the local KTC devy board. */
  match: (devyName: string) => DevyMatch;
  /** Board rows whose normalized name is not in `claimedNames`, ranked by value. */
  availableExcluding: (claimedNames: ReadonlySet<string>) => DevyAvailableView[];
  /** Alias-resolved normalized names for the given devy claim names, for exclusion checks. */
  claimedNorms: (devyNames: Iterable<string>) => Set<string>;
  /** devy_players.id -> owning team name for every board row claimed in the league.
   * Claims matching no board row are skipped; duplicate claims resolve to the
   * lexicographically first team name. */
  resolveOwnership: (claims: Iterable<DevyOwnershipClaim>) => Record<string, string>;
};

// Devy claim names come from free-text commissioner nicknames, so normalize beyond the
// shared NFL normalization: quote variants (' ’ ‘ `) are stripped entirely.
function normalizeDevyName(name: string): string {
  return normalizePlayerName(name.replace(/['’‘`]/g, ''));
}

export function createDevyBoardMatcher(
  databasePath: string | undefined,
  aliasesPath: string,
): DevyBoardMatcher {
  let aliasFamilies: AliasFamily[] = [];

  try {
    aliasFamilies = loadAliasFamilies(aliasesPath);
  } catch {
    aliasFamilies = [];
  }

  // variant/canonical normalized name -> canonical normalized name
  const canonicalByNorm = new Map<string, string>();
  for (const family of aliasFamilies) {
    const canonical = normalizeDevyName(family.canonical);
    for (const norm of family.normalizedNames) {
      canonicalByNorm.set(normalizeDevyName(norm), canonical);
    }
  }

  const resolveNorm = (devyName: string): string => {
    const normalized = normalizeDevyName(devyName);

    return canonicalByNorm.get(normalized) ?? normalized;
  };

  const sqlite = new Database(resolveDatabasePath(databasePath), { readonly: true, fileMustExist: true });

  try {
    const board = sqlite
      .prepare('SELECT id, name, position, school, draft_year, value_superflex FROM devy_players')
      .all() as DevyBoardRow[];

    // Key the board through resolveNorm so a board row stored under a non-canonical
    // alias still matches the canonical claim name (and vice versa).
    const boardByNorm = new Map<string, DevyBoardRow>(
      board.map((row) => [resolveNorm(row.name), row]),
    );

    const rowToMatch = (row: DevyBoardRow | undefined): DevyMatch =>
      row
        ? {
            matched: true,
            position: row.position,
            school: row.school,
            draftYear: row.draft_year,
            dynastyValue: row.value_superflex,
          }
        : noMatch;

    return {
      match: (devyName: string) => rowToMatch(boardByNorm.get(resolveNorm(devyName))),

      claimedNorms: (devyNames: Iterable<string>) =>
        new Set(Array.from(devyNames, resolveNorm)),

      resolveOwnership: (claims: Iterable<DevyOwnershipClaim>) => {
        const ownership: Record<string, string> = {};

        for (const claim of claims) {
          const row = boardByNorm.get(resolveNorm(claim.devyName));

          if (!row) {
            continue;
          }

          const current = ownership[row.id];

          if (current === undefined || claim.teamName.localeCompare(current) < 0) {
            ownership[row.id] = claim.teamName;
          }
        }

        return ownership;
      },

      availableExcluding: (claimedNames: ReadonlySet<string>) =>
        board
          .filter((row) => !claimedNames.has(resolveNorm(row.name)))
          .sort((left, right) => right.value_superflex - left.value_superflex)
          .map((row) => ({
            name: row.name,
            position: row.position,
            school: row.school,
            draftYear: row.draft_year,
            dynastyValue: row.value_superflex,
          })),
    };
  } finally {
    sqlite.close();
  }
}
