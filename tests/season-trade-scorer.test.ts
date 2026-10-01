// @spec DFF-SM-032
// @spec DFF-SM-033
// @spec DFF-SM-034
// @spec DFF-SM-035
// @spec DFF-SM-036
// @spec DFF-SM-037
// @spec DFF-SM-038
// @spec DFF-SM-082
// @spec DFF-SM-087
import test from 'node:test';
import assert from 'node:assert/strict';

import type { LeagueContext, RosterEntry, SleeperTradeOfferRecord, TeamRoster } from '../src/season/context.js';
import { scoreTrade } from '../src/season/tradeScorer.js';

function entry(
  sleeperPlayerId: string,
  name: string,
  position: string,
  age: number,
  dynastyValue: number,
  slotType: RosterEntry['slotType'] = 'starter',
): RosterEntry {
  return {
    sleeperPlayerId,
    playersId: `id-${sleeperPlayerId}`,
    name,
    position,
    age,
    dynastyValue,
    slotType,
    matched: true,
  };
}

function team(rosterId: number, players: RosterEntry[], wins = 5, losses = 5): TeamRoster {
  return { rosterId, displayName: `Team ${rosterId}`, teamName: null, wins, losses, ties: 0, players };
}

function offer(partial: Partial<SleeperTradeOfferRecord>): SleeperTradeOfferRecord {
  return {
    transactionId: 900,
    status: 'pending',
    proposerRosterId: 2,
    responderRosterIds: [1],
    adds: {},
    drops: {},
    draftPicks: [],
    createdAt: '2026-09-26T00:00:00.000Z',
    ...partial,
  };
}

function baseTeams(): TeamRoster[] {
  return [
    team(1, [
      entry('q1', 'User QB', 'QB', 27, 5000),
      entry('r1', 'User RB1', 'RB', 26, 4000),
      entry('r2', 'User RB2', 'RB', 23, 3000),
      entry('w1', 'User WR1', 'WR', 25, 5000),
      entry('w2', 'User WR2', 'WR', 30, 2000),
      entry('t1', 'User TE', 'TE', 28, 1500),
      entry('w3', 'User Bench WR', 'WR', 24, 1000, 'bench'),
    ], 8, 2),
    team(2, [
      entry('q2', 'Rival QB', 'QB', 26, 4000),
      entry('r4', 'Rival RB', 'RB', 24, 3500),
      entry('w4', 'Rival WR', 'WR', 24, 4500),
      entry('w5', 'Rival WR2', 'WR', 26, 2500),
      entry('t2', 'Rival TE', 'TE', 25, 1200),
    ]),
    team(3, [
      entry('q3', 'Third QB', 'QB', 24, 3000),
      entry('r5', 'Third RB', 'RB', 25, 2500),
      entry('w6', 'Third WR', 'WR', 23, 3000),
      entry('t3', 'Third TE', 'TE', 27, 900),
    ]),
    team(4, [
      entry('q4', 'Fourth QB', 'QB', 30, 2000),
      entry('r6', 'Fourth RB', 'RB', 28, 1500),
      entry('w7', 'Fourth WR', 'WR', 26, 1500),
      entry('t4', 'Fourth TE', 'TE', 29, 700),
    ]),
  ];
}

function buildContext(overrides: Partial<LeagueContext> = {}): LeagueContext {
  const allRosters = overrides.allRosters ?? baseTeams();
  const userRosterId = overrides.userRosterId ?? 1;

  return {
    league: {
      leagueId: 'L1',
      name: 'Trade League',
      season: '2026',
      totalRosters: allRosters.length,
      status: 'in_season',
      rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'BN'],
      scoringSettings: {},
      syncedAt: '2026-09-27T00:00:00.000Z',
    },
    userRosterId,
    userRoster: allRosters.find((candidate) => candidate.rosterId === userRosterId)?.players ?? [],
    allRosters,
    freeAgents: [],
    pendingOffers: [],
    leagueMedians: {},
    pickValues: { '2027:1': 3000, '2027:2': 1200 },
    tradedPicks: [],
    lastSyncedAt: '2026-09-27T00:00:00.000Z',
    ...overrides,
  };
}

