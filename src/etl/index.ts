// @spec DFF-ETL-001
// @spec DFF-ETL-010
// @spec DFF-ETL-011
// @spec DFF-ETL-012
// @spec DFF-ETL-013
// @spec DFF-ETL-030
// @spec DFF-ETL-032
import { randomUUID } from 'node:crypto';

import { createDrizzleDb } from '../db/client.js';
import { players } from '../db/schema.js';
import { normalizePlayers } from './normalize.js';
import { scrapeFantasyCalc } from './scraper/fantasycalc.js';
import { scrapeKtcPlayers } from './scraper/ktc.js';
import { scrapeRosterAudit } from './scraper/rosteraudit.js';
import type { RawPlayer, ScraperResult } from './types.js';

type RunEtlOptions = {
  databasePath?: string;
  scrapeKtc?: () => Promise<RawPlayer[]>;
  scrapeFantasycalc?: () => Promise<ScraperResult>;
  scrapeRosteraudit?: () => Promise<ScraperResult>;
  now?: () => string;
};

type RunScrapersOptions = Pick<
  RunEtlOptions,
  'scrapeKtc' | 'scrapeFantasycalc' | 'scrapeRosteraudit'
>;

type SourceValueMap = Map<string, number>;

function playerKey(name: string, position: string): string {
  return `${name.toLowerCase().trim()}|${position.toUpperCase()}`;
}

function buildSourceValueMap(result: ScraperResult): SourceValueMap {
  const normalized = normalizePlayers(result.players);
  const map: SourceValueMap = new Map();
  for (const p of normalized) {
    map.set(playerKey(p.name, p.position), p.normalizedValue);
  }
  return map;
}

function upsertPlayers(
  databasePath: string | undefined,
  normalizedKtcPlayers: ReturnType<typeof normalizePlayers>,
  fantasycalcValues: SourceValueMap,
  rosterauditValues: SourceValueMap,
  timestamp: string,
): void {
  const { db, sqlite } = createDrizzleDb(databasePath);

  try {
    db.transaction((tx) => {
      for (const player of normalizedKtcPlayers) {
        const key = playerKey(player.name, player.position);
        const valueFantasycalc = fantasycalcValues.get(key) ?? null;
        const valueRosteraudit = rosterauditValues.get(key) ?? null;

        tx
          .insert(players)
          .values({
            id: randomUUID(),
            name: player.name,
            position: player.position,
            nflTeam: player.nflTeam,
            age: player.age,
            isRookie: player.isRookie,
            dynastyValue: player.normalizedValue,
            valueKtc: player.normalizedValue,
            valueFantasycalc,
            valueDynastydaddy: null,
            valueRosteraudit,
            adp: player.adp,
            updatedAt: timestamp,
          })
          .onConflictDoUpdate({
            target: [players.name, players.position],
            set: {
              nflTeam: player.nflTeam,
              age: player.age,
              isRookie: player.isRookie,
              dynastyValue: player.normalizedValue,
              valueKtc: player.normalizedValue,
              valueFantasycalc,
              valueRosteraudit,
              adp: player.adp,
              updatedAt: timestamp,
            },
          })
          .run();
      }
    });
  } finally {
    sqlite.close();
  }
}

async function runTasksWithConcurrencyLimit<T>(
  taskFactories: Array<() => Promise<T>>,
  concurrencyLimit: number,
): Promise<T[]> {
  const results = new Array<T>(taskFactories.length);
  let nextTaskIndex = 0;

  async function worker(): Promise<void> {
    while (nextTaskIndex < taskFactories.length) {
      const taskIndex = nextTaskIndex;
      nextTaskIndex += 1;
      results[taskIndex] = await taskFactories[taskIndex]();
    }
  }

  const workerCount = Math.min(concurrencyLimit, taskFactories.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

async function runScraper<T extends ScraperResult>(
  source: string,
  fn: () => Promise<T>,
): Promise<T> {
  console.log(`[ETL] [${source}] Scraping...`);
  const result = await fn();
  console.log(`[ETL] [${source}] Done — ${result.players.length} players, ${result.pickValues.length} pick values`);
  return result;
}

export async function runScrapers(options: RunScrapersOptions = {}): Promise<ScraperResult[]> {
  const scrapeKtc = options.scrapeKtc ?? scrapeKtcPlayers;
  const scrapeFantasycalc = options.scrapeFantasycalc ?? scrapeFantasyCalc;
  const scrapeRosteraudit = options.scrapeRosteraudit ?? scrapeRosterAudit;

  return runTasksWithConcurrencyLimit(
    [
      () =>
        runScraper('ktc', async () => ({
          source: 'ktc' as const,
          players: await scrapeKtc(),
          pickValues: [],
        })),
      () => runScraper('fantasycalc', scrapeFantasycalc),
      () => runScraper('rosteraudit', scrapeRosteraudit),
    ],
    2,
  );
}

export async function runEtl(options: RunEtlOptions = {}): Promise<number> {
  const databasePath = options.databasePath;
  const timestamp = options.now?.() ?? new Date().toISOString();

  console.log('[ETL] Starting ETL run...');
  const scraperResults = await runScrapers(options);

  const ktcResult = scraperResults.find((result) => result.source === 'ktc');
  if (!ktcResult || ktcResult.players.length === 0) {
    console.error('[ETL] ERROR: KTC returned no supported players.');
    return 1;
  }

  const fantasycalcResult = scraperResults.find((result) => result.source === 'fantasycalc');
  const rosterauditResult = scraperResults.find((result) => result.source === 'rosteraudit');

  const fantasycalcValues = fantasycalcResult ? buildSourceValueMap(fantasycalcResult) : new Map<string, number>();
  const rosterauditValues = rosterauditResult ? buildSourceValueMap(rosterauditResult) : new Map<string, number>();

  console.log(`[ETL] Normalizing ${ktcResult.players.length} players...`);
  const normalizedPlayers = normalizePlayers(ktcResult.players);

  console.log(`[ETL] Writing ${normalizedPlayers.length} players to database...`);
  upsertPlayers(databasePath, normalizedPlayers, fantasycalcValues, rosterauditValues, timestamp);

  console.log('[ETL] Done.');
  return 0;
}

async function main(): Promise<void> {
  const exitCode = await runEtl();
  process.exitCode = exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
