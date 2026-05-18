// @spec DFF-ETL-010
// @spec DFF-ETL-011
// @spec DFF-ETL-012
import fs from 'node:fs/promises';

import type { KtcRawPlayer, SupportedEtlPosition } from '../types.js';

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

function parseNumber(input: string | null | undefined): number | null {
  if (!input) {
    return null;
  }

  const normalized = input.replace(/[^0-9.]/g, '');

  if (normalized.length === 0) {
    return null;
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function normalizeScrapedRows(rows: readonly ScrapedRow[]): KtcRawPlayer[] {
  return rows.flatMap((row) => {
    const position = row.position.toUpperCase();

    if (!supportedPositions.has(position as SupportedEtlPosition)) {
      return [];
    }

    return [
      {
        name: row.name.trim(),
        position: position as SupportedEtlPosition,
        nflTeam: row.nflTeam.trim(),
        age: row.age,
        isRookie: row.isRookie,
        rawValue: row.rawValue,
        adp: row.adp,
      },
    ];
  });
}

async function loadFixturePlayers(fixturePath: string): Promise<KtcRawPlayer[]> {
  const rawFixture = await fs.readFile(fixturePath, 'utf8');
  const parsed = JSON.parse(rawFixture) as ScrapedRow[];
  return normalizeScrapedRows(parsed);
}

export async function scrapeKtcPlayers(): Promise<KtcRawPlayer[]> {
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

    const rows = await page.evaluate(() => {
      const extractText = (element: Element | null): string =>
        element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

      const parseNumericValue = (value: string): number | null => {
        const normalized = value.replace(/[^0-9.]/g, '');

        if (!normalized) {
          return null;
        }

        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
      };

      const candidates = Array.from(document.querySelectorAll('tbody tr, .onePlayer, [data-playerid]'));

      return candidates.flatMap((row) => {
        const text = extractText(row);
        if (!text) {
          return [];
        }

        const name =
          extractText(row.querySelector('[data-testid=\"player-name\"]')) ||
          extractText(row.querySelector('.player-name')) ||
          extractText(row.querySelector('a[href*=\"players\"]')) ||
          extractText(row.querySelector('strong'));

        const position =
          extractText(row.querySelector('[data-testid=\"player-position\"]')) ||
          extractText(row.querySelector('.position')) ||
          row.getAttribute('data-position') ||
          '';

        const nflTeam =
          extractText(row.querySelector('[data-testid=\"player-team\"]')) ||
          extractText(row.querySelector('.team')) ||
          row.getAttribute('data-team') ||
          '';

        const ageText =
          extractText(row.querySelector('[data-testid=\"player-age\"]')) ||
          extractText(row.querySelector('.age'));

        const adpText =
          extractText(row.querySelector('[data-testid=\"player-adp\"]')) ||
          extractText(row.querySelector('.adp'));

        const valueText =
          extractText(row.querySelector('[data-testid=\"player-value\"]')) ||
          extractText(row.querySelector('.value')) ||
          row.getAttribute('data-value') ||
          '';

        const rawValue = parseNumericValue(valueText);
        if (!name || !position || rawValue === null) {
          return [];
        }

        return [
          {
            name,
            position,
            nflTeam,
            age: parseNumericValue(ageText),
            isRookie: /\b(rk|rookie)\b/i.test(text),
            rawValue,
            adp: parseNumericValue(adpText),
          },
        ];
      });
    });

    const players = normalizeScrapedRows(
      rows.filter((row): row is ScrapedRow => row !== null && typeof row === 'object'),
    );

    if (players.length === 0) {
      throw new Error('KTC scraper returned no supported players');
    }

    return players;
  } finally {
    await browser.close();
  }
}

export const __testables = {
  normalizeScrapedRows,
  parseNumber,
};
