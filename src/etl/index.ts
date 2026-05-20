// @spec DFF-ETL-001
// @spec DFF-ETL-010
// @spec DFF-ETL-011
// @spec DFF-ETL-012
// @spec DFF-ETL-013
// @spec DFF-ETL-030
// @spec DFF-ETL-032
// @spec DFF-HIST-002
// @spec DFF-HIST-040
// @spec DFF-HIST-041
// @spec DFF-HIST-050
// @spec DFF-HIST-051
// @spec DFF-HIST-052
import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import { createDatabase } from '../db/client.js';
import { normalizePickValues, normalizePlayers } from './normalize.js';
import { scrapeDynastyDaddy } from './scraper/dynastydaddy.js';
import { scrapeFantasyCalc } from './scraper/fantasycalc.js';
import { scrapeKtcPlayers } from './scraper/ktc.js';
import { scrapeRosterAudit } from './scraper/rosteraudit.js';
import { etlSources, type EtlSource, type NormalizedPickValue, type NormalizedPlayer, type RawPlayer, type ScraperResult } from './types.js';

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

type PlayerIdRow = { id: string };
type PickValueIdRow = { id: string };

type EtlStatements = {
  insertRun: Database.Statement;
  updateRunCompletion: Database.Statement;
  selectPlayerId: Database.Statement<[string, string], PlayerIdRow | undefined>;
  insertPlayer: Database.Statement;
  updateKtcPlayer: Database.Statement;
  updateFantasycalcPlayer: Database.Statement;
  updateDynastydaddyPlayer: Database.Statement;
  updateRosterauditPlayer: Database.Statement;
  insertPlayerSnapshot: Database.Statement;
  selectPickValueId: Database.Statement<[number, number], PickValueIdRow | undefined>;
  insertPickValue: Database.Statement;
  updatePickValue: Database.Statement;
  insertPickSnapshot: Database.Statement;
};