function pick(season: string, round: number, rosterId: number, previousOwnerId: number, ownerId: number) {
  return { season, round, roster_id: rosterId, previous_owner_id: previousOwnerId, owner_id: ownerId };
}

// @spec DFF-SM-087
test('assets are attributed to the user by direction', () => {
  const context = buildContext();
  const score = scoreTrade(
    context,
    offer({
      adds: { q2: 1 },
      drops: { q2: 2, w2: 1 },
      draftPicks: [
        pick('2027', 1, 1, 1, 2),
        pick('2027', 2, 3, 3, 4), // legs between two other teams are excluded
      ],
    }),
  );

  assert.deepEqual(
    score.assetsIn.map((asset) => asset.id),
    ['id-q2'],
  );
  assert.deepEqual(
    score.assetsOut.map((asset) => asset.id).sort(),
    ['2027:1', 'id-w2'].sort(),
  );
  assert.equal(score.assetsOut.find((asset) => asset.kind === 'pick')?.dynastyValue, 3000);
});

// @spec DFF-SM-087
test('a player added elsewhere who sits on the user roster counts as sent when drops is omitted', () => {
  const context = buildContext();
  const score = scoreTrade(context, offer({ adds: { w2: 2 }, drops: {} }));

  assert.deepEqual(
    score.assetsOut.map((asset) => asset.id),
    ['id-w2'],
  );
  assert.equal(score.assetsIn.length, 0);
});

// @spec DFF-SM-032
test('value delta sums received minus sent and normalizes against the user roster value', () => {
  const context = buildContext();
  // User roster value (non-IR): 5000+4000+3000+5000+2000+1500+1000 = 21500.
  const score = scoreTrade(context, offer({ adds: { q2: 1 }, drops: { q2: 2, q1: 1 } }));

  const raw = 4000 - 5000;
  assert.ok(Math.abs(score.signals.valueDelta - (100 * raw) / 21500) < 1e-9);
});

// @spec DFF-SM-082
test('picks without a matching value score zero and add a warning', () => {
  const context = buildContext();
  const score = scoreTrade(
    context,
    offer({ draftPicks: [pick('2029', 3, 2, 2, 1)] }),
  );

  assert.equal(score.assetsIn[0].dynastyValue, 0);
  assert.ok(score.warnings.some((warning) => warning.includes('No pick value for 2029 round 3')));
});

// @spec DFF-SM-033
test('age curve is positive when buying older and inverted in the composite', () => {
  const context = buildContext();
  const younger = scoreTrade(context, offer({ adds: { w4: 1 }, drops: { w4: 2, w2: 1 } }));

  // Rival WR is 24, the sent WR is 30 → buying younger → negative raw age delta.
  assert.ok(younger.signals.ageCurveScore < 0);

  const older = scoreTrade(context, offer({ adds: { q4: 1 }, drops: { q4: 4, q3: 1 } }));
  assert.ok(older.signals.ageCurveScore > 0);
});

// @spec DFF-SM-034
test('positional need rises for an upgrade and falls for a downgrade', () => {
  const context = buildContext();

  const upgrade = scoreTrade(context, offer({ adds: { w4: 1 }, drops: { w4: 2, w2: 1 } }));
  assert.ok(upgrade.signals.positionalNeedScore > 0, 'expected a positive need score for a WR upgrade');

  const downgrade = scoreTrade(context, offer({ adds: { w7: 1 }, drops: { w7: 4, w1: 1 } }));
  assert.ok(downgrade.signals.positionalNeedScore < 0, 'expected a negative need score for a WR downgrade');
});

// @spec DFF-SM-034
test('a picks-only trade has no positional need component', () => {
  const context = buildContext();
  const score = scoreTrade(context, offer({ draftPicks: [pick('2027', 1, 2, 2, 1)] }));

  assert.equal(score.signals.positionalNeedScore, 0);
});

