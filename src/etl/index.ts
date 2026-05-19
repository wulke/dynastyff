// @spec DFF-ETL-001
// @spec DFF-ETL-010
// @spec DFF-ETL-011
// @spec DFF-ETL-012
// @spec DFF-ETL-013
// @spec DFF-ETL-030
// @spec DFF-ETL-031
// @spec DFF-ETL-032
// @spec DFF-ETL-040
// @spec DFF-ETL-041
import { randomUUID } from 'node:crypto';

import { createDrizzleDb } from '../db/client.js';
import { players } from '../db/schema.js';
import { normalizePlayers } from './normalize.js';
import { scrapeDynastyDaddy } from './scraper/dynastydaddy.js';
import { scrapeFantasyCalc } from './scraper/fantasycalc.js';
import { scrapeKtcPlayers } from './scraper/ktc.js';
import { scrapeRosterAudit } from './scraper/rosteraudit.js';
import type { RawPlayer, ScraperResult } from './types.js';

type RunEtlOptions = {
  databasePath?: string;
  scrapeKtc?: () => Promise<RawPlayer[]>;
  scrapeFantasycalc?: () => Promise<ScraperResult>;
  scrapeDynastydaddy?: () => Promise<ScraperResult>;
  scrapeRosteraudit?: () => Promise<ScraperResult>;
  now?: () => string;
};

type RunScrapersOptions = Pick<
  RunEtlOptions,
  'scrapeKtc' | 'scrapeFantasycalc' | 'scrapeDynastydaddy' | 'scrapeRosteraudit'
>;

function upsertPlayers(
  databasePath: string | undefined,
  normalizedPlayers: ReturnType<typeof normalizePlayers>,
  timestamp: string,
): void {
  const { db, sqlite } = createDrizzleDb(databasePath);

  try {
    db.transaction((tx) => {
      for (const player of normalizedPlayers) {
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
            valueFantasycalc: null,
            valueDynastydaddy: null,
            valueRosteraudit: null,
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

export async function runScrapers(options: RunScrapersOptions = {}): Promise<ScraperResult[]> {
  const scrapeKtc = options.scrapeKtc ?? scrapeKtcPlayers;
  const scrapeFantasycalc = options.scrapeFantasycalc ?? scrapeFantasyCalc;
  const scrapeDynastydaddy = options.scrapeDynastydaddy ?? scrapeDynastyDaddy;
  const scrapeRosteraudit = options.scrapeRosteraudit ?? scrapeRosterAudit;

  return runTasksWithConcurrencyLimit(
    [
      async () => ({
        source: 'ktc' as const,
        players: await scrapeKtc(),
        pickValues: [],
      }),
      scrapeFantasycalc,
      scrapeDynastydaddy,
      scrapeRosteraudit,
    ],
    2,
  );
}

export async function runEtl(options: RunEtlOptions = {}): Promise<number> {
  const databasePath = options.databasePath;
  const timestamp = options.now?.() ?? new Date().toISOString();

  const scraperResults = await runScrapers(options);
  const scrapedPlayers = scraperResults.find((result) => result.source === 'ktc')?.players ?? [];

  if (scrapedPlayers.length === 0) {
    console.error('[ETL] ERROR: KTC returned no supported players.');
    return 1;
  }

  const normalizedPlayers = normalizePlayers(scrapedPlayers);
  upsertPlayers(databasePath, normalizedPlayers, timestamp);

  return 0;
}

async function main(): Promise<void> {
  const exitCode = await runEtl();
  process.exitCode = exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
