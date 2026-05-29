// @spec DFF-ETL-010
// @spec DFF-ETL-012
// @spec DFF-ETL-013
// @spec DFF-ETL-090
// @spec DFF-SPKV-011
// @spec DFF-SPKV-012
import fs from 'node:fs/promises';

import { loadFixtureScraperResult, parsePickAssetName } from './shared.js';
import type { RawPickValue, RawPlayer, ScraperResult, SupportedEtlPosition } from '../types.js';

const FANTASYCALC_API_URL =
  'https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&ppr=1&numTeams=12';

const supportedPositions = new Set<SupportedEtlPosition>(['QB', 'RB', 'WR', 'TE']);

type FantasyCalcApiEntry = {
  value?: unknown;
  player?: {
    name?: unknown;
    position?: unknown;
    maybeName?: unknown;
    maybeTeam?: unknown;
    team?: unknown;
    maybeAge?: unknown;
    age?: unknown;
    rookie?: unknown;
  };
};

type ParseApiResponseOptions = {
  currentYear?: number;
};

const exactPickAssetNamePattern = /^(?<year>\d{4})\s+pick\s+(?<round>\d+)\.(?<pickInRound>\d+)$/i;

// @spec DFF-SPKV-011
// @spec DFF-SPKV-012
function parseCurrentYearExactPickName(
  name: string,
  currentYear: number,
): { round: number; pickInRound: number } | null {
  const match = exactPickAssetNamePattern.exec(name.trim());

  if (!match?.groups) {
    return null;
  }

  const year = Number(match.groups.year);
  const round = Number(match.groups.round);
  const pickInRound = Number(match.groups.pickInRound);

  if (year !== currentYear || !Number.isInteger(round) || !Number.isInteger(pickInRound)) {
    return null;
  }

  if (round < 1 || pickInRound < 1) {
    return null;
  }

  return { round, pickInRound };
}

// @spec DFF-ETL-012
// @spec DFF-ETL-090
// @spec DFF-ETL-091
// @spec DFF-SPKV-011
// @spec DFF-SPKV-012
function parseApiResponse(
  entries: FantasyCalcApiEntry[],
  options: ParseApiResponseOptions = {},
): Pick<ScraperResult, 'players' | 'pickValues'> {
  const currentYear = options.currentYear ?? new Date().getFullYear();
  const players: RawPlayer[] = [];
  const startupPickValues: RawPickValue[] = [];
  const pickAccumulator = new Map<string, { sum: number; count: number; year: number; round: number }>();

  for (const entry of entries) {
    const p = entry.player ?? {};
    const name = typeof p.name === 'string' ? p.name : typeof p.maybeName === 'string' ? p.maybeName : null;
    const position = typeof p.position === 'string' ? p.position.toUpperCase() : null;
    const nflTeam =
      typeof p.team === 'string' ? p.team : typeof p.maybeTeam === 'string' ? p.maybeTeam : '';
    const age =
      typeof p.age === 'number' ? p.age : typeof p.maybeAge === 'number' ? p.maybeAge : null;
    const rawValue = typeof entry.value === 'number' ? entry.value : null;

    if (name === null || position === null || rawValue === null) {
      continue;
    }

    if (position === 'PICK') {
      const parsedExactPick = parseCurrentYearExactPickName(name, currentYear);

      if (parsedExactPick) {
        startupPickValues.push({
          year: currentYear,
          round: parsedExactPick.round,
          pickInRound: parsedExactPick.pickInRound,
          rawValue,
        });
        continue;
      }

      const parsedPick = parsePickAssetName(name);

      if (parsedPick) {
        const key = `${parsedPick.year}-${parsedPick.round}`;
        const acc = pickAccumulator.get(key);

        if (acc) {
          acc.sum += rawValue;
          acc.count += 1;
        } else {
          pickAccumulator.set(key, { sum: rawValue, count: 1, year: parsedPick.year, round: parsedPick.round });
        }
      }

      continue;
    }

    if (!supportedPositions.has(position as SupportedEtlPosition)) {
      continue;
    }

    players.push({
      name: name.trim(),
      position: position as SupportedEtlPosition,
      nflTeam: nflTeam.trim(),
      age,
      isRookie: Boolean(p.rookie),
      rawValue,
      adp: null,
    });
  }

  const pickValues: RawPickValue[] = [
    ...startupPickValues,
    ...Array.from(pickAccumulator.values()).map(({ sum, count, year, round }) => ({
      year,
      round,
      rawValue: sum / count,
    })),
  ];

  return { players, pickValues };
}

// @spec DFF-ETL-010
// @spec DFF-ETL-012
// @spec DFF-ETL-090
export async function scrapeFantasyCalc(): Promise<ScraperResult> {
  const fixturePath = process.env.DYNASTYFF_FANTASYCALC_FIXTURE_PATH;

  if (fixturePath) {
    const rawFixture = await fs.readFile(fixturePath, 'utf8');
    const parsed = JSON.parse(rawFixture) as
      | FantasyCalcApiEntry[]
      | { players?: FantasyCalcApiEntry[]; pickValues?: RawPickValue[] };

    if (!Array.isArray(parsed)) {
      const fixtureResult = await loadFixtureScraperResult(fixturePath, 'fantasycalc');

      if (fixtureResult.players.length > 0 || fixtureResult.pickValues.length > 0) {
        return fixtureResult;
      }
    }

    const entries = Array.isArray(parsed) ? parsed : (parsed.players ?? []);
    const { players, pickValues } = parseApiResponse(entries);

    if (players.length === 0) {
      throw new Error('fantasycalc scraper returned no supported players');
    }

    return { source: 'fantasycalc', players, pickValues };
  }

  const response = await fetch(FANTASYCALC_API_URL, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`fantasycalc API responded with ${response.status}`);
  }

  const json = (await response.json()) as unknown;
  const entries: FantasyCalcApiEntry[] = Array.isArray(json) ? (json as FantasyCalcApiEntry[]) : [];
  const { players, pickValues } = parseApiResponse(entries);

  if (players.length === 0) {
    throw new Error('fantasycalc scraper returned no supported players');
  }

  return { source: 'fantasycalc', players, pickValues };
}
