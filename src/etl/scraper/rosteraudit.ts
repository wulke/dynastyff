// @spec DFF-ETL-010
// @spec DFF-ETL-012
// @spec DFF-ETL-013
import { scrapeSourceWithPlaywright } from './shared.js';

const ROSTERAUDIT_URL = 'https://rosteraudit.com/rankings';

export async function scrapeRosterAudit() {
  return scrapeSourceWithPlaywright({
    fixturePath: process.env.DYNASTYFF_ROSTERAUDIT_FIXTURE_PATH,
    source: 'rosteraudit',
    url: ROSTERAUDIT_URL,
  });
}
