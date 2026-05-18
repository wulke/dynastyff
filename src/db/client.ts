// @spec DFF-DATA-001
// @spec DFF-DATA-010
// @spec DFF-DATA-020
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema.js';
import { resolveDatabasePath } from './init.js';

export function createDatabase(databasePath = resolveDatabasePath()): Database.Database {
  const sqlite = new Database(databasePath);
  sqlite.pragma('foreign_keys = ON');
  return sqlite;
}

export function createDrizzleDb(databasePath = resolveDatabasePath()) {
  const sqlite = createDatabase(databasePath);

  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
  };
}
