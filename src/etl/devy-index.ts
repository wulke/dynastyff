// @spec DFF-DEVY-020
// @spec DFF-DEVY-021
// @spec DFF-DEVY-022
import { randomUUID } from 'node:crypto';

import { createDatabase } from '../db/client.js';
import { createNormalizationContext, normalizeRawValue } from './normalize.js';
import { scrapeKtcDevyPlayers, type RawDevyPlayer } from './scraper/ktc-devy.js';

export type RunDevyEtlOptions = { databasePath?: string; scrape?: () => Promise<RawDevyPlayer[]>; now?: () => string };

// @spec DFF-DEVY-020
function normalizeDevyPlayers(players: readonly RawDevyPlayer[]) {
  const superflex = createNormalizationContext(players.map((player) => ({ rawValue: player.rawValueSuperflex })));
  const oneQbPlayers = players.filter((player) => player.rawValueOneQb !== null);
  const oneQb = createNormalizationContext(oneQbPlayers.map((player) => ({ rawValue: player.rawValueOneQb! })));
  return players.map((player) => ({
    ...player,
    valueSuperflex: superflex ? normalizeRawValue(player.rawValueSuperflex, superflex) : 9999,
    valueOneQb: player.rawValueOneQb !== null && oneQb ? normalizeRawValue(player.rawValueOneQb, oneQb) : null,
  }));
}

// @spec DFF-DEVY-021
// @spec DFF-DEVY-022
export async function runDevyEtl(options: RunDevyEtlOptions = {}): Promise<number> {
  const players = normalizeDevyPlayers(await (options.scrape ?? scrapeKtcDevyPlayers)());
  const sqlite = createDatabase(options.databasePath);
  const timestamp = (options.now ?? (() => new Date().toISOString()))();
  const upsert = sqlite.prepare(`INSERT INTO devy_players (
    id, name, position, school, school_code, draft_year, value_superflex, value_one_qb, ktc_player_id, mfl_id, is_returning_to_school, is_year_decrement, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(name, position) DO UPDATE SET school=excluded.school, school_code=excluded.school_code, draft_year=excluded.draft_year, value_superflex=excluded.value_superflex, value_one_qb=excluded.value_one_qb, ktc_player_id=excluded.ktc_player_id, mfl_id=excluded.mfl_id, is_returning_to_school=excluded.is_returning_to_school, is_year_decrement=excluded.is_year_decrement, updated_at=excluded.updated_at`);
  try {
    const write = sqlite.transaction(() => players.forEach((player) => upsert.run(randomUUID(), player.name, player.position, player.school, player.schoolCode, player.draftYear, player.valueSuperflex, player.valueOneQb, player.ktcPlayerId, player.mflId, Number(player.isReturningToSchool), Number(player.isYearDecrement), timestamp)));
    write();
    return players.length;
  } finally { sqlite.close(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDevyEtl().then((count) => console.log(`[etl:devy] upserted ${count} devy players`)).catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
