// @spec DFF-ETL-001
// @spec DFF-ETL-030
// @spec DFF-ETL-031
// @spec DFF-ETL-032
// @spec DFF-ETL-040
// @spec DFF-ETL-041
import { randomUUID } from 'node:crypto';

import { createDrizzleDb } from '../db/client.js';
import { players } from '../db/schema.js';
import { normalizePlayers } from './normalize.js';
import { scrapeKtcPlayers } from './scraper/ktc.js';
import type { KtcRawPlayer } from './types.js';

type RunEtlOptions = {
  databasePath?: string;
  scrapeKtc?: () => Promise<KtcRawPlayer[]>;
  now?: () => string;
};

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

export async function runEtl(options: RunEtlOptions = {}): Promise<number> {
  const scrapeKtc = options.scrapeKtc ?? scrapeKtcPlayers;
  const databasePath = options.databasePath;
  const timestamp = options.now?.() ?? new Date().toISOString();

  const scrapedPlayers = await scrapeKtc();

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
