// @spec DFF-ETL-020
// @spec DFF-ETL-021
// @spec DFF-ETL-022
// @spec DFF-ETL-023
// @spec DFF-ETL-024
// @spec DFF-ETL-040
// @spec DFF-ETL-080
// @spec DFF-ETL-081
import fs from 'node:fs';

import type { EtlSource, SupportedEtlPosition } from './types.js';

type AliasEntry = {
  canonical: string;
  variants: string[];
};

type AliasFile = {
  aliases?: AliasEntry[];
};

export type AliasFamily = {
  canonical: string;
  normalizedNames: Set<string>;
};

export type PlayerMatchCandidate = {
  id: string;
  name: string;
  position: SupportedEtlPosition;
  nflTeam: string;
  age: number | null;
  isRookie: number;
  adp: number | null;
  valueKtc: number | null;
  valueFantasycalc: number | null;
  valueDynastydaddy: number | null;
  valueRosteraudit: number | null;
};

const fuzzyMatchThreshold = 0.85;

// @spec DFF-ETL-080
// @spec DFF-ETL-081
export function loadAliasFamilies(aliasesPath: string): AliasFamily[] {
  const rawFile = fs.readFileSync(aliasesPath, 'utf8');
  const parsed = JSON.parse(rawFile) as AliasFile;

  return (parsed.aliases ?? []).map((entry) => ({
    canonical: entry.canonical,
    normalizedNames: new Set(
      [entry.canonical, ...entry.variants].map((name) => normalizePlayerName(name)),
    ),
  }));
}

// @spec DFF-ETL-020
export function normalizePlayerName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function createBigrams(value: string): string[] {
  const compact = value.replace(/\s/g, '');

  if (compact.length < 2) {
    return compact.length === 0 ? [] : [compact];
  }

  const bigrams: string[] = [];

  for (let index = 0; index < compact.length - 1; index += 1) {
    bigrams.push(compact.slice(index, index + 2));
  }

  return bigrams;
}

// @spec DFF-ETL-021
export function calculateDiceCoefficient(left: string, right: string): number {
  const leftBigrams = createBigrams(left);
  const rightBigrams = createBigrams(right);

  if (leftBigrams.length === 0 || rightBigrams.length === 0) {
    return 0;
  }

  const rightCounts = new Map<string, number>();

  for (const bigram of rightBigrams) {
    rightCounts.set(bigram, (rightCounts.get(bigram) ?? 0) + 1);
  }

  let overlap = 0;

  for (const bigram of leftBigrams) {
    const remaining = rightCounts.get(bigram) ?? 0;

    if (remaining > 0) {
      overlap += 1;
      rightCounts.set(bigram, remaining - 1);
    }
  }

  return (2 * overlap) / (leftBigrams.length + rightBigrams.length);
}

function findAliasFamily(name: string, aliasFamilies: AliasFamily[]): AliasFamily | undefined {
  const normalizedName = normalizePlayerName(name);

  return aliasFamilies.find((family) => family.normalizedNames.has(normalizedName));
}

// @spec DFF-ETL-022
export function matchPlayerCandidate(
  playerName: string,
  candidates: PlayerMatchCandidate[],
  aliasFamilies: AliasFamily[],
): PlayerMatchCandidate | undefined {
  const normalizedPlayerName = normalizePlayerName(playerName);

  const exactMatch = candidates.find(
    (candidate) => normalizePlayerName(candidate.name) === normalizedPlayerName,
  );

  if (exactMatch) {
    return exactMatch;
  }

  let bestFuzzyMatch: PlayerMatchCandidate | undefined;
  let bestFuzzyScore = 0;

  for (const candidate of candidates) {
    const score = calculateDiceCoefficient(normalizedPlayerName, normalizePlayerName(candidate.name));

    if (score >= fuzzyMatchThreshold && score > bestFuzzyScore) {
      bestFuzzyScore = score;
      bestFuzzyMatch = candidate;
    }
  }

  if (bestFuzzyMatch) {
    return bestFuzzyMatch;
  }

  const playerAliasFamily = findAliasFamily(playerName, aliasFamilies);

  if (!playerAliasFamily) {
    return undefined;
  }

  return candidates.find((candidate) =>
    playerAliasFamily.normalizedNames.has(normalizePlayerName(candidate.name)),
  );
}

// @spec DFF-ETL-040
export function computeAggregatedDynastyValue(values: Array<number | null>): number {
  const populatedValues = values.filter((value): value is number => value !== null);

  if (populatedValues.length === 0) {
    return 0;
  }

  return Math.round(populatedValues.reduce((sum, value) => sum + value, 0) / populatedValues.length);
}

// @spec DFF-ETL-023
export function createUnmatchedPlayerWarning(source: Exclude<EtlSource, 'ktc'>, playerName: string, position: SupportedEtlPosition): string {
  return `[ETL] WARN: ${source} player '${playerName}' (${position}) could not be matched to a canonical player. Excluding from this run.`;
}
