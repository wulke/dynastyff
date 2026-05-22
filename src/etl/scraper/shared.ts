// @spec DFF-ETL-010
// @spec DFF-ETL-012
// @spec DFF-ETL-013
// @spec DFF-ETL-090
import fs from 'node:fs/promises';

import type { Page } from 'playwright';

import type { RawPickValue, RawPlayer, ScraperResult, SupportedEtlPosition } from '../types.js';

const supportedPositions = new Set<SupportedEtlPosition>(['QB', 'RB', 'WR', 'TE']);

type ScrapedPlayerRow = {
  name: string;
  position: string;
  nflTeam: string;
  age: number | null;
  isRookie: boolean;
  rawValue: number;
  adp: number | null;
};

type ScrapedPickValueRow = {
  year: number;
  round: number;
  rawValue: number;
};

type FixturePayload = {
  players?: ScrapedPlayerRow[];
  pickValues?: ScrapedPickValueRow[];
};

const pickAssetNamePattern =
  /^(?<year>\d{4})(?:\s+(?<tier>early|mid|late))?\s+(?<round>[1-4])(st|nd|rd|th)$/i;

function normalizePlayers(rows: readonly ScrapedPlayerRow[]): RawPlayer[] {
  return rows.flatMap((row) => {
    const position = row.position.trim().toUpperCase();

    if (!supportedPositions.has(position as SupportedEtlPosition)) {
      return [];
    }

    if (!Number.isFinite(row.rawValue)) {
      return [];
    }

    return [
      {
        name: row.name.trim(),
        position: position as SupportedEtlPosition,
        nflTeam: row.nflTeam.trim(),
        age: typeof row.age === 'number' ? row.age : null,
        isRookie: Boolean(row.isRookie),
        rawValue: row.rawValue,
        adp: typeof row.adp === 'number' ? row.adp : null,
      },
    ];
  });
}

function normalizePickValues(rows: readonly ScrapedPickValueRow[]): RawPickValue[] {
  return rows.flatMap((row) => {
    if (!Number.isFinite(row.year) || !Number.isFinite(row.round) || !Number.isFinite(row.rawValue)) {
      return [];
    }

    return [
      {
        year: Math.trunc(row.year),
        round: Math.trunc(row.round),
        rawValue: row.rawValue,
      },
    ];
  });
}

export async function loadFixtureScraperResult(
  fixturePath: string,
  source: ScraperResult['source'],
): Promise<ScraperResult> {
  const rawFixture = await fs.readFile(fixturePath, 'utf8');
  const parsed = JSON.parse(rawFixture) as FixturePayload | ScrapedPlayerRow[];
  const payload = Array.isArray(parsed) ? { players: parsed, pickValues: [] } : parsed;

  return {
    source,
    players: normalizePlayers(payload.players ?? []),
    pickValues: normalizePickValues(payload.pickValues ?? []),
  };
}

// @spec DFF-ETL-090
export function parsePickAssetName(name: string): Pick<RawPickValue, 'year' | 'round'> | null {
  const match = pickAssetNamePattern.exec(name.trim());

  if (!match?.groups) {
    return null;
  }

  const year = Number(match.groups.year);
  const round = Number(match.groups.round);

  if (!Number.isInteger(year) || !Number.isInteger(round)) {
    return null;
  }

  return { year, round };
}

type ExtractedPagePayload = {
  players?: ScrapedPlayerRow[];
  pickValues?: ScrapedPickValueRow[];
};

