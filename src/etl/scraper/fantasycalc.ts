// @spec DFF-ETL-010
// @spec DFF-ETL-012
// @spec DFF-ETL-013
import fs from 'node:fs/promises';

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

function parseApiResponse(entries: FantasyCalcApiEntry[]): RawPlayer[] {
  return entries.flatMap((entry) => {
    const p = entry.player ?? {};
    const name = typeof p.name === 'string' ? p.name : typeof p.maybeName === 'string' ? p.maybeName : null;
    const position = typeof p.position === 'string' ? p.position.toUpperCase() : null;
    const nflTeam =
      typeof p.team === 'string' ? p.team : typeof p.maybeTeam === 'string' ? p.maybeTeam : '';
    const age =
      typeof p.age === 'number' ? p.age : typeof p.maybeAge === 'number' ? p.maybeAge : null;
    const rawValue = typeof entry.value === 'number' ? entry.value : null;

    if (name === null || position === null || rawValue === null) {
      return [];
    }

    if (!supportedPositions.has(position as SupportedEtlPosition)) {
      return [];
    }

    return [
      {
        name: name.trim(),
        position: position as SupportedEtlPosition,
        nflTeam: nflTeam.trim(),
        age,
        isRookie: Boolean(p.rookie),
        rawValue,
        adp: null,
      },
    ];
  });
}

export async function scrapeFantasyCalc(): Promise<ScraperResult> {
  const fixturePath = process.env.DYNASTYFF_FANTASYCALC_FIXTURE_PATH;

  if (fixturePath) {
    const rawFixture = await fs.readFile(fixturePath, 'utf8');
    const parsed = JSON.parse(rawFixture) as FantasyCalcApiEntry[] | { players?: FantasyCalcApiEntry[] };
    const entries = Array.isArray(parsed) ? parsed : (parsed.players ?? []);
    const players = parseApiResponse(entries);

    if (players.length === 0) {
      throw new Error('fantasycalc scraper returned no supported players');
    }

    return { source: 'fantasycalc', players, pickValues: [] as RawPickValue[] };
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
  const players = parseApiResponse(entries);

  if (players.length === 0) {
    throw new Error('fantasycalc scraper returned no supported players');
  }

  return { source: 'fantasycalc', players, pickValues: [] as RawPickValue[] };
}
