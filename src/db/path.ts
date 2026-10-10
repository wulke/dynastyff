// @spec DFF-DATA-001
// @spec DFF-DATA-010
// @spec DFF-DATA-020
import path from 'node:path';

export const defaultDatabasePath = path.resolve(process.cwd(), 'data', 'dynastyff.sqlite');

// @spec DFF-DATA-001
// @spec DFF-DATA-010
// @spec DFF-DATA-020
export function resolveDatabasePath(inputPath = process.env.DYNASTYFF_DB_PATH): string {
  return inputPath ? path.resolve(process.cwd(), inputPath) : defaultDatabasePath;
}
