// Probe: condensed dump of KTC devy playersArray
import { chromium } from 'playwright';

const URL = 'https://keeptradecut.com/devy-rankings';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 });

  const probe = await page.evaluate(() => {
    const players = globalThis.playersArray;
    if (!Array.isArray(players) || players.length === 0) {
      return { found: false };
    }
    const positions = {};
    const keyUnion = new Set();
    for (const p of players) {
      const pos = String(p.position || '?').toUpperCase();
      positions[pos] = (positions[pos] || 0) + 1;
      for (const k of Object.keys(p)) keyUnion.add(k);
    }
    const first = players[0];
    const trim = (o) => {
      const out = {};
      for (const [k, v] of Object.entries(o)) {
        if (Array.isArray(v)) out[k] = `[array x${v.length}]`;
        else if (v && typeof v === 'object') out[k] = trim(v);
        else out[k] = v;
      }
      return out;
    };
    const wrs = players
      .filter((p) => String(p.position || '').toUpperCase() === 'WR')
      .map((p) => ({
        name: p.playerName,
        team: p.team,
        teamLongName: p.teamLongName,
        draftYear: p.draftYear,
        value: p.superflexValues?.value ?? p.value,
        posRank: p.superflexValues?.positionalRank ?? p.positionalRank,
      }));
    return {
      found: true,
      total: players.length,
      positions,
      keyUnion: Array.from(keyUnion),
      sampleFirstTrimmed: trim(first),
      wrCount: wrs.length,
      wrs,
    };
  });

  console.log(JSON.stringify(probe, null, 2));
} finally {
  await browser.close();
}
