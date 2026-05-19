// @spec DFF-DATA-001
// @spec DFF-DATA-002
// @spec DFF-DATA-010
// @spec DFF-DATA-020
// @spec DFF-DATA-021
// @spec DFF-DATA-022
// @spec DFF-DATA-030
// @spec DFF-DATA-033
// @spec DFF-DATA-040
// @spec DFF-DATA-050
// @spec DFF-DATA-051
// @spec DFF-DATA-060
// @spec DFF-DATA-070
// @spec DFF-DATA-080
// @spec DFF-DATA-081
// @spec DFF-DATA-090
// @spec DFF-HIST-001
// @spec DFF-HIST-010
// @spec DFF-HIST-011
// @spec DFF-HIST-012
// @spec DFF-HIST-020
// @spec DFF-HIST-021
// @spec DFF-HIST-022
// @spec DFF-HIST-030
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export const defaultDatabasePath = path.resolve(process.cwd(), 'data', 'dynastyff.sqlite');

export function resolveDatabasePath(inputPath = process.env.DYNASTYFF_DB_PATH): string {
  return inputPath ? path.resolve(process.cwd(), inputPath) : defaultDatabasePath;
}

export function initializeDatabase(databasePath = resolveDatabasePath()): string {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  fs.rmSync(databasePath, { force: true });
  fs.rmSync(`${databasePath}-shm`, { force: true });
  fs.rmSync(`${databasePath}-wal`, { force: true });

  execFileSync(
    path.resolve(process.cwd(), 'node_modules', '.bin', 'drizzle-kit'),
    ['push', '--config=drizzle.config.ts', '--force'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DYNASTYFF_DB_PATH: databasePath,
      },
      stdio: 'pipe',
    },
  );

  const sqlite = new Database(databasePath);

  try {
    sqlite.exec(`
      CREATE TRIGGER IF NOT EXISTS picks_immutable_update
      BEFORE UPDATE ON picks
      BEGIN
        SELECT RAISE(ABORT, 'picks are immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS picks_immutable_delete
      BEFORE DELETE ON picks
      BEGIN
        SELECT RAISE(ABORT, 'picks are immutable');
      END;
    `);
  } finally {
    sqlite.close();
  }

  return databasePath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const databasePath = initializeDatabase();
  console.log(`[db:init] initialized schema at ${databasePath}`);
}