// @spec DFF-SM-036
test('asset liquidity aligns sent assets with the counterparty pick preference', () => {
  // Exactly six players and twelve base picks per team. Trading picks shifts holdings to:
  // team 1 → 1.0 (neutral), team 2 → 0.5 (pick-hungry), team 3 → 4.5 (pick-averse), team 4 → 2.0 (neutral).
  const teams = baseTeams().map((roster) => ({
    ...roster,
    players: roster.players.slice(0, 6),
  }));

  const shifted: LeagueContext['tradedPicks'] = [];
  for (let offset = 1; offset <= 3; offset += 1) {
    for (let round = 1; round <= 4; round += 1) {
      const season = String(2026 + offset);
      const index = (offset - 1) * 4 + round;

      // Team 1 sends its first six picks to team 3.
      if (index <= 6) {
        shifted.push({ season, round, rosterId: 1, previousOwnerId: 1, ownerId: 3 });
      }

      // Team 2 sends nine of its picks to team 3.
      if (index <= 9) {
        shifted.push({ season, round, rosterId: 2, previousOwnerId: 2, ownerId: 3 });
      }
    }
  }

  const context = buildContext({ allRosters: teams, tradedPicks: shifted });

  const hungry = scoreTrade(context, offer({ proposerRosterId: 2, draftPicks: [pick('2027', 1, 1, 1, 2)] }));
  assert.equal(hungry.signals.assetLiquidity, 1, 'sending a pick to a pick-hungry team matches');

  const hungryPlayers = scoreTrade(context, offer({ proposerRosterId: 2, adds: { w2: 2 }, drops: { w2: 1 } }));
  assert.equal(hungryPlayers.signals.assetLiquidity, -1, 'sending players to a pick-hungry team misaligns');

  const averse = scoreTrade(context, offer({ proposerRosterId: 3, adds: { w2: 3 }, drops: { w2: 1 } }));
  assert.equal(averse.signals.assetLiquidity, 1, 'sending players to a pick-averse team matches');

  const aversePicks = scoreTrade(context, offer({ proposerRosterId: 3, draftPicks: [pick('2027', 1, 1, 1, 3)] }));
  assert.equal(aversePicks.signals.assetLiquidity, -1, 'sending picks to a pick-averse team misaligns');

  const neutral = scoreTrade(context, offer({ proposerRosterId: 4, draftPicks: [pick('2027', 1, 1, 1, 4)] }));
  assert.equal(neutral.signals.assetLiquidity, 0, 'a neutral counterparty yields no liquidity signal');

  const both = scoreTrade(
    context,
    offer({ proposerRosterId: 2, adds: { w2: 2 }, drops: { w2: 1 }, draftPicks: [pick('2027', 2, 1, 1, 2)] }),
  );
  assert.equal(both.signals.assetLiquidity, 0, 'mixed sends are treated as neutral');
});

// @spec DFF-SM-035
test('team context selects the value-delta multiplier', () => {
  const contender = scoreTrade(buildContext(), offer({}));
  assert.equal(contender.signals.teamContextMultiplier, 0.8);

  const rebuildingTeams = baseTeams().map((roster) =>
    roster.rosterId === 1 ? { ...roster, wins: 1, losses: 11 } : { ...roster, wins: 9, losses: 3 },
  );
  const rebuilder = scoreTrade(buildContext({ allRosters: rebuildingTeams }), offer({}));
  assert.equal(rebuilder.signals.teamContextMultiplier, 1.2);
});

// @spec DFF-SM-037
// @spec DFF-SM-038
test('composite score drives the verdict bands', () => {
  const context = buildContext();

  const win = scoreTrade(context, offer({ adds: { w4: 1, q2: 1 }, drops: { w4: 2, q2: 2, w2: 1 } }));
  assert.ok(win.compositeScore > 10, `expected a winning composite, got ${win.compositeScore}`);
  assert.equal(win.verdict, 'win');

  const loss = scoreTrade(context, offer({ adds: { w7: 1 }, drops: { w7: 4, w1: 1 } }));
  assert.ok(loss.compositeScore < -10, `expected a losing composite, got ${loss.compositeScore}`);
  assert.equal(loss.verdict, 'loss');

  const neutral = scoreTrade(context, offer({}));
  assert.equal(neutral.verdict, 'neutral');
  assert.ok(neutral.compositeScore >= -100 && neutral.compositeScore <= 100);
});
