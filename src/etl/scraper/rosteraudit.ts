// @spec DFF-ETL-010
// @spec DFF-ETL-012
// @spec DFF-ETL-013
import fs from 'node:fs/promises';

import { loadFixtureScraperResult } from './shared.js';
import type { RawPickValue, RawPlayer, ScraperResult, SupportedEtlPosition } from '../types.js';

const ROSTERAUDIT_API_URL = 'https://rosteraudit.com/wp-json/ra/v1/rankings';
const ROSTERAUDIT_FORMAT = 'sf';
const ROSTERAUDIT_PER_PAGE = 100;

const supportedPositions = new Set<SupportedEtlPosition>(['QB', 'RB', 'WR', 'TE']);

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

type RosterAuditApiEntry = {
  type?: string;
  name?: unknown;
  position?: unknown;
  team?: unknown;
  age?: unknown;
  value?: unknown;
  pick_season?: unknown;
  pick_round?: unknown;
  pick_slot?: unknown;
  is_exact?: unknown;
};

type RosterAuditApiPage = {
  players?: RosterAuditApiEntry[];
  total_pages?: number;
};

function parsePlayer(entry: RosterAuditApiEntry): RawPlayer | null {
  const name = typeof entry.name === 'string' ? entry.name.trim() : null;
  const position = typeof entry.position === 'string' ? entry.position.toUpperCase() : null;
  const nflTeam = typeof entry.team === 'string' ? entry.team.trim() : '';
  const rawValue = typeof entry.value === 'number' ? entry.value : null;
  const ageRaw = typeof entry.age === 'string' ? parseFloat(entry.age) : typeof entry.age === 'number' ? entry.age : null;
  const age = ageRaw !== null && Number.isFinite(ageRaw) ? ageRaw : null;

  if (name === null || position === null || rawValue === null) return null;
  if (!supportedPositions.has(position as SupportedEtlPosition)) return null;

  return {
    name,
    position: position as SupportedEtlPosition,
    nflTeam,
    age,
    isRookie: false,
    rawValue,
    adp: null,
  };
}

function parsePickValue(entry: RosterAuditApiEntry): RawPickValue | null {
  // Skip exact per-slot picks; keep only early/mid/late generics
  if (entry.is_exact === true) return null;

  const year = typeof entry.pick_season === 'number' ? entry.pick_season : null;
  const round = typeof entry.pick_round === 'number' ? entry.pick_round : null;
  const rawValue = typeof entry.value === 'number' ? entry.value : null;

  if (year === null || round === null || rawValue === null) return null;

  return { year, round, rawValue };
}

function parseEntries(entries: RosterAuditApiEntry[]): { players: RawPlayer[]; pickValues: RawPickValue[] } {
  const players: RawPlayer[] = [];
  // Deduplicate by (year, round): the API can return multiple non-exact entries
  // for the same round (e.g. early/mid/late generics), which would violate the
  // UNIQUE(run_id, year, round, source) snapshot constraint.
  const pickValueAccumulator = new Map<string, { sum: number; count: number; year: number; round: number }>();

  for (const entry of entries) {
    if (entry.type === 'pick' || entry.position === 'PICK') {
      const pick = parsePickValue(entry);
      if (pick) {
        const key = `${pick.year}-${pick.round}`;
        const acc = pickValueAccumulator.get(key);
        if (acc) {
          acc.sum += pick.rawValue;
          acc.count += 1;
        } else {
          pickValueAccumulator.set(key, { sum: pick.rawValue, count: 1, year: pick.year, round: pick.round });
        }
      }
    } else {
      const player = parsePlayer(entry);
      if (player) players.push(player);
    }
  }

  const pickValues: RawPickValue[] = Array.from(pickValueAccumulator.values()).map(({ sum, count, year, round }) => ({
    year,
    round,
    rawValue: sum / count,
  }));

  return { players, pickValues };
}

async function fetchAllPages(): Promise<RosterAuditApiEntry[]> {
  const allEntries: RosterAuditApiEntry[] = [];

  const firstUrl = `${ROSTERAUDIT_API_URL}?format=${ROSTERAUDIT_FORMAT}&per_page=${ROSTERAUDIT_PER_PAGE}&page=1`;
  const firstResponse = await fetch(firstUrl, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });

  if (!firstResponse.ok) {
    throw new Error(`rosteraudit API responded with ${firstResponse.status}`);
  }

  const firstPage = (await firstResponse.json()) as RosterAuditApiPage;
  allEntries.push(...(firstPage.players ?? []));

  const totalPages = typeof firstPage.total_pages === 'number' ? firstPage.total_pages : 1;

  await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, i) => i + 2).map(async (page) => {
      const url = `${ROSTERAUDIT_API_URL}?format=${ROSTERAUDIT_FORMAT}&per_page=${ROSTERAUDIT_PER_PAGE}&page=${page}`;
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });

      if (!response.ok) {
        throw new Error(`rosteraudit API page ${page} responded with ${response.status}`);
      }

      const pageData = (await response.json()) as RosterAuditApiPage;
      allEntries.push(...(pageData.players ?? []));
    }),
  );

  return allEntries;
}

export async function scrapeRosterAudit(): Promise<ScraperResult> {
  const fixturePath = process.env.DYNASTYFF_ROSTERAUDIT_FIXTURE_PATH;

  if (fixturePath) {
    const fixtureResult = await loadFixtureScraperResult(fixturePath, 'rosteraudit');

    if (fixtureResult.players.length > 0 || fixtureResult.pickValues.length > 0) {
      return fixtureResult;
    }

    const rawFixture = await fs.readFile(fixturePath, 'utf8');
    const parsed = JSON.parse(rawFixture) as
      | RosterAuditApiEntry[]
      | { players?: RosterAuditApiEntry[] };
    const entries = Array.isArray(parsed) ? parsed : (parsed.players ?? []);
    const { players, pickValues } = parseEntries(entries);

    if (players.length === 0) {
      throw new Error('rosteraudit scraper returned no supported players');
    }

    return { source: 'rosteraudit', players, pickValues };
  }

  const entries = await fetchAllPages();
  const { players, pickValues } = parseEntries(entries);

  if (players.length === 0) {
    throw new Error('rosteraudit scraper returned no supported players');
  }

  return { source: 'rosteraudit', players, pickValues };
}
