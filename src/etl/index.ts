// @spec DFF-ETL-001
// @spec DFF-ETL-010
// @spec DFF-ETL-011
// @spec DFF-ETL-012
// @spec DFF-ETL-013
// @spec DFF-ETL-030
// @spec DFF-ETL-031
// @spec DFF-ETL-032
// @spec DFF-ETL-090
// @spec DFF-ETL-041
// @spec DFF-ETL-070
// @spec DFF-ETL-071
// @spec DFF-HIST-002
// @spec DFF-HIST-040
// @spec DFF-HIST-041
// @spec DFF-HIST-050
// @spec DFF-HIST-051
// @spec DFF-HIST-052
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type Database from 'better-sqlite3';

import { createDatabase } from '../db/client.js';
import {
  createNormalizationContext,
  normalizePickValues,
  normalizePlayers,
  normalizeRawValue,
  type NormalizationContext,
} from './normalize.js';
import {
  computeAggregatedDynastyValue,
  createUnmatchedPlayerWarning,
  loadAliasFamilies,
  matchPlayerCandidate,
  type AliasFamily,
  type PlayerMatchCandidate,
} from './player-matching.js';
import { scrapeFantasyCalc } from './scraper/fantasycalc.js';
import { scrapeKtcPlayers } from './scraper/ktc.js';
import { scrapeRosterAudit } from './scraper/rosteraudit.js';
import { type EtlSource, type NormalizedPickValue, type NormalizedPlayer, type RawPlayer, type ScraperResult } from './types.js';

type RunEtlOptions = {
  databasePath?: string;
  aliasesPath?: string;
  scrapeKtc?: () => Promise<ScraperResult>;
  scrapeFantasycalc?: () => Promise<ScraperResult>;
  scrapeRosteraudit?: () => Promise<ScraperResult>;
  now?: () => string;
};

type RunScrapersOptions = Pick<
  RunEtlOptions,
  'scrapeKtc' | 'scrapeFantasycalc' | 'scrapeRosteraudit'
>;

const activeEtlSources = ['ktc', 'fantasycalc', 'rosteraudit'] as const satisfies readonly EtlSource[];

type PlayerIdRow = { id: string };
type PickValueIdRow = { id: string };
type PickValueSnapshotRow = { source: EtlSource; rawValue: number };
type ScraperRunOutcome =
  | { source: EtlSource; ok: true; result: ScraperResult }
  | { source: EtlSource; ok: false; error: unknown };

type PlayerRow = PlayerMatchCandidate;

type EtlStatements = {
  insertRun: Database.Statement;
  updateRunCompletion: Database.Statement;
  selectPlayersByPosition: Database.Statement<[string], PlayerRow>;
  insertPlayer: Database.Statement;
  updateKtcPlayer: Database.Statement;
  updateFantasycalcPlayer: Database.Statement;
  updateDynastydaddyPlayer: Database.Statement;
  updateRosterauditPlayer: Database.Statement;
  insertPlayerSnapshot: Database.Statement;
  selectPickValueId: Database.Statement<[number, number, number], PickValueIdRow | undefined>;
  selectRunPickSnapshots: Database.Statement<[string, number, number, number], PickValueSnapshotRow>;
  insertPickValue: Database.Statement;
  updatePickValue: Database.Statement;
  insertPickSnapshot: Database.Statement;
};

