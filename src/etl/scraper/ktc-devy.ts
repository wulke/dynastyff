// @spec DFF-DEVY-010
// @spec DFF-DEVY-011
import fs from 'node:fs/promises';

import type { Page } from 'playwright';

import type { SupportedEtlPosition } from '../types.js';

const KTC_DEVY_URL = 'https://keeptradecut.com/devy-rankings';
const supportedPositions = new Set<SupportedEtlPosition>(['QB', 'RB', 'WR', 'TE']);

export type RawDevyPlayer = {
  name: string;
  position: SupportedEtlPosition;
  school: string | null;
  schoolCode: string | null;
  draftYear: number;
  rawValueSuperflex: number;
  rawValueOneQb: number | null;
  ktcPlayerId: string | null;
  mflId: string | null;
  isReturningToSchool: boolean;
  isYearDecrement: boolean;
};

type KtcDevyRow = {
  playerName?: string;
  position?: string;
  team?: string;
  teamLongName?: string;
  draftYear?: number | string;
  playerID?: number | string;
  mflid?: number | string;
  superflexValues?: { value?: number };
  oneQbValues?: { value?: number };
  returningToSchool?: boolean;
  isReturningToSchool?: boolean;
  yearDecrement?: boolean;
  isYearDecrement?: boolean;
};

// @spec DFF-DEVY-010
// @spec DFF-DEVY-011
export function normalizeDevyRows(rows: readonly KtcDevyRow[], options: { warn?: (message: string) => void } = {}): RawDevyPlayer[] {
  const warn = options.warn ?? ((message: string) => console.warn(message));

  return rows.flatMap((row) => {
    const position = row.position?.trim().toUpperCase();
    if (!position || !supportedPositions.has(position as SupportedEtlPosition)) {
      warn(`[ETL] WARN: KTC devy returned unsupported position "${row.position ?? ''}" for "${row.playerName ?? ''}". Excluding row.`);
      return [];
    }
    const draftYear = Number(row.draftYear);
    if (!row.playerName || !Number.isFinite(draftYear) || typeof row.superflexValues?.value !== 'number') {
      return [];
    }
    return [{
      name: row.playerName.trim(), position: position as SupportedEtlPosition,
      school: typeof row.teamLongName === 'string' ? row.teamLongName : typeof row.team === 'string' ? row.team : null,
      schoolCode: typeof row.team === 'string' ? row.team : null, draftYear,
      rawValueSuperflex: row.superflexValues.value,
      rawValueOneQb: typeof row.oneQbValues?.value === 'number' ? row.oneQbValues.value : null,
      ktcPlayerId: row.playerID == null ? null : String(row.playerID), mflId: row.mflid == null ? null : String(row.mflid),
      isReturningToSchool: Boolean(row.isReturningToSchool ?? row.returningToSchool),
      isYearDecrement: Boolean(row.isYearDecrement ?? row.yearDecrement),
    }];
  });
}

// @spec DFF-DEVY-010
export async function extractKtcDevyRowsFromPage(page: Pick<Page, 'evaluate'>): Promise<KtcDevyRow[]> {
  return page.evaluate(() => {
    const players = (globalThis as { playersArray?: unknown }).playersArray;
    return Array.isArray(players) ? players : [];
  }) as Promise<KtcDevyRow[]>;
}

// @spec DFF-DEVY-010
export async function scrapeKtcDevyPlayers(): Promise<RawDevyPlayer[]> {
  const fixturePath = process.env.DYNASTYFF_KTC_DEVY_FIXTURE_PATH;
  if (fixturePath) return normalizeDevyRows(JSON.parse(await fs.readFile(fixturePath, 'utf8')) as KtcDevyRow[]);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(KTC_DEVY_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    const players = normalizeDevyRows(await extractKtcDevyRowsFromPage(page));
    if (players.length === 0) throw new Error('KTC devy scraper returned no supported players');
    return players;
  } finally { await browser.close(); }
}
