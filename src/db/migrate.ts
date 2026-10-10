// @spec DFF-DATA-097
// @spec DFF-DATA-098
// @spec DFF-DATA-099
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const migrationsTable = '__drizzle_migrations';
const legacySchemaTimestamp = 1779470704872;
const currentSchemaTimestamp = 1791660080858;

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
function baselineLegacyDatabase(sqlite: Database.Database): void {
  if (latestMigrationTimestamp(sqlite) !== undefined) {
    return;
  }

  if (!tableExists(sqlite, 'sleeper_rosters')) {
    throw new DatabaseSchemaError(
      'Database schema is not initialized. Run `npm run db:init` to create a fresh database.',
    );
  }

  createMigrationLedger(sqlite);
  const baselineTimestamp = columnExists(sqlite, 'sleeper_rosters', 'devy_name')
    ? currentSchemaTimestamp
    : legacySchemaTimestamp;
  sqlite
    .prepare(`INSERT INTO ${migrationsTable} (hash, created_at) VALUES (?, ?)`)
    .run('legacy-schema-baseline', baselineTimestamp);
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
    baselineLegacyDatabase(sqlite);
    migrate(drizzle(sqlite), { migrationsFolder: path.resolve(process.cwd(), 'drizzle') });

    if (!columnExists(sqlite, 'sleeper_rosters', 'devy_name')) {
      throw new DatabaseSchemaError(
        'Database schema is out of date. Run `npm run db:migrate`.',
      );
    }
  } finally {
    sqlite.close();
  }

  return databasePath;
}

// @spec DFF-DATA-099
export function assertDatabaseSchemaCurrent(sqlite: Database.Database): void {
  if (
    latestMigrationTimestamp(sqlite) !== currentSchemaTimestamp ||
    !tableExists(sqlite, 'sleeper_rosters') ||
    !columnExists(sqlite, 'sleeper_rosters', 'devy_name')
  ) {
    throw new DatabaseSchemaError('Database schema is out of date. Run `npm run db:migrate`.');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const databasePath = path.resolve(process.cwd(), process.env.DYNASTYFF_DB_PATH ?? 'data/dynastyff.sqlite');
  migrateDatabase(databasePath);
  console.log(`[db:migrate] upgraded schema at ${databasePath}`);
}