// @spec DFF-ETL-002
function isMissingEtlRunsTableError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'SQLITE_ERROR' &&
    error.message.includes('no such table: etl_runs')
  );
}

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
    selectPlayersByPosition: sqlite.prepare(
      `SELECT
         id,
         name,
         position,
         nfl_team AS nflTeam,
         age,
         is_rookie AS isRookie,
         adp,
         value_ktc AS valueKtc,
         value_fantasycalc AS valueFantasycalc,
         value_dynastydaddy AS valueDynastydaddy,
         value_rosteraudit AS valueRosteraudit
       FROM players
       WHERE position = ?`,
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
       SET name = ?,
           nfl_team = ?,
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
       SET dynasty_value = ?,
           value_fantasycalc = ?,
           adp = ?,
           updated_at = ?
       WHERE id = ?`,
    ),
    updateDynastydaddyPlayer: sqlite.prepare(
      `UPDATE players
       SET dynasty_value = ?,
           value_dynastydaddy = ?,
           adp = ?,
           updated_at = ?
       WHERE id = ?`,
    ),
    updateRosterauditPlayer: sqlite.prepare(
      `UPDATE players
       SET dynasty_value = ?,
           value_rosteraudit = ?,
           adp = ?,
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
       WHERE year = ? AND round = ? AND pick_in_round = ?`,
    ),
    selectRunPickSnapshots: sqlite.prepare(
      `SELECT
         source,
         raw_value AS rawValue
       FROM pick_value_snapshots
       WHERE run_id = ? AND year = ? AND round = ? AND pick_in_round = ?`,
    ),
    insertPickValue: sqlite.prepare(
      `INSERT INTO pick_values (
        id, year, round, pick_in_round, dynasty_value, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    updatePickValue: sqlite.prepare(
      `UPDATE pick_values
       SET dynasty_value = ?, updated_at = ?
       WHERE id = ?`,
    ),
    insertPickSnapshot: sqlite.prepare(
      `INSERT INTO pick_value_snapshots (
        id, run_id, year, round, pick_in_round, source, raw_value
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
  };
}

// @spec DFF-SPKV-002
// @spec DFF-SPKV-031
// @spec DFF-SPKV-032
function resolvePickInRound(pickValue: Pick<NormalizedPickValue, 'pickInRound'>): number {
  return pickValue.pickInRound ?? 0;
}

// @spec DFF-SPKV-035
function getCurrentCalendarYear(timestamp: string): number {
  return new Date(timestamp).getUTCFullYear();
}

// @spec DFF-SPKV-035
function hasCurrentYearStartupPickValues(
  results: readonly ScraperResult[],
  currentYear: number,
): boolean {
  return results.some((result) =>
    result.pickValues.some((pickValue) => pickValue.year === currentYear && (pickValue.pickInRound ?? 0) >= 1),
  );
}

function getPlayerCandidates(
  statements: EtlStatements,
  position: string,
): PlayerRow[] {
  return statements.selectPlayersByPosition.all(position);
}

function matchExistingPlayer(
  statements: EtlStatements,
  player: NormalizedPlayer,
  aliasFamilies: AliasFamily[],
): PlayerRow | undefined {
  return matchPlayerCandidate(player.name, getPlayerCandidates(statements, player.position), aliasFamilies);
}

// @spec DFF-ETL-040
// @spec DFF-ETL-060
// @spec DFF-ETL-061
// @spec DFF-ETL-053
function writeKtcPlayer(
  statements: EtlStatements,
  runId: string,
  player: NormalizedPlayer,
  timestamp: string,
  aliasFamilies: AliasFamily[],
): void {
  const existing = matchExistingPlayer(statements, player, aliasFamilies);
  const playerId = existing?.id ?? randomUUID();

  if (existing) {
    const dynastyValue = computeAggregatedDynastyValue([
      player.normalizedValue,
      existing.valueFantasycalc,
      existing.valueDynastydaddy,
      existing.valueRosteraudit,
    ]);

    statements.updateKtcPlayer.run(
      player.name,
      player.nflTeam,
      player.age,
      player.isRookie ? 1 : 0,
      dynastyValue,
      player.normalizedValue,
      player.adp ?? existing.adp,
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

// @spec DFF-ETL-023
// @spec DFF-ETL-040
// @spec DFF-ETL-060
// @spec DFF-ETL-053
function writeMatchedSourcePlayer(
  statements: EtlStatements,
  runId: string,
  source: Exclude<EtlSource, 'ktc'>,
  player: NormalizedPlayer,
  timestamp: string,
  aliasFamilies: AliasFamily[],
): void {
  const existing = matchExistingPlayer(statements, player, aliasFamilies);

  if (!existing) {
    console.warn(createUnmatchedPlayerWarning(source, player.name, player.position));
    return;
  }

  const dynastyValue =
    source === 'fantasycalc'
      ? computeAggregatedDynastyValue([
          existing.valueKtc,
          player.normalizedValue,
          existing.valueDynastydaddy,
          existing.valueRosteraudit,
        ])
      : source === 'dynastydaddy'
        ? computeAggregatedDynastyValue([
            existing.valueKtc,
            existing.valueFantasycalc,
            player.normalizedValue,
            existing.valueRosteraudit,
          ])
        : computeAggregatedDynastyValue([
            existing.valueKtc,
            existing.valueFantasycalc,
            existing.valueDynastydaddy,
            player.normalizedValue,
          ]);

  if (source === 'fantasycalc') {
    statements.updateFantasycalcPlayer.run(
      dynastyValue,
      player.normalizedValue,
      player.adp ?? existing.adp,
      timestamp,
      existing.id,
    );
  } else if (source === 'dynastydaddy') {
    statements.updateDynastydaddyPlayer.run(
      dynastyValue,
      player.normalizedValue,
      player.adp ?? existing.adp,
      timestamp,
      existing.id,
    );
  } else {
    statements.updateRosterauditPlayer.run(
      dynastyValue,
      player.normalizedValue,
      player.adp ?? existing.adp,
      timestamp,
      existing.id,
    );
  }

  statements.insertPlayerSnapshot.run(randomUUID(), runId, existing.id, source, player.rawValue);
}

// @spec DFF-ETL-031
function buildPickValueNormalizationContexts(
  result: ScraperResult,
  contexts: Map<EtlSource, NormalizationContext>,
): void {
  const context = createNormalizationContext(result.pickValues);

  if (context) {
    contexts.set(result.source, context);
  }
}

// @spec DFF-ETL-041
// @spec DFF-SPKV-031
function computePickValueDynastyValue(
  statements: EtlStatements,
  runId: string,
  year: number,
  round: number,
  pickInRound: number,
  normalizationContexts: Map<EtlSource, NormalizationContext>,
): number {
  const snapshots = statements.selectRunPickSnapshots.all(
    runId,
    year,
    round,
    pickInRound,
  ) as PickValueSnapshotRow[];
  const normalizedValues = snapshots.flatMap((snapshot) => {
    const context = normalizationContexts.get(snapshot.source);

    if (!context) {
      return [];
    }

    return [normalizeRawValue(snapshot.rawValue, context)];
  });

  return Math.round(
    normalizedValues.reduce((sum, value) => sum + value, 0) / normalizedValues.length,
  );
}

// @spec DFF-ETL-041
// @spec DFF-ETL-070
// @spec DFF-ETL-071
// @spec DFF-SPKV-031
// @spec DFF-SPKV-032
function writePickValue(
  statements: EtlStatements,
  runId: string,
  source: EtlSource,
  pickValue: NormalizedPickValue,
  timestamp: string,
  normalizationContexts: Map<EtlSource, NormalizationContext>,
): void {
  const pickInRound = resolvePickInRound(pickValue);

  statements.insertPickSnapshot.run(
    randomUUID(),
    runId,
    pickValue.year,
    pickValue.round,
    pickInRound,
    source,
    pickValue.rawValue,
  );

  const dynastyValue = computePickValueDynastyValue(
    statements,
    runId,
    pickValue.year,
    pickValue.round,
    pickInRound,
    normalizationContexts,
  );
  const existing = statements.selectPickValueId.get(pickValue.year, pickValue.round, pickInRound);

  if (existing) {
    statements.updatePickValue.run(dynastyValue, timestamp, existing.id);
  } else {
    statements.insertPickValue.run(
      randomUUID(),
      pickValue.year,
      pickValue.round,
      pickInRound,
      dynastyValue,
      timestamp,
    );
  }
}

function writeSourceData(
  sqlite: Database.Database,
  statements: EtlStatements,
  runId: string,
  result: ScraperResult,
  timestamp: string,
  aliasFamilies: AliasFamily[],
  normalizationContexts: Map<EtlSource, NormalizationContext>,
): void {
  const normalizedPlayers = normalizePlayers(result.players, {
    source: result.source,
    valueType: 'player',
    warn: (message) => console.warn(message),
  });
  const normalizedPickValues = normalizePickValues(result.pickValues, {
    source: result.source,
    valueType: 'pick value',
    warn: (message) => console.warn(message),
  });

  const transaction = sqlite.transaction(() => {
    for (const player of normalizedPlayers) {
      if (result.source === 'ktc') {
        writeKtcPlayer(statements, runId, player, timestamp, aliasFamilies);
      } else {
        writeMatchedSourcePlayer(statements, runId, result.source, player, timestamp, aliasFamilies);
      }
    }

    for (const pickValue of normalizedPickValues) {
      writePickValue(
        statements,
        runId,
        result.source,
        pickValue,
        timestamp,
        normalizationContexts,
      );
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
  source: EtlSource,
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
// @spec DFF-ETL-090
// @spec DFF-ETL-015
// @spec DFF-ETL-050
export async function runScrapers(options: RunScrapersOptions = {}): Promise<ScraperResult[]> {
  const scrapeKtc = options.scrapeKtc ?? scrapeKtcPlayers;
  const scrapeFantasycalc = options.scrapeFantasycalc ?? scrapeFantasyCalc;
  const scrapeRosteraudit = options.scrapeRosteraudit ?? scrapeRosterAudit;

  const outcomes = await runTasksWithConcurrencyLimit(
    [
      async (): Promise<ScraperRunOutcome> => {
        try {
          return { source: 'ktc', ok: true, result: await runScraper('ktc', scrapeKtc) };
        } catch (error) {
          return { source: 'ktc', ok: false, error };
        }
      },
      async (): Promise<ScraperRunOutcome> => {
        try {
          return {
            source: 'fantasycalc',
            ok: true,
            result: await runScraper('fantasycalc', scrapeFantasycalc),
          };
        } catch (error) {
          return { source: 'fantasycalc', ok: false, error };
        }
      },
      async (): Promise<ScraperRunOutcome> => {
        try {
          return {
            source: 'rosteraudit',
            ok: true,
            result: await runScraper('rosteraudit', scrapeRosteraudit),
          };
        } catch (error) {
          return { source: 'rosteraudit', ok: false, error };
        }
      },
    ],
    2,
  );

  const results: ScraperResult[] = [];

  for (const outcome of outcomes) {
    if (outcome.ok) {
      results.push(outcome.result);
      continue;
    }

    const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
    console.warn(`[ETL] WARN: ${outcome.source} scraper failed — ${message}. Excluding from this run.`);
  }

  return results;
}

// @spec DFF-HIST-002
// @spec DFF-HIST-040
// @spec DFF-HIST-041
// @spec DFF-HIST-042
// @spec DFF-HIST-050
// @spec DFF-HIST-051
// @spec DFF-HIST-052
// @spec DFF-ETL-051
// @spec DFF-ETL-052
export async function runEtl(options: RunEtlOptions = {}): Promise<number> {
  const timestamp = options.now?.() ?? new Date().toISOString();
  const currentYear = getCurrentCalendarYear(timestamp);
  const sqlite = createDatabase(options.databasePath);
  const runId = randomUUID();

  try {
    const aliasFamilies = loadAliasFamilies(
      options.aliasesPath ?? path.resolve(process.cwd(), 'player-aliases.json'),
    );
    const statements = createStatements(sqlite);

    console.log('[ETL] Starting ETL run...');
    const scraperResults = await runScrapers(options);

    if (scraperResults.length === 0) {
      console.error('[ETL] ERROR: all scrapers failed. No data was written.');
      return 1;
    }

    statements.insertRun.run(runId, timestamp, JSON.stringify(activeEtlSources), JSON.stringify([]));

    const resultBySource = new Map(scraperResults.map((result) => [result.source, result]));
    const pickValueNormalizationContexts = new Map<EtlSource, NormalizationContext>();
    const ktcResult = resultBySource.get('ktc');

    if (ktcResult && ktcResult.players.length === 0) {
      console.error('[ETL] ERROR: KTC returned no supported players.');
      return 1;
    }

    const sourcesSucceeded: EtlSource[] = [];

    for (const source of activeEtlSources) {
      const result = resultBySource.get(source);

      if (!result) {
        continue;
      }

      buildPickValueNormalizationContexts(result, pickValueNormalizationContexts);

      try {
        writeSourceData(
          sqlite,
          statements,
          runId,
          result,
          timestamp,
          aliasFamilies,
          pickValueNormalizationContexts,
        );
        sourcesSucceeded.push(source);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[ETL] WARN: ${source} write failed — ${message}. Excluding from this run.`);
      }
    }

    statements.updateRunCompletion.run(timestamp, JSON.stringify(sourcesSucceeded), runId);

    const successfulResults = scraperResults.filter((result) => sourcesSucceeded.includes(result.source));
    if (!hasCurrentYearStartupPickValues(successfulResults, currentYear)) {
      console.warn(
        `[ETL] WARN: no startup pick values were written for ${currentYear}. Re-run ETL before starting a draft.`,
      );
    }

    console.log('[ETL] Done.');
    return 0;
  } finally {
    sqlite.close();
  }
}

// @spec DFF-ETL-083
function isAliasConfigurationError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('[ETL] ERROR: aliases file');
}

// @spec DFF-ETL-002
async function main(): Promise<void> {
  try {
    const exitCode = await runEtl();
    process.exitCode = exitCode;
  } catch (error) {
    if (isMissingEtlRunsTableError(error)) {
      // @spec DFF-ETL-002
      console.error(
        '[ETL] ERROR: database schema is missing ETL history tables. Run `npm run db:init` to recreate the local SQLite database with the latest schema.',
      );
      process.exitCode = 1;
      return;
    }

    if (isAliasConfigurationError(error)) {
      console.error((error as Error).message);
      process.exitCode = 1;
      return;
    }

    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
