// @spec DFF-ENGINE-001
// @spec DFF-ENGINE-003
import { resolveDatabasePath } from '../db/init.js';
import { loadStartupArchetypeConfig } from '../draft/archetype-config.js';
import { createDraftApp } from './app.js';
import { resolveApiPort } from './runtime.js';

const port = resolveApiPort();
const databasePath = resolveDatabasePath();
const archetypeConfig = loadStartupArchetypeConfig();
const app = createDraftApp({ databasePath, archetypeConfig });

app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
});