function createStatements(sqlite: Database.Database): EtlStatements {
  return {
    insertRun: sqlite.prepare(
      `INSERT INTO etl_runs (
        id, started_at, completed_at, sources_attempted, sources_succeeded
      ) VALUES (?, ?, NULL, ?, ?)`,
    ),
    updateRunCompletion: sqlite.prepare(
      `UPDATE etl_runs
       SET completed_at = ?, sources_succeeded = ?
       WHERE id = ?`,
    ),
    selectPlayerId: sqlite.prepare(
      `SELECT id
       FROM players
       WHERE name = ? AND position = ?`,
    ),
    insertPlayer: sqlite.prepare(
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
    ),
    updateKtcPlayer: sqlite.prepare(
      `UPDATE players
       SET nfl_team = ?,
           age = ?,
           is_rookie = ?,
           dynasty_value = ?,
           value_ktc = ?,
           adp = ?,
           updated_at = ?
       WHERE id = ?`,
    ),
    updateFantasycalcPlayer: sqlite.prepare(
      `UPDATE players
       SET value_fantasycalc = ?,
           updated_at = ?
       WHERE id = ?`,
    ),
    updateDynastydaddyPlayer: sqlite.prepare(
      `UPDATE players
       SET value_dynastydaddy = ?,
           updated_at = ?
       WHERE id = ?`,
    ),
    updateRosterauditPlayer: sqlite.prepare(
      `UPDATE players
       SET value_rosteraudit = ?,
           updated_at = ?
       WHERE id = ?`,
    ),
    insertPlayerSnapshot: sqlite.prepare(
      `INSERT INTO player_value_snapshots (
        id, run_id, player_id, source, raw_value
      ) VALUES (?, ?, ?, ?, ?)`,
    ),
    selectPickValueId: sqlite.prepare(
      `SELECT id
       FROM pick_values
       WHERE year = ? AND round = ?`,
    ),
    insertPickValue: sqlite.prepare(
      `INSERT INTO pick_values (
        id, year, round, dynasty_value, updated_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ),
    updatePickValue: sqlite.prepare(
      `UPDATE pick_values
       SET dynasty_value = ?, updated_at = ?
       WHERE id = ?`,
    ),
    insertPickSnapshot: sqlite.prepare(
      `INSERT INTO pick_value_snapshots (
        id, run_id, year, round, source, raw_value
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ),
  };
}

function writeKtcPlayer(
  statements: EtlStatements,
  runId: string,
  player: NormalizedPlayer,
  timestamp: string,
): void {
  const existing = statements.selectPlayerId.get(player.name, player.position);
  const playerId = existing?.id ?? randomUUID();

  if (existing) {
    statements.updateKtcPlayer.run(
      player.nflTeam,
      player.age,
      player.isRookie ? 1 : 0,
      player.normalizedValue,
      player.normalizedValue,
      player.adp,
      timestamp,
      playerId,
    );
  } else {
    statements.insertPlayer.run(
      playerId,
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

  statements.insertPlayerSnapshot.run(randomUUID(), runId, playerId, 'ktc', player.rawValue);
}

function writeMatchedSourcePlayer(
  statements: EtlStatements,
  runId: string,
  source: Exclude<EtlSource, 'ktc'>,
  player: NormalizedPlayer,
  timestamp: string,
): void {
  const existing = statements.selectPlayerId.get(player.name, player.position);

  if (!existing) {
    return;
  }

  if (source === 'fantasycalc') {
    statements.updateFantasycalcPlayer.run(player.normalizedValue, timestamp, existing.id);
  } else if (source === 'dynastydaddy') {
    statements.updateDynastydaddyPlayer.run(player.normalizedValue, timestamp, existing.id);
  } else {
    statements.updateRosterauditPlayer.run(player.normalizedValue, timestamp, existing.id);
  }

  statements.insertPlayerSnapshot.run(randomUUID(), runId, existing.id, source, player.rawValue);
}

function writePickValue(
  statements: EtlStatements,
  runId: string,
  source: EtlSource,
  pickValue: NormalizedPickValue,
  timestamp: string,
): void {
  const existing = statements.selectPickValueId.get(pickValue.year, pickValue.round);

  if (existing) {
    statements.updatePickValue.run(pickValue.normalizedValue, timestamp, existing.id);
  } else {
    statements.insertPickValue.run(
      randomUUID(),
      pickValue.year,
      pickValue.round,
      pickValue.normalizedValue,
      timestamp,
    );
  }

  statements.insertPickSnapshot.run(
    randomUUID(),
    runId,
    pickValue.year,
    pickValue.round,
    source,
    pickValue.rawValue,
  );
}

function writeSourceData(
  sqlite: Database.Database,
  statements: EtlStatements,
  runId: string,
  result: ScraperResult,
  timestamp: string,
): void {
  const normalizedPlayers = normalizePlayers(result.players);
  const normalizedPickValues = normalizePickValues(result.pickValues);

  const transaction = sqlite.transaction(() => {
    for (const player of normalizedPlayers) {
      if (result.source === 'ktc') {
        writeKtcPlayer(statements, runId, player, timestamp);
      } else {
        writeMatchedSourcePlayer(statements, runId, result.source, player, timestamp);
      }
    }

    for (const pickValue of normalizedPickValues) {
      writePickValue(statements, runId, result.source, pickValue, timestamp);
    }
  });

  transaction();
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

// @spec DFF-ETL-001
// @spec DFF-ETL-010
// @spec DFF-ETL-011
// @spec DFF-ETL-012
// @spec DFF-ETL-013
export async function runScrapers(options: RunScrapersOptions = {}): Promise<ScraperResult[]> {
  const scrapeKtc = options.scrapeKtc ?? scrapeKtcPlayers;
  const scrapeFantasycalc = options.scrapeFantasycalc ?? scrapeFantasyCalc;
  const scrapeDynastydaddy = options.scrapeDynastydaddy ?? scrapeDynastyDaddy;
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
      () => runScraper('dynastydaddy', scrapeDynastydaddy),
      () => runScraper('rosteraudit', scrapeRosteraudit),
    ],
    2,
  );
}

// @spec DFF-HIST-002
// @spec DFF-HIST-040
// @spec DFF-HIST-041
// @spec DFF-HIST-042
// @spec DFF-HIST-050
// @spec DFF-HIST-051
// @spec DFF-HIST-052
export async function runEtl(options: RunEtlOptions = {}): Promise<number> {
  const timestamp = options.now?.() ?? new Date().toISOString();
  const sqlite = createDatabase(options.databasePath);
  const statements = createStatements(sqlite);
  const runId = randomUUID();

  try {
    console.log('[ETL] Starting ETL run...');
    statements.insertRun.run(runId, timestamp, JSON.stringify(etlSources), JSON.stringify([]));

    const scraperResults = await runScrapers(options);
    const resultBySource = new Map(scraperResults.map((result) => [result.source, result]));
    const ktcResult = resultBySource.get('ktc');

    if (!ktcResult || ktcResult.players.length === 0) {
      console.error('[ETL] ERROR: KTC returned no supported players.');
      return 1;
    }

    const sourcesSucceeded: EtlSource[] = [];

    for (const source of etlSources) {
      const result = resultBySource.get(source);

      if (!result) {
        continue;
      }

      try {
        writeSourceData(sqlite, statements, runId, result, timestamp);
        sourcesSucceeded.push(source);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[ETL] WARN: ${source} write failed — ${message}. Excluding from this run.`);
      }
    }

    statements.updateRunCompletion.run(timestamp, JSON.stringify(sourcesSucceeded), runId);

    console.log('[ETL] Done.');
    return 0;
  } finally {
    sqlite.close();
  }
}

async function main(): Promise<void> {
  const exitCode = await runEtl();
  process.exitCode = exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
