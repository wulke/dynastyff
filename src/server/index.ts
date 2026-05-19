// @spec DFF-ENGINE-001
// @spec DFF-ENGINE-003
import { resolveDatabasePath } from '../db/init.js';
import { createDraftApp } from './app.js';
import { resolveApiPort } from './runtime.js';

const port = resolveApiPort();
const databasePath = resolveDatabasePath();
const app = createDraftApp({ databasePath });

app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
});
