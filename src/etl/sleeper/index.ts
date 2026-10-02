// @spec DFF-SLS-001
// CLI entry point for `npm run sync:sleeper` — runs the Sleeper sync step in
// isolation, without the scraper pipeline.
import { runSleeperSync } from './sync.js';

async function main(): Promise<void> {
  const result = await runSleeperSync();
  process.exitCode = result.skipped || result.outcomes.every((outcome) => outcome.ok) ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