export async function extractScraperPayloadFromPage(
  page: Pick<Page, 'evaluate'>,
): Promise<ExtractedPagePayload> {
  return page.evaluate(() => {
    const candidateData =
      (globalThis as {
        __DFF_SCRAPER_DATA__?: {
          players?: Array<Record<string, unknown>>;
          pickValues?: Array<Record<string, unknown>>;
        };
      }).__DFF_SCRAPER_DATA__ ?? {};

    const players =
      Array.isArray(candidateData.players) && candidateData.players.length > 0
        ? candidateData.players.flatMap((player) => {
            const name = typeof player.name === 'string' ? player.name : null;
            const position = typeof player.position === 'string' ? player.position : null;
            const nflTeam = typeof player.nflTeam === 'string' ? player.nflTeam : '';
            const rawValue = typeof player.rawValue === 'number' ? player.rawValue : null;

            if (name === null || position === null || rawValue === null) {
              return [];
            }

            return [
              {
                name,
                position,
                nflTeam,
                age: typeof player.age === 'number' ? player.age : null,
                isRookie: Boolean(player.isRookie),
                rawValue,
                adp: typeof player.adp === 'number' ? player.adp : null,
              },
            ];
          })
        : Array.from(document.querySelectorAll('tbody tr, [data-player-row], .player-row')).flatMap((row) => {
            const name =
              row.getAttribute('data-name') ||
              row.querySelector('[data-name]')?.getAttribute('data-name') ||
              row.querySelector('.player-name')?.textContent ||
              row.querySelector('a')?.textContent ||
              '';
            const position =
              row.getAttribute('data-position') ||
              row.querySelector('[data-position]')?.getAttribute('data-position') ||
              row.querySelector('.position')?.textContent ||
              '';
            const nflTeam =
              row.getAttribute('data-team') ||
              row.querySelector('[data-team]')?.getAttribute('data-team') ||
              row.querySelector('.team')?.textContent ||
              '';
            const ageText =
              row.getAttribute('data-age') ||
              row.querySelector('[data-age]')?.getAttribute('data-age') ||
              row.querySelector('.age')?.textContent ||
              '';
            const adpText =
              row.getAttribute('data-adp') ||
              row.querySelector('[data-adp]')?.getAttribute('data-adp') ||
              row.querySelector('.adp')?.textContent ||
              '';
            const valueText =
              row.getAttribute('data-value') ||
              row.querySelector('[data-value]')?.getAttribute('data-value') ||
              row.querySelector('.value')?.textContent ||
              '';

            const normalizedValue = valueText.replace(/[^0-9.]/g, '');
            if (!name.trim() || !position.trim() || normalizedValue.length === 0) {
              return [];
            }

            const age = ageText.replace(/[^0-9.]/g, '');
            const adp = adpText.replace(/[^0-9.]/g, '');
            const rowText = row.textContent?.replace(/\s+/g, ' ').trim() ?? '';

            return [
              {
                name: name.trim(),
                position: position.trim(),
                nflTeam: nflTeam.trim(),
                age: age.length > 0 ? Number(age) : null,
                isRookie: /\b(rk|rookie)\b/i.test(rowText),
                rawValue: Number(normalizedValue),
                adp: adp.length > 0 ? Number(adp) : null,
              },
            ];
          });

    const pickValues =
      Array.isArray(candidateData.pickValues) && candidateData.pickValues.length > 0
        ? candidateData.pickValues.flatMap((pick) => {
            if (
              typeof pick.year !== 'number' ||
              typeof pick.round !== 'number' ||
              typeof pick.rawValue !== 'number'
            ) {
              return [];
            }

            return [
              {
                year: pick.year,
                round: pick.round,
                rawValue: pick.rawValue,
              },
            ];
          })
        : Array.from(document.querySelectorAll('[data-pick-value-row], .pick-value-row')).flatMap((row) => {
            const yearText =
              row.getAttribute('data-year') ||
              row.querySelector('[data-year]')?.getAttribute('data-year') ||
              '';
            const roundText =
              row.getAttribute('data-round') ||
              row.querySelector('[data-round]')?.getAttribute('data-round') ||
              '';
            const valueText =
              row.getAttribute('data-value') ||
              row.querySelector('[data-value]')?.getAttribute('data-value') ||
              '';

            const year = Number(yearText.replace(/[^0-9]/g, ''));
            const round = Number(roundText.replace(/[^0-9]/g, ''));
            const rawValue = Number(valueText.replace(/[^0-9.]/g, ''));

            if (!Number.isFinite(year) || !Number.isFinite(round) || !Number.isFinite(rawValue)) {
              return [];
            }

            return [{ year, round, rawValue }];
          });

    return {
      players,
      pickValues,
    };
  });
}

function isPlaywrightTimeoutError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'TimeoutError';
}

// @spec DFF-ETL-014
export async function waitForScraperPageReady(
  page: Pick<Page, 'waitForLoadState'>,
  source: ScraperResult['source'],
  warn: (message: string) => void = console.warn,
): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
  } catch (error) {
    if (!isPlaywrightTimeoutError(error)) {
      throw error;
    }

    warn(
      `[ETL] WARN: ${source} page never reached networkidle within 30000ms. Continuing with the loaded DOM.`,
    );
  }
}

export async function scrapeSourceWithPlaywright(options: {
  fixturePath?: string;
  source: ScraperResult['source'];
  url: string;
}): Promise<ScraperResult> {
  if (options.fixturePath) {
    return loadFixtureScraperResult(options.fixturePath, options.source);
  }

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await waitForScraperPageReady(page, options.source);
    const payload = await extractScraperPayloadFromPage(page);
    const result: ScraperResult = {
      source: options.source,
      players: normalizePlayers(payload.players ?? []),
      pickValues: normalizePickValues(payload.pickValues ?? []),
    };

    if (result.players.length === 0) {
      throw new Error(`${options.source} scraper returned no supported players`);
    }

    return result;
  } finally {
    await browser.close();
  }
}
