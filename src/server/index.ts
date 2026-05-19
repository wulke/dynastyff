// @spec DFF-ENGINE-001
// @spec DFF-ENGINE-003
import { resolveDatabasePath } from '../db/init.js';
import { createDraftServer } from './app.js';

const port = Number.parseInt(process.env.DYNASTYFF_API_PORT ?? process.env.PORT ?? '3001', 10);
const databasePath = resolveDatabasePath();
const server = createDraftServer({ databasePath });

server.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
});
