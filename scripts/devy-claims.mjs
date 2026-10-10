// Devy claims for the "I Love College" Sleeper league, straight from the source of truth.
//
// How devy claims are encoded in Sleeper: taxi squads hold NFL placeholder players and the
// commissioner sets a league-wide nickname on each placeholder (roster.metadata["p_nick_<id>"])
// naming the actual college (devy) player it represents.
//
// This script:
//   1. pulls rosters + users + league settings from the Sleeper API,
//   2. extracts devy claims (taxi players with p_nick_ nicknames),
//   3. joins them against the local KTC devy board (devy_players table),
//   4. writes data/analysis/devy-ownership.csv and regenerates
//      data/analysis/devy-available.csv (board minus claims),
//   5. prints trade context: team records, open taxi slots, on-the-block players,
//      and future-pick trades.
//
// Replaces the Google-Sheet draft-board flow in devy-available.mjs (the sheet went stale).
// Run: node scripts/devy-claims.mjs

import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

// This repo is public: never hard-code a league or user ID. Export both before running:
//   DEVY_LEAGUE_ID=<sleeper league id> DEVY_ME_USER_ID=<your sleeper user id> node scripts/devy-claims.mjs
const LEAGUE_ID = process.env.DEVY_LEAGUE_ID;
const ME_USER_ID = process.env.DEVY_ME_USER_ID;

if (!LEAGUE_ID || !ME_USER_ID) {
  console.error('DEVY_LEAGUE_ID and DEVY_ME_USER_ID are required (Sleeper IDs).');
  process.exit(1);
}

const API = 'https://api.sleeper.app/v1';
const DB_PATH = path.resolve('data/dynastyff.sqlite');
const OUT_DIR = path.resolve('data/analysis');
const CACHE_DIR = path.resolve('data/cache/sleeper');
const PR_MIN_RETURNS = 10;

// League-specific RB targets (owner-supplied) — kept in sync with devy-available.mjs
const TARGET_RB_RAW = [
  'Jadan Baugh, Florida',
  'Kewan Lacy, Ole Miss',
  'Nate Frazier, Georgia',
  'Justice Haynes, Michigan',
  'Ahmad Hardy, Missouri',
  'Antwan Raymond, Rutgers',
  'L.J. Martin, BYU',
  'Isaac Brown, Louisville',
  'Wayshawn Parker, Utah',
  'Mark Fletcher Jr., Miami (FL)',
];

const SUFFIX_RE = /^(jr|sr|ii|iii|iv|v)$/;
function normName(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.'’`]/g, '')
    .replace(/-/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !SUFFIX_RE.test(w))
    .join(' ');
}

