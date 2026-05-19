// @spec DFF-ETL-010
// @spec DFF-ETL-012
// @spec DFF-ETL-013
import { scrapeSourceWithPlaywright } from './shared.js';

const FANTASYCALC_URL = 'https://fantasycalc.com/rankings/dynasty';

export async function scrapeFantasyCalc() {
  return scrapeSourceWithPlaywright({
    fixturePath: process.env.DYNASTYFF_FANTASYCALC_FIXTURE_PATH,
    source: 'fantasycalc',
    url: FANTASYCALC_URL,
  });
}
