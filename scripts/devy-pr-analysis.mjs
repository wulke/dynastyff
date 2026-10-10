// Devy WR punt-return analysis (scratch analysis script, not app code)
//
// 1. Scrape KTC devy rankings (Playwright) -> WR universe with school + value.
// 2. For each school-season (2023-2025), fetch the Wayback-Machine-archived
//    Sports Reference CFB school page and parse the kick_return_standard table
//    (contains per-player Punt Returns: Ret / Yds / Y-Ret / TD).
// 3. Match KTC names to SR rows, aggregate career PR stats at current school
//    (+ hand-curated prior schools for known transfers), write CSV + Markdown.
//
// Cached under data/cache/sr-cfb so re-runs are cheap.

import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const SEASONS = [2023, 2024, 2025];
const CACHE_DIR = path.resolve('data/cache/sr-cfb');
const OUT_DIR = path.resolve('data/analysis');
const KTC_URL = 'https://keeptradecut.com/devy-rankings';
const ARCHIVE_DELAY_MS = 1500;

// KTC teamLongName -> Sports Reference CFB school slug
const SCHOOL_SLUGS = {
  'Ohio State Buckeyes': 'ohio-state',
  'Texas Longhorns': 'texas',
  'Miami Hurricanes': 'miami-fl',
  'Alabama Crimson Tide': 'alabama',
  'Oregon Ducks': 'oregon',
  'Indiana Hoosiers': 'indiana',
  'Clemson Tigers': 'clemson',
  'South Carolina Gamecocks': 'south-carolina',
  'LSU Tigers': 'louisiana-state',
  'Florida Gators': 'florida',
  'Texas A&M Aggies': 'texas-am',
  'Notre Dame Fighting Irish': 'notre-dame',
  'Oklahoma Sooners': 'oklahoma',
  'Michigan Wolverines': 'michigan',
  'Georgia Bulldogs': 'georgia',
  'Texas Tech Red Raiders': 'texas-tech',
  'Kentucky Wildcats': 'kentucky',
  'Colorado Buffaloes': 'colorado',
  'Ole Miss Rebels': 'mississippi',
  'Western Illinois Leathernecks': 'western-illinois',
  'Florida State Seminoles': 'florida-state',
  'NC State Wolfpack': 'north-carolina-state',
  'Minnesota Golden Gophers': 'minnesota',
  // prior schools referenced below
  auburn: 'auburn',
  'michigan-state': 'michigan-state',
  'georgia-tech': 'georgia-tech',
  oklahoma: 'oklahoma',
  'miami-fl': 'miami-fl',
  'kansas-state': 'kansas-state',
  florida: 'florida',
  connecticut: 'connecticut',
  pittsburgh: 'pittsburgh',
  arkansas: 'arkansas',
  'southern-california': 'southern-california',
};

// Known transfers (manual, best-effort): KTC name -> SR slugs of prior schools.
// A wrong guess simply yields no matching rows (flagged, never fabricated).
const PRIOR_SCHOOLS = {
  'Cam Coleman': ['auburn'],
  'Nick Marsh': ['michigan-state'],
  'Eric Singleton Jr.': ['georgia-tech'],
  'Nic Anderson': ['oklahoma'],
  'Isaiah Horton': ['miami-fl'],
  'Jayce Brown': ['kansas-state'],
  'Eugene Wilson III': ['florida'],
  'Cam Edwards': ['connecticut'],
  'Joshisa Trader': ['miami-fl'],
  'Kenny Johnson': ['pittsburgh'],
  'Isaiah Sategna III': ['arkansas'],
  'Duce Robinson': ['southern-california'],
  'Quincy Porter': ['oregon'],
};

// KTC normalized name -> SR normalized name when the listings differ
const NAME_ALIASES = {
  'joshisa trader': ['jojo trader', 'joshisa trader'],
};

