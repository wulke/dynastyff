// @spec DFF-ENGINE-001
// @spec DFF-ENGINE-003
import { resolveDatabasePath } from '../db/init.js';
import { createDraftServer } from './app.js';
import { resolveApiPort } from './runtime.js';

const port = resolveApiPort();
const databasePath = resolveDatabasePath();
const server = createDraftServer({ databasePath });

server.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
});
