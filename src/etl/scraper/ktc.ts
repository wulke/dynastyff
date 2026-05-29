// @spec DFF-ETL-010
// @spec DFF-ETL-012
// @spec DFF-ETL-090
// @spec DFF-SPKV-010
// @spec DFF-SPKV-012
// @spec DFF-SPKV-013
import fs from 'node:fs/promises';

import type { Page } from 'playwright';
import { parsePickAssetName, parseStartupPickName } from './shared.js';
import type { RawPickValue, RawPlayer, ScraperResult, SupportedEtlPosition } from '../types.js';

const KTC_URL = 'https://keeptradecut.com/dynasty-rankings';
const supportedPositions = new Set<SupportedEtlPosition>(['QB', 'RB', 'WR', 'TE']);

type ScrapedRow = {
  name: string;
  position: string;
  nflTeam: string;
  age: number | null;
  isRookie: boolean;
  rawValue: number;
  adp: number | null;
};

type NormalizeScrapedRowsOptions = {
  currentYear?: number;
  warn?: (message: string) => void;
};

// @spec DFF-ETL-012
// @spec DFF-ETL-090
// @spec DFF-ETL-091
// @spec DFF-SPKV-010
// @spec DFF-SPKV-012
// @spec DFF-SPKV-013
function normalizeScrapedRows(
  rows: readonly ScrapedRow[],
  options: NormalizeScrapedRowsOptions = {},
): ScraperResult {
  const currentYear = options.currentYear ?? new Date().getFullYear();
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const players: RawPlayer[] = [];
  const startupPickValues: RawPickValue[] = [];
  const pickAccumulator = new Map<string, { sum: number; count: number; year: number; round: number }>();

  for (const row of rows) {
    const position = row.position.toUpperCase();

    if (position === 'RDP') {
      const parsedStartupPick = parseStartupPickName(row.name);

      if (parsedStartupPick) {
        startupPickValues.push({
          year: currentYear,
          round: parsedStartupPick.round,
          pickInRound: parsedStartupPick.pickInRound,
          rawValue: row.rawValue,
        });
        continue;
      }

      if (/^startup\b/i.test(row.name.trim())) {
        warn(`[ETL] WARN: ktc returned malformed startup pick asset "${row.name}". Excluding from pick values.`);
        continue;
      }

      const parsedPick = parsePickAssetName(row.name);

      if (parsedPick) {
        const key = `${parsedPick.year}-${parsedPick.round}`;
        const acc = pickAccumulator.get(key);

        if (acc) {
          acc.sum += row.rawValue;
          acc.count += 1;
        } else {
          pickAccumulator.set(key, { sum: row.rawValue, count: 1, year: parsedPick.year, round: parsedPick.round });
        }
      }

      continue;
    }

    if (!supportedPositions.has(position as SupportedEtlPosition)) {
      continue;
    }

    players.push({
      name: row.name.trim(),
      position: position as SupportedEtlPosition,
      nflTeam: row.nflTeam.trim(),
      age: row.age,
      isRookie: row.isRookie,
      rawValue: row.rawValue,
      adp: row.adp,
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

  return {
    source: 'ktc',
    players,
    pickValues,
  };
}

// @spec DFF-ETL-012
// @spec DFF-ETL-090
async function loadFixturePlayers(fixturePath: string): Promise<ScraperResult> {
  const rawFixture = await fs.readFile(fixturePath, 'utf8');
  const parsed = JSON.parse(rawFixture) as ScrapedRow[];
  return normalizeScrapedRows(parsed);
}

export async function extractKtcRowsFromPage(page: Pick<Page, 'evaluate'>): Promise<ScrapedRow[]> {
  return page.evaluate(() => {
    const embeddedPlayers = (globalThis as {
      playersArray?: Array<{
        playerName?: string;
        position?: string;
        team?: string;
        rookie?: boolean;
        age?: number | null;
        superflexValues?: {
          value?: number;
          startupAdp?: number | null;
        };
      }>;
    }).playersArray;

    const embeddedRows =
      Array.isArray(embeddedPlayers) && embeddedPlayers.length > 0
        ? embeddedPlayers.flatMap((player) => {
            if (
              typeof player.playerName !== 'string' ||
              typeof player.position !== 'string' ||
              typeof player.superflexValues?.value !== 'number'
            ) {
              return [];
            }

            return [
              {
                name: player.playerName,
                position: player.position,
                nflTeam: typeof player.team === 'string' ? player.team : '',
                age: typeof player.age === 'number' ? player.age : null,
                isRookie: Boolean(player.rookie),
                rawValue: player.superflexValues.value,
                adp:
                  typeof player.superflexValues.startupAdp === 'number'
                    ? player.superflexValues.startupAdp
                    : null,
              },
            ];
          })
        : [];

    if (embeddedRows.length > 0) {
      return embeddedRows;
    }

    const candidates = Array.from(document.querySelectorAll('tbody tr, .onePlayer, [data-playerid]'));

    return candidates.flatMap((row) => {
      const text = row.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (!text) {
        return [];
      }

      const name =
        row.querySelector('[data-testid="player-name"]')?.textContent?.replace(/\s+/g, ' ').trim() ||
        row.querySelector('.player-name')?.textContent?.replace(/\s+/g, ' ').trim() ||
        row.querySelector('a[href*="players"]')?.textContent?.replace(/\s+/g, ' ').trim() ||
        row.querySelector('strong')?.textContent?.replace(/\s+/g, ' ').trim() ||
        '';

      const position =
        row.querySelector('[data-testid="player-position"]')?.textContent?.replace(/\s+/g, ' ').trim() ||
        row.querySelector('.position')?.textContent?.replace(/\s+/g, ' ').trim() ||
        row.getAttribute('data-position') ||
        '';

      const nflTeam =
        row.querySelector('[data-testid="player-team"]')?.textContent?.replace(/\s+/g, ' ').trim() ||
        row.querySelector('.team')?.textContent?.replace(/\s+/g, ' ').trim() ||
        row.getAttribute('data-team') ||
        '';

      const ageText =
        row.querySelector('[data-testid="player-age"]')?.textContent?.replace(/\s+/g, ' ').trim() ||
        row.querySelector('.age')?.textContent?.replace(/\s+/g, ' ').trim() ||
        '';

      const adpText =
        row.querySelector('[data-testid="player-adp"]')?.textContent?.replace(/\s+/g, ' ').trim() ||
        row.querySelector('.adp')?.textContent?.replace(/\s+/g, ' ').trim() ||
        '';

      const valueText =
        row.querySelector('[data-testid="player-value"]')?.textContent?.replace(/\s+/g, ' ').trim() ||
        row.querySelector('.value')?.textContent?.replace(/\s+/g, ' ').trim() ||
        row.getAttribute('data-value') ||
        '';

      const rawValueNormalized = valueText.replace(/[^0-9.]/g, '');
      const rawValue = rawValueNormalized ? Number(rawValueNormalized) : NaN;

      if (!name || !position || !Number.isFinite(rawValue)) {
        return [];
      }

      const ageNormalized = ageText.replace(/[^0-9.]/g, '');
      const adpNormalized = adpText.replace(/[^0-9.]/g, '');

      return [
        {
          name,
          position,
          nflTeam,
          age: ageNormalized ? Number(ageNormalized) : null,
          isRookie: /\b(rk|rookie)\b/i.test(text),
          rawValue,
          adp: adpNormalized ? Number(adpNormalized) : null,
        },
      ];
    });
  });
}

// @spec DFF-ETL-010
// @spec DFF-ETL-012
// @spec DFF-ETL-090
export async function scrapeKtcPlayers(): Promise<ScraperResult> {
  const fixturePath = process.env.DYNASTYFF_KTC_FIXTURE_PATH;

  if (fixturePath) {
    return loadFixturePlayers(fixturePath);
  }

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(KTC_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    const rows = await extractKtcRowsFromPage(page);

    const result = normalizeScrapedRows(
      rows.filter((row): row is ScrapedRow => row !== null && typeof row === 'object'),
    );

    if (result.players.length === 0) {
      throw new Error('KTC scraper returned no supported players');
    }

    return result;
  } finally {
    await browser.close();
  }
}
