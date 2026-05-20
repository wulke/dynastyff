// @spec DFF-ETL-010
// @spec DFF-ETL-012
// @spec DFF-ETL-013
import { scrapeSourceWithPlaywright } from './shared.js';

const DYNASTYDADDY_URL = 'https://dynasty-daddy.com/rankings';

export async function scrapeDynastyDaddy() {
  return scrapeSourceWithPlaywright({
    fixturePath: process.env.DYNASTYFF_DYNASTYDADDY_FIXTURE_PATH,
    source: 'dynastydaddy',
    url: DYNASTYDADDY_URL,
  });
}
