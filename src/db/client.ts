// @spec DFF-DATA-001
// @spec DFF-DATA-010
// @spec DFF-DATA-020
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema.js';
import { resolveDatabasePath } from './path.js';
import { assertDatabaseSchemaCurrent, DatabaseSchemaError } from './migrate.js';

// @spec DFF-DATA-099
export function createDatabase(databasePath?: string): Database.Database {
  const resolvedDatabasePath = databasePath ?? resolveDatabasePath();
  if (!fs.existsSync(resolvedDatabasePath)) {
    throw new DatabaseSchemaError(
      'Database schema is not initialized. Run `npm run db:init` to create a fresh database.',
    );
  }

  const sqlite = new Database(resolvedDatabasePath);
  sqlite.pragma('foreign_keys = ON');
  try {
    assertDatabaseSchemaCurrent(sqlite);
    return sqlite;
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

// @spec DFF-DATA-099
export function createDrizzleDb(databasePath?: string) {
  const sqlite = createDatabase(databasePath);

  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
  };
}
