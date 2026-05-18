// @spec DFF-ETL-001
// @spec DFF-ETL-030
// @spec DFF-ETL-031
// @spec DFF-ETL-032
// @spec DFF-ETL-040
// @spec DFF-ETL-041
import { randomUUID } from 'node:crypto';

import { createDatabase } from '../db/client.js';
import { normalizePlayers } from './normalize.js';
import { scrapeKtcPlayers } from './scraper/ktc.js';
import { supportedEtlPositions, type KtcRawPlayer, type SupportedEtlPosition } from './types.js';

type RunEtlOptions = {
  databasePath?: string;
  scrapeKtc?: () => Promise<KtcRawPlayer[]>;
  now?: () => string;
};

const supportedPositions = new Set<SupportedEtlPosition>(supportedEtlPositions);

function filterSupportedPlayers(players: readonly KtcRawPlayer[]): KtcRawPlayer[] {
  return players.filter((player) => supportedPositions.has(player.position));
}

function upsertPlayers(
  databasePath: string | undefined,
  players: ReturnType<typeof normalizePlayers>,
  timestamp: string,
): void {
  const sqlite = createDatabase(databasePath);

  try {
    const findExistingPlayer = sqlite.prepare(
      'SELECT id FROM players WHERE name = ? AND position = ?',
    );

    const insertPlayer = sqlite.prepare(
      `INSERT INTO players (
        id,
        name,
        position,
        nfl_team,
        age,
        is_rookie,
        dynasty_value,
        value_ktc,
        value_fantasycalc,
        value_dynastydaddy,
        value_rosteraudit,
        adp,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const updatePlayer = sqlite.prepare(
      `UPDATE players
      SET
        nfl_team = ?,
        age = ?,
        is_rookie = ?,
        dynasty_value = ?,
        value_ktc = ?,
        adp = ?,
        updated_at = ?
      WHERE name = ? AND position = ?`,
    );

    const transaction = sqlite.transaction((normalizedPlayers: ReturnType<typeof normalizePlayers>) => {
      for (const player of normalizedPlayers) {
        const existing = findExistingPlayer.get(player.name, player.position) as { id: string } | undefined;

        if (existing) {
          updatePlayer.run(
            player.nflTeam,
            player.age,
            player.isRookie ? 1 : 0,
            player.normalizedValue,
            player.normalizedValue,
            player.adp,
            timestamp,
            player.name,
            player.position,
          );
          continue;
        }

        insertPlayer.run(
          randomUUID(),
          player.name,
          player.position,
          player.nflTeam,
          player.age,
          player.isRookie ? 1 : 0,
          player.normalizedValue,
          player.normalizedValue,
          null,
          null,
          null,
          player.adp,
          timestamp,
        );
      }
    });

    transaction(players);
  } finally {
    sqlite.close();
  }
}

export async function runEtl(options: RunEtlOptions = {}): Promise<number> {
  const scrapeKtc = options.scrapeKtc ?? scrapeKtcPlayers;
  const databasePath = options.databasePath;
  const timestamp = options.now?.() ?? new Date().toISOString();

  const scrapedPlayers = await scrapeKtc();
  const supportedPlayers = filterSupportedPlayers(scrapedPlayers);

  if (supportedPlayers.length === 0) {
    console.error('[ETL] ERROR: KTC returned no supported players.');
    return 1;
  }

  const normalizedPlayers = normalizePlayers(supportedPlayers);
  upsertPlayers(databasePath ?? process.env.DYNASTYFF_DB_PATH, normalizedPlayers, timestamp);

  return 0;
}

async function main(): Promise<void> {
  const exitCode = await runEtl();
  process.exitCode = exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