async function cachedJson(file, fetcher) {
  const cached = path.join(CACHE_DIR, file);
  try {
    return JSON.parse(await fs.readFile(cached, 'utf8'));
  } catch {
    const data = await fetcher();
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(cached, JSON.stringify(data));
    return data;
  }
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function sleeper(endpoint) {
  return cachedJson(`${LEAGUE_ID}-${endpoint.replace(/\W+/g, '_')}.json`, () =>
    fetchJson(`${API}/league/${LEAGUE_ID}/${endpoint}`),
  );
}

// On-the-block flags live only on the undocumented GraphQL endpoint.
async function fetchOnTheBlock() {
  return cachedJson(`${LEAGUE_ID}-otb.json`, async () => {
    const res = await fetch('https://api.sleeper.app/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `{ league_players(league_id: "${LEAGUE_ID}") { player_id settings } }`,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`graphql -> ${res.status}`);
    const body = await res.json();
    return (body?.data?.league_players ?? [])
      .filter((p) => p.settings?.otb)
      .map((p) => ({ player_id: p.player_id, otb: p.settings.otb }));
  });
}

function loadNflNameCache() {
  try {
    const raw = JSON.parse(fsSync.readFileSync(path.resolve('data/sleeper-players-cache.json'), 'utf8'));
    return new Map(Object.entries(raw.players ?? {}).map(([id, p]) => [id, p.fullName]));
  } catch {
    return new Map();
  }
}

async function loadAliases() {
  try {
    const raw = JSON.parse(await fs.readFile(path.resolve('player-aliases.json'), 'utf8'));
    const variantToCanonical = new Map();
    for (const { canonical, variants } of raw.aliases ?? []) {
      variantToCanonical.set(normName(canonical), canonical);
      for (const v of variants ?? []) variantToCanonical.set(normName(v), canonical);
    }
    return variantToCanonical;
  } catch {
    return new Map();
  }
}

async function main() {
  const [league, rosters, users] = await Promise.all([
    sleeper(''),
    sleeper('rosters'),
    sleeper('users'),
  ]);
  const taxiSlots = league.settings?.taxi_slots ?? 10;

  const teamByUser = new Map(users.map((u) => [u.user_id, u.metadata?.team_name || u.display_name]));
  const teamByRoster = new Map(rosters.map((r) => [r.roster_id, teamByUser.get(r.owner_id) ?? `roster ${r.roster_id}`]));
  const rosterByOwner = new Map(rosters.map((r) => [r.owner_id, r]));

  // 1. Devy claims: taxi players with a p_nick_ nickname
  const claims = [];
  for (const roster of rosters) {
    const nicks = Object.entries(roster.metadata ?? {}).filter(([k]) => k.startsWith('p_nick_'));
    for (const [key, devyName] of nicks) {
      const pid = key.slice('p_nick_'.length);
      if (!roster.taxi?.includes(pid)) continue;
      claims.push({
        rosterId: roster.roster_id,
        owner: roster.owner_id,
        team: teamByUser.get(roster.owner_id) ?? `roster ${roster.roster_id}`,
        isMe: roster.owner_id === ME_USER_ID,
        devyName,
      });
    }
  }

  // 2. Devy board from sqlite
  const db = new Database(DB_PATH, { readonly: true });
  const board = db
    .prepare('SELECT name, position, school, draft_year, value_superflex FROM devy_players')
    .all();
  db.close();
  const aliases = await loadAliases();
  const boardByNorm = new Map(board.map((p) => [normName(p.name), p]));
  const resolveClaim = (name) => boardByNorm.get(aliases.get(normName(name)) ?? normName(name));

  // 3. Ownership CSV
  const ownershipRows = ['roster_id,team,devy_name,position,school,draft_year,ktc_value,on_board,mine'];
  for (const c of claims.sort((a, b) => a.team.localeCompare(b.team) || a.devyName.localeCompare(b.devyName))) {
    const hit = resolveClaim(c.devyName);
    ownershipRows.push(
      [
        c.rosterId,
        `"${c.team}"`,
        `"${c.devyName}"`,
        hit?.position ?? '',
        `"${hit?.school ?? ''}"`,
        hit?.draft_year ?? '',
        hit?.value_superflex ?? '',
        hit ? 'yes' : 'no',
        c.isMe ? 'yes' : 'no',
      ].join(','),
    );
  }
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, 'devy-ownership.csv'), ownershipRows.join('\n') + '\n');

  // 4. Available board = board minus claims
  const claimedNorms = new Set(
    claims.map((c) => normName(aliases.get(normName(c.devyName)) ?? c.devyName)),
  );
  const available = board
    .filter((p) => !claimedNorms.has(normName(p.name)))
    .sort((a, b) => b.value_superflex - a.value_superflex)
    .map((p, i) => ({ ...p, valueRank: i + 1 }));
  const availableByNorm = new Map(available.map((p) => [normName(p.name), p]));

  // Target flags (same logic as devy-available.mjs)
  const targetRbs = new Set(TARGET_RB_RAW.map((s) => normName(s.split(',')[0])));
  let prTargets = [];
  try {
    prTargets = JSON.parse(await fs.readFile(path.join(OUT_DIR, 'devy-wr-punt-returns.json'), 'utf8'));
  } catch {
    console.warn('WARN: no PR analysis file; WR punt-return targets not marked');
  }
  const prByNorm = new Map(
    prTargets.filter((r) => (r.prRet ?? 0) >= PR_MIN_RETURNS).map((r) => [normName(r.name), r]),
  );

  const csvLines = ['value_rank,position,pos_rank_by_value,name,school,draft_year,ktc_value,target,pr_ret'];
  for (const p of available) {
    const isRbTarget = p.position === 'RB' && targetRbs.has(normName(p.name));
    const prRow = p.position === 'WR' ? prByNorm.get(normName(p.name)) : undefined;
    const posRank =
      available.filter((q) => q.position === p.position && q.value_superflex >= p.value_superflex).length;
    csvLines.push(
      [
        p.valueRank,
        p.position,
        posRank,
        `"${p.name}"`,
        `"${p.school}"`,
        p.draft_year,
        p.value_superflex,
        isRbTarget ? 'RB-target' : prRow ? 'WR-PR-target' : '',
        prRow?.prRet ?? '',
      ].join(','),
    );
  }
  await fs.writeFile(path.join(OUT_DIR, 'devy-available.csv'), csvLines.join('\n') + '\n');

  // 5. Console report
  console.log(`\nDevy claims extracted from Sleeper league ${LEAGUE_ID} (${league.name}): ${claims.length}`);

  const unmatched = claims.filter((c) => !resolveClaim(c.devyName));
  if (unmatched.length) {
    console.log('\nClaimed names NOT matched on the local devy board (add to player-aliases.json?):');
    for (const c of unmatched) console.log(`  - "${c.devyName}" (${c.team})`);
  }

  console.log('\n=== Ownership by team (claims / taxi slots) ===');
  for (const r of rosters.sort((a, b) => (b.settings?.fpts ?? 0) - (a.settings?.fpts ?? 0))) {
    const team = teamByUser.get(r.owner_id) ?? `roster ${r.roster_id}`;
    const n = claims.filter((c) => c.rosterId === r.roster_id).length;
    const rec = `${r.settings?.wins ?? 0}-${r.settings?.losses ?? 0}${r.settings?.ties ? `-${r.settings.ties}` : ''}`;
    const mine = r.owner_id === ME_USER_ID ? '  <- you' : '';
    console.log(`  ${team.padEnd(20)} ${rec.padEnd(7)} fpts ${String(r.settings?.fpts ?? 0).padStart(4)}  devy ${n}/${taxiSlots}${mine}`);
  }

  const nextDraftYear = Number(league.season) + 1;
  for (const year of [...new Set(available.map((p) => p.draft_year))].sort()) {
    const rows = available.filter((p) => p.draft_year === year);
    const label = year === nextDraftYear ? `${year} (next draft)` : `${year}`;
    console.log(`\n=== Top available for ${label} draft class (${rows.length} unclaimed on board) ===`);
    console.log('rank pos posRk name                        school                       value');
    for (const p of rows.slice(0, year === nextDraftYear ? 15 : 8)) {
      const isRbTarget = p.position === 'RB' && targetRbs.has(normName(p.name));
      const prRow = p.position === 'WR' ? prByNorm.get(normName(p.name)) : undefined;
      const star = isRbTarget || prRow ? ' *' : '  ';
      const posRank =
        available.filter((q) => q.position === p.position && q.value_superflex >= p.value_superflex).length;
      console.log(
        String(p.valueRank).padStart(4),
        p.position.padEnd(3),
        String(posRank).padStart(4),
        (p.name + star).padEnd(28),
        String(p.school ?? '').slice(0, 27).padEnd(28),
        String(p.value_superflex).padStart(5),
      );
    }
  }

  const claimedTargets = TARGET_RB_RAW.map((raw) => {
    const n = normName(raw.split(',')[0]);
    const owner = claims.find((c) => normName(aliases.get(n) ?? c.devyName) === n || normName(c.devyName) === n);
    const boardHit = boardByNorm.get(n);
    return { raw: raw.split(',')[0], owner: owner?.team ?? null, onBoard: Boolean(boardHit) };
  });
  console.log('\n=== Your RB targets ===');
  for (const t of claimedTargets) {
    console.log(
      `  ${t.owner ? `CLAIMED by ${t.owner}` : t.onBoard ? 'AVAILABLE' : 'not on board'}: ${t.raw}`,
    );
  }

  const otb = await fetchOnTheBlock();
  if (otb.length) {
    const nflNames = loadNflNameCache();
    const tradedPicks = await cachedJson(`${LEAGUE_ID}-traded_picks.json`, async () => {
      const drafts = await fetchJson(`${API}/league/${LEAGUE_ID}/drafts`);
      const all = [];
      for (const d of drafts) {
        all.push(...(await fetchJson(`${API}/draft/${d.draft_id}/traded_picks`)));
      }
      return all;
    });
    console.log('\n=== On the trading block ===');
    for (const p of otb) {
      const isPick = /^\d+,/.test(p.player_id);
      if (isPick) {
        const [rosterId, season, round] = p.player_id.split(',');
        const holder = tradedPicks.find(
          (tp) => String(tp.roster_id) === rosterId && tp.season === season && String(tp.round) === round,
        );
        const holderTeam = holder && holder.owner_id !== holder.previous_owner_id
          ? `held by ${teamByRoster.get(holder.owner_id) ?? `roster ${holder.owner_id}`}`
          : 'original owner';
        console.log(`  - ${season} round-${round} pick (from roster ${rosterId}) [${holderTeam}] [otb ${p.otb}]`);
      } else {
        const holder = rosters.find((r) => r.players?.includes(p.player_id) || r.taxi?.includes(p.player_id));
        const name = nflNames.get(p.player_id) ?? `player ${p.player_id}`;
        const team = holder ? teamByUser.get(holder.owner_id) ?? `roster ${holder.roster_id}` : 'FA?';
        console.log(`  - ${name} (${team}) [otb ${p.otb}]`);
      }
    }
  }

  console.log('\n=== Future-pick trades (from league transactions) ===');
  const txns = [];
  for (let round = 0; round <= 18; round++) {
    try {
      txns.push(...(await sleeper(`transactions/${round}`)));
    } catch {
      /* round with no transactions */
    }
  }
  const pickTrades = txns.filter((t) => t.type === 'trade' && (t.draft_picks ?? []).length);
  if (!pickTrades.length) console.log('  (none)');
  for (const t of pickTrades) {
    for (const pick of t.draft_picks) {
      const from = teamByRoster.get(pick.previous_owner_id) ?? `roster ${pick.previous_owner_id}`;
      const to = teamByRoster.get(pick.owner_id) ?? `roster ${pick.owner_id}`;
      console.log(`  - ${pick.season} round-${pick.round} pick (from roster ${pick.roster_id}): ${from} -> ${to}`);
    }
  }

  console.log(`\nWrote ${path.join(OUT_DIR, 'devy-ownership.csv')} and ${path.join(OUT_DIR, 'devy-available.csv')}`);
  process.exit(0); // better-sqlite3 crashes during exit-time GC on Node 24; exit explicitly
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