// Players already drafted in this league's devy draft (KTC names) — excluded from outputs.
// Update as the draft progresses, then re-run (fast; everything is cached).
const DRAFTED = new Set([
  'Jeremiah Smith',
  'Malachi Toney',
  'Dakorien Moore',
  'Bryant Wesco Jr.',
  'Andrew Marsh',
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 30_000;
const fetchWithTimeout = (url, opts = {}) => fetch(url, { ...opts, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

const SUFFIX_RE = /^(jr|sr|ii|iii|iv|v)$/;
function normName(raw) {
  return decodeEntities(String(raw))
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.'’`]/g, '')
    .replace(/[^a-z\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !SUFFIX_RE.test(w))
    .join(' ');
}

async function scrapeKtcWrs() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(KTC_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    return await page.evaluate(() =>
      (globalThis.playersArray ?? [])
        .filter((p) => String(p.position || '').toUpperCase() === 'WR')
        .map((p) => ({
          name: p.playerName,
          team: p.team,
          teamLongName: p.teamLongName,
          draftYear: p.draftYear,
          value: p.superflexValues?.value ?? p.value,
          posRank: p.superflexValues?.positionalRank ?? p.positionalRank,
          height: p.heightFeet ? `${p.heightFeet}-${p.heightInches}` : null,
          weight: p.weight ?? null,
        })),
    );
  } finally {
    await browser.close();
  }
}

// Find the latest Wayback capture after the season concluded (final stats).
// Falls back to the latest in-season capture, flagged partial. Uses the CDX API
// (the availability API misses captures that definitely exist).
// CDX results cached in data/cache/sr-cfb/cdx.json so re-runs don't re-query
async function loadCdxCache() {
  try {
    return JSON.parse(await fs.readFile(path.join(CACHE_DIR, 'cdx.json'), 'utf8'));
  } catch {
    return {};
  }
}

async function waybackSnapshotUrl(slug, season, cdxCache) {
  const target = `sports-reference.com/cfb/schools/${slug}/${season}.html`;

  async function cdx(from) {
    const url =
      `http://web.archive.org/cdx/search/cdx?url=${target}&output=json` +
      `&from=${from}0101&filter=statuscode:200&limit=-1`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchWithTimeout(url, { headers: { 'User-Agent': UA } });
        if (!res.ok) throw new Error(`cdx ${res.status}`);
        const json = await res.json();
        if (!Array.isArray(json) || json.length < 2) return [];
        return json.slice(1).map((r) => r[1]); // timestamp column
      } catch (err) {
        if (attempt === 1) {
          console.warn(`      cdx failed for ${slug} ${season} (${from}): ${err.message}`);
          return [];
        }
        await sleep(3000);
      }
    }
    return [];
  }

  if (cdxCache[`${slug}|${season}|post`]) {
    return { url: cdxCache[`${slug}|${season}|post`], partial: false };
  }
  if (cdxCache[`${slug}|${season}|pre`]) {
    return { url: cdxCache[`${slug}|${season}|pre`], partial: true };
  }

  const postSeason = await cdx(String(season + 1));
  if (postSeason.length > 0) {
    const url = `https://web.archive.org/web/${postSeason[postSeason.length - 1]}id_/https://${target}`;
    cdxCache[`${slug}|${season}|post`] = url;
    return { url, partial: false };
  }
  const inSeason = await cdx(String(season));
  if (inSeason.length > 0) {
    const url = `https://web.archive.org/web/${inSeason[inSeason.length - 1]}id_/https://${target}`;
    cdxCache[`${slug}|${season}|pre`] = url;
    return { url, partial: true };
  }
  cdxCache[`${slug}|${season}|none`] = true;
  return null;
}

async function persistCdxCache(cdxCache) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(path.join(CACHE_DIR, 'cdx.json'), JSON.stringify(cdxCache, null, 2));
}

async function fetchSchoolSeason(slug, season, cdxCache) {
  const cachePath = path.join(CACHE_DIR, `${slug}-${season}.html`);
  try {
    const cached = await fs.readFile(cachePath, 'utf8');
    return { html: cached, cached: true, partial: false };
  } catch {
    /* fetch below */
  }
  const snap = await waybackSnapshotUrl(slug, season, cdxCache);
  if (!snap) return null;
  const res = await fetchWithTimeout(snap.url, {
    headers: { 'User-Agent': UA },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`fetch ${res.status} ${slug} ${season}`);
  const html = await res.text();
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cachePath, html);
  return { html, cached: false, partial: snap.partial };
}

// Parse the "Kick & Punt Returns" table. Two SR layouts exist:
//   New (2024+ pages): id="kick_return_standard"
//     Rk|Player|Pos|G|KR Ret|KR Yds|KR Y/Ret|KR TD|PR Ret|PR Yds|PR Y/Ret|PR TD|APYd|Awards
//   Old (2023 pages): id="returns"
//     Rk|Player|G|KR Ret|KR Yds|KR Avg|KR TD|PR Ret|PR Yds|PR Avg|PR TD
function parsePuntReturns(html) {
  const tbl =
    html.match(/<table[^>]*id="kick_return_standard"[\s\S]*?<\/table>/) ||
    html.match(/<table[^>]*id="returns"[\s\S]*?<\/table>/);
  if (!tbl) return null;
  const rows = tbl[0].match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
  const out = [];
  for (const row of rows) {
    const cells = (row.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/g) ?? []).map((c) =>
      decodeEntities(c.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(),
    );
    if (cells.length < 11) continue;
    const player = cells[1];
    if (!player || /^team totals$/i.test(player)) continue;
    const oldFormat = cells.length < 14; // old layout has no Pos column
    const off = oldFormat ? 0 : 1;
    const num = (s) => (s === '' || s == null || Number.isNaN(Number(s)) ? null : Number(s));
    out.push({
      player,
      pos: oldFormat ? '' : cells[2],
      prRet: num(cells[7 + off]),
      prYds: num(cells[8 + off]),
      prYdRet: num(cells[9 + off]),
      prTd: num(cells[10 + off]),
      krRet: num(cells[3 + off]),
      krYds: num(cells[4 + off]),
      krTd: num(cells[6 + off]),
    });
  }
  return out;
}

function aggregate(wr, prRowsBySchoolSeason) {
  const agg = {
    prRet: 0, prYds: 0, prTd: 0, krRet: 0, krYds: 0, krTd: 0,
    seasons: [], partial: false,
  };
  for (const { slug, season, rows, partial } of prRowsBySchoolSeason) {
    const aliases = NAME_ALIASES[normName(wr.name)] ?? [normName(wr.name)];
    const hit = rows?.find((r) => aliases.includes(normName(r.player)));
    if (!hit) continue;
    agg.seasons.push(`${slug} ${season}`);
    agg.prRet += hit.prRet ?? 0;
    agg.prYds += hit.prYds ?? 0;
    agg.prTd += hit.prTd ?? 0;
    agg.krRet += hit.krRet ?? 0;
    agg.krYds += hit.krYds ?? 0;
    agg.krTd += hit.krTd ?? 0;
    agg.partial = agg.partial || partial;
  }
  agg.prYpr = agg.prRet > 0 ? agg.prYds / agg.prRet : null;
  return agg;
}

async function main() {
  console.log('[1/4] Scraping KTC devy WRs...');
  const allWrs = await scrapeKtcWrs();
  const wrs = allWrs.filter((w) => !DRAFTED.has(w.name));
  console.log(`      ${allWrs.length} WRs, ${allWrs.length - wrs.length} excluded as already drafted`);

  // Resolve school-seasons to fetch (current schools + prior schools for transfers)
  const wanted = new Map(); // key slug|season -> {slug, season}
  for (const wr of wrs) {
    const slug = SCHOOL_SLUGS[wr.teamLongName];
    if (!slug) {
      console.warn(`      WARN: no SR slug for "${wr.teamLongName}" (${wr.name})`);
      continue;
    }
    for (const season of SEASONS) wanted.set(`${slug}|${season}`, { slug, season });
    for (const prior of PRIOR_SCHOOLS[wr.name] ?? []) {
      for (const season of SEASONS) wanted.set(`${prior}|${season}`, { slug: prior, season });
    }
  }

  console.log(`[2/4] Fetching ${wanted.size} archived school-season pages (Wayback)...`);
  const cdxCache = await loadCdxCache();
  const fetched = [];
  let i = 0;
  for (const { slug, season } of wanted.values()) {
    i += 1;
    try {
      const res = await fetchSchoolSeason(slug, season, cdxCache);
      if (!res) {
        console.log(`      ${i}/${wanted.size} ${slug} ${season}: no snapshot`);
      } else {
        const rows = parsePuntReturns(res.html);
        fetched.push({ slug, season, rows, partial: res.partial });
        console.log(
          `      ${i}/${wanted.size} ${slug} ${season}: ${rows ? rows.length + ' returners' : 'NO table'}${res.cached ? ' (cached)' : ''}${res.partial ? ' [partial?]' : ''}`,
        );
      }
    } catch (err) {
      console.warn(`      ${i}/${wanted.size} ${slug} ${season}: ERROR ${err.message}`);
    }
    await sleep(ARCHIVE_DELAY_MS);
    await persistCdxCache(cdxCache);
  }

  console.log('[3/4] Matching + aggregating...');
  const results = wrs.map((wr) => {
    const slug = SCHOOL_SLUGS[wr.teamLongName];
    const priors = PRIOR_SCHOOLS[wr.name] ?? [];
    const relevant = fetched.filter((f) => f.slug === slug || priors.includes(f.slug));
    const agg = aggregate(wr, relevant);
    return {
      ...wr,
      srSlug: slug,
      priorSlugs: priors,
      ...agg,
      found: agg.seasons.length > 0,
      returnedPunts: agg.prRet > 0,
    };
  });

  console.log('[4/4] Writing outputs...');
  await fs.mkdir(OUT_DIR, { recursive: true });

  const csvHeader =
    'wr_rank,name,school,draft_year,ktc_value,seasons_with_data,pr_ret,pr_yds,pr_ypr,pr_td,kr_ret,kr_yds,kr_td,prior_schools,partial_snapshot';
  const csvLines = results.map((r) =>
    [
      r.posRank, `"${r.name}"`, `"${r.teamLongName}"`, r.draftYear, r.value,
      `"${r.seasons.join('; ')}"`,
      r.prRet, r.prYds, r.prYpr == null ? '' : r.prYpr.toFixed(1), r.prTd,
      r.krRet, r.krYds, r.krTd,
      `"${r.priorSlugs.join('; ')}"`, r.partial ? 'yes' : '',
    ].join(','),
  );
  await fs.writeFile(path.join(OUT_DIR, 'devy-wr-punt-returns.csv'), [csvHeader, ...csvLines].join('\n') + '\n');

  await fs.writeFile(path.join(OUT_DIR, 'devy-wr-punt-returns.json'), JSON.stringify(results, null, 2));

  const unmatched = results.filter((r) => !r.found);
  console.log(`\nDone. ${results.length} WRs -> data/analysis/devy-wr-punt-returns.csv`);
  console.log(`PR returners: ${results.filter((r) => r.returnedPunts).length}`);
  console.log(`No matching rows at any school-season: ${unmatched.length}`);
  for (const r of unmatched) console.log(`  - ${r.name} (${r.teamLongName})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
