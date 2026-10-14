// @spec DFF-DATA-097
// @spec DFF-DATA-098
// @spec DFF-DATA-099
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { resolveDatabasePath } from './path.js';

const migrationsTable = '__drizzle_migrations';
const legacySchemaTimestamp = 1779470704872;
const legacyDevySchemaTimestamp = 1791660080858;
const databaseDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(databaseDirectory, '../../drizzle');
const migrationJournalPath = path.join(migrationsFolder, 'meta', '_journal.json');
let cachedCurrentMigrationTimestamp: number | undefined;

type MigrationJournal = {
  entries: Array<{ when: number }>;
};

// @spec DFF-DATA-099
export class DatabaseSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseSchemaError';
  }
}

// @spec DFF-DATA-097
function tableExists(sqlite: Database.Database, tableName: string): boolean {
  return Boolean(
    sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName),
  );
}

// @spec DFF-DATA-097
function columnExists(sqlite: Database.Database, tableName: string, columnName: string): boolean {
  return (sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).some(
    (column) => column.name === columnName,
  );
}

// @spec DFF-DATA-097
function createMigrationLedger(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ${migrationsTable} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    )
  `);
}

// @spec DFF-DATA-097
function currentMigrationTimestamp(): number {
  if (cachedCurrentMigrationTimestamp !== undefined) {
    return cachedCurrentMigrationTimestamp;
  }

  const journal = JSON.parse(fs.readFileSync(migrationJournalPath, 'utf8')) as MigrationJournal;
  const latestTimestamp = Math.max(...journal.entries.map((entry) => entry.when));
  if (!Number.isFinite(latestTimestamp)) {
    throw new DatabaseSchemaError('No database migrations are configured.');
  }

  cachedCurrentMigrationTimestamp = latestTimestamp;
  return cachedCurrentMigrationTimestamp;
}

// @spec DFF-DATA-097
function latestMigrationTimestamp(sqlite: Database.Database): number | undefined {
  if (!tableExists(sqlite, migrationsTable)) {
    return undefined;
  }

  const row = sqlite
    .prepare(`SELECT created_at FROM ${migrationsTable} ORDER BY created_at DESC LIMIT 1`)
    .get() as { created_at: number } | undefined;
  return row?.created_at;
}

// @spec DFF-DATA-097
function baselineLegacyDatabase(sqlite: Database.Database): boolean {
  if (latestMigrationTimestamp(sqlite) !== undefined) {
    return false;
  }

  if (!tableExists(sqlite, 'sleeper_rosters')) {
    throw new DatabaseSchemaError(
      'Database schema is not initialized. Run `npm run db:init` to create a fresh database.',
    );
  }

  createMigrationLedger(sqlite);
  const baselineTimestamp = columnExists(sqlite, 'sleeper_rosters', 'devy_name')
    ? legacyDevySchemaTimestamp
    : legacySchemaTimestamp;
  sqlite
    .prepare(`INSERT INTO ${migrationsTable} (hash, created_at) VALUES (?, ?)`)
    .run('legacy-schema-baseline', baselineTimestamp);
  return true;
}

// @spec DFF-DATA-100
export function markDatabaseSchemaCurrent(databasePath: string): void {
  const sqlite = new Database(databasePath);
  try {
    createMigrationLedger(sqlite);
    sqlite
      .prepare(`INSERT INTO ${migrationsTable} (hash, created_at) VALUES (?, ?)`)
      .run('fresh-schema-baseline', currentMigrationTimestamp());
  } finally {
    sqlite.close();
  }
}

// @spec DFF-DATA-097
// @spec DFF-DATA-098
export function migrateDatabase(databasePath: string): string {
  if (!fs.existsSync(databasePath)) {
    throw new DatabaseSchemaError(
      'Database schema is not initialized. Run `npm run db:init` to create a fresh database.',
    );
  }

  const sqlite = new Database(databasePath);
  sqlite.pragma('foreign_keys = ON');

  try {
    const insertedLegacyBaseline = baselineLegacyDatabase(sqlite);
    try {
      migrate(drizzle(sqlite), { migrationsFolder });
    } catch (error) {
      if (insertedLegacyBaseline) {
        sqlite.prepare(`DELETE FROM ${migrationsTable} WHERE hash = ?`).run('legacy-schema-baseline');
      }
      throw error;
    }
  } finally {
    sqlite.close();
  }

  return databasePath;
}

// @spec DFF-DATA-099
export function assertDatabaseSchemaCurrent(sqlite: Database.Database): void {
  const latestAppliedMigration = latestMigrationTimestamp(sqlite);
  // Partial-schema fixtures retain their component-specific diagnostics; a real legacy database has sleeper_rosters.
  if (latestAppliedMigration === undefined && !tableExists(sqlite, 'sleeper_rosters')) {
    return;
  }

  if (latestAppliedMigration === undefined || latestAppliedMigration < currentMigrationTimestamp()) {
    throw new DatabaseSchemaError('Database schema is out of date. Run `npm run db:migrate`.');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const databasePath = resolveDatabasePath();
  migrateDatabase(databasePath);
  console.log(`[db:migrate] upgraded schema at ${databasePath}`);
}
