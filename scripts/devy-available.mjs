// Cross-reference KTC devy rankings against the league draft-board spreadsheet.
// Available = on KTC devy list AND not drafted per the sheet.
// Sheet: Google Sheets CSV export (public link).

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/123N1fM6onMW0bIcESr2ERtF0s5sRsyp-fPKuf4s9Oms/export?format=csv&gid=1816954817';
const KTC_URL = 'https://keeptradecut.com/devy-rankings';
const OUT_DIR = path.resolve('data/analysis');

const SUFFIX_RE = /^(jr|sr|ii|iii|iv|v)$/;
function normName(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.'’`]/g, '')
    .replace(/-/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/→/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !SUFFIX_RE.test(w))
    .join(' ');
}

// League-specific target lists (marked with '*' in outputs)
// RB targets supplied by the league owner (school notes ignored for matching):
const TARGET_RB_RAW = [
  'Jadan Baugh, Florida',
  'Kewan Lacy, Ole Miss',
  'Nate Frazier, Georgia',
  'Justice Haynes, Georgia Tech via Michigan',
  'Ahmad Hardy, Missouri',
  'Antwan Raymond, Rutgers',
  'L.J. Martin, BYU',
  'Isaac Brown, Louisville',
  'Wayshawn Parker, Utah',
  'Mark Fletcher Jr., Miami (FL)',
];
const TARGET_RBS = new Set(TARGET_RB_RAW.map((s) => normName(s.split(',')[0])));

// WR targets = solid college PR producers (>= 10 career PR) per the PR analysis
const PR_MIN_RETURNS = 10;

// Very small RFC-4180-ish CSV parser (quoted fields, commas inside quotes)
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch === '\r') { /* skip */ }
    else field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// Drafted = cell immediately preceding a "N →" pick-number cell
function extractDrafted(csvText) {
  const rows = parseCsv(csvText);
  const drafted = [];
  for (const row of rows) {
    for (let i = 1; i < row.length; i++) {
      if (/^\s*\d+\s*→\s*$/.test(row[i])) {
        const name = (row[i - 1] ?? '').trim();
        const pick = row[i].trim();
        if (name) drafted.push({ name, pick });
      }
    }
  }
  return drafted;
}

async function scrapeKtcDevy() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(KTC_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    return await page.evaluate(() =>
      (globalThis.playersArray ?? []).map((p) => ({
        name: p.playerName,
        position: String(p.position || '').toUpperCase(),
        team: p.team,
        teamLongName: p.teamLongName,
        draftYear: p.draftYear,
        value: p.superflexValues?.value ?? p.value,
        overallRank: p.superflexValues?.rank ?? p.rank,
        posRank: p.superflexValues?.positionalRank ?? p.positionalRank,
      })),
    );
  } finally {
    await browser.close();
  }
}

async function main() {
  const sheetRes = await fetch(SHEET_CSV_URL, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  if (!sheetRes.ok) throw new Error(`sheet fetch ${sheetRes.status}`);
  const drafted = extractDrafted(await sheetRes.text());
  console.log(`Drafted per sheet: ${drafted.length}`);

  const ktc = await scrapeKtcDevy();
  console.log(`KTC devy players: ${ktc.length}`);

  // WR PR targets from the punt-return analysis (still-available ones only)
  let prResults = [];
  try {
    prResults = JSON.parse(await fs.readFile(path.join(OUT_DIR, 'devy-wr-punt-returns.json'), 'utf8'));
  } catch {
    console.warn('WARN: no PR analysis file; WR PR targets not marked');
  }
  const prTargetNorms = new Map(
    prResults
      .filter((r) => (r.prRet ?? 0) >= PR_MIN_RETURNS)
      .map((r) => [normName(r.name), r]),
  );

  const draftedNorm = new Map(drafted.map((d) => [normName(d.name), d]));
  const available = [];
  const matchedDrafted = new Set();
  for (const p of ktc) {
    const hit = draftedNorm.get(normName(p.name));
    if (hit) matchedDrafted.add(normName(p.name));
    else {
      const isRbTarget = p.position === 'RB' && TARGET_RBS.has(normName(p.name));
      const prRow = p.position === 'WR' ? prTargetNorms.get(normName(p.name)) : undefined;
      const isWrPrTarget = Boolean(prRow);
      available.push({
        ...p,
        target: isRbTarget ? 'RB-target' : isWrPrTarget ? 'WR-PR-target' : '',
        prRet: prRow?.prRet ?? null,
      });
    }
  }
  const unmatchedSheetNames = drafted.filter((d) => !matchedDrafted.has(normName(d.name)));

  available.sort((a, b) => b.value - a.value);

  await fs.mkdir(OUT_DIR, { recursive: true });
  const csvLines = ['ktc_overall_rank,position,ktc_pos_rank,name,school,draft_year,ktc_value,target,pr_ret'];
  for (const p of available) {
    csvLines.push(
      [p.overallRank, p.position, p.posRank, `"${p.name}"`, `"${p.teamLongName}"`, p.draftYear, p.value, p.target, p.prRet ?? ''].join(','),
    );
  }
  await fs.writeFile(path.join(OUT_DIR, 'devy-available.csv'), csvLines.join('\n') + '\n');

  console.log(`\nAvailable on KTC devy board: ${available.length}`);
  console.log('Drafted sheet names not found on KTC devy list:');
  for (const d of unmatchedSheetNames) console.log(`  - ${d.name} (${d.pick})`);

  const posCounts = {};
  for (const p of available) posCounts[p.position] = (posCounts[p.position] || 0) + 1;
  console.log('\nAvailable by position:', JSON.stringify(posCounts));

  const targetRows = available.filter((p) => p.target);
  console.log(`\nTargets on the available board: ${targetRows.length}`);
  for (const p of targetRows) {
    console.log(
      `  * [${p.target}] #${p.overallRank} ${p.name} (${p.position}, ${p.teamLongName}, ${p.draftYear}) value=${p.value}${p.prRet != null ? ` PR=${p.prRet} ret` : ''}`,
    );
  }

  // Which supplied RB targets are NOT on the available board (drafted or unranked by KTC)?
  const ktcNorm = new Map(ktc.map((p) => [normName(p.name), p]));
  for (const raw of TARGET_RB_RAW) {
    const n = normName(raw.split(',')[0]);
    if (TARGET_RBS.has(n) && !targetRows.some((t) => normName(t.name) === n && t.target === 'RB-target')) {
      const onKtc = ktcNorm.get(n);
      const draftedAs = draftedNorm.get(n);
      console.log(
        `  - RB target NOT available: ${raw.split(',')[0]} ${draftedAs ? `(drafted ${draftedAs.pick})` : onKtc ? '(on KTC, unexpected)' : '(not on KTC devy board)'}`,
      );
    }
  }

  console.log('\nTop 20 available by KTC value (* = your target):');
  console.log('rank pos posRk name                         school                    dy   value');
  for (const p of available.slice(0, 20)) {
    const star = p.target ? ' *' : '  ';
    console.log(
      String(p.overallRank).padStart(4),
      p.position.padEnd(3),
      String(p.posRank).padStart(4),
      (p.name + star).padEnd(28),
      String(p.teamLongName ?? '').slice(0, 25).padEnd(26),
      String(p.draftYear).padEnd(4),
      String(p.value).padStart(5),
      p.prRet != null ? `PR:${p.prRet}` : '',
    );
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
