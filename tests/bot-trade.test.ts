// @spec DFF-SPKV-050
// @spec DFF-SPKV-051
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTradeableBotAssets,
  evaluateBotTrade,
  findBotToBotTradeOffer,
  findBotToUserTradeOffer,
  shouldInitiatePrePickTrade,
  summarizeBotTrade,
  type BotTradeAsset,
  type DraftSlotOwnership,
  type TradeEvaluationPlayer,
} from '../src/draft/bot-trade.js';

const DRAFT_ORDER: DraftSlotOwnership[] = [
  { draftOrderId: 'slot-1', teamId: 'bot-a', pickNumber: 1 },
  { draftOrderId: 'slot-2', teamId: 'bot-b', pickNumber: 2 },
  { draftOrderId: 'slot-3', teamId: 'bot-a', pickNumber: 3 },
  { draftOrderId: 'slot-4', teamId: 'bot-b', pickNumber: 4 },
];

const PLAYER_VALUES = new Map<string, number>([
  ['player-a', 5800],
  ['player-b', 5600],
]);

const FUTURE_PICK_VALUES = new Map<string, number>([['2027:1', 6000]]);

function createTradeEvaluationPlayer(
  id: string,
  position: string,
  dynastyValue: number,
  age = 25,
): TradeEvaluationPlayer {
  return {
    id,
    position,
    dynastyValue,
    age,
  };
}

// @spec DFF-BOT-040
test('shouldInitiatePrePickTrade fires at each configured archetype rate across a deterministic 100-roll sample', () => {
  const rolls = Array.from({ length: 100 }, (_, index) => index / 100);
  const expectedAttempts = {
    win_now: 25,
    punt: 35,
    rb_heavy: 20,
    qb_early: 20,
    bpa: 10,
    balanced: 15,
  };

  for (const [archetype, expectedCount] of Object.entries(expectedAttempts)) {
    const probability = expectedCount / 100;
    const attempts = rolls.filter((roll) => shouldInitiatePrePickTrade({ probability, random: () => roll }));

    assert.equal(attempts.length, expectedCount, `${archetype} should attempt at its configured rate`);
  }
});

// @spec DFF-BOT-041
// @spec DFF-BOT-042
// @spec DFF-BOT-043
test('findBotToBotTradeOffer targets the best-fit unprotected asset and assembles fodder that clears the threshold', () => {
  const proposal = findBotToBotTradeOffer({
    botTeam: {
      teamId: 'bot-a',
      archetype: 'rb_heavy',
      rosterPlayerIds: ['bot-wr-1', 'bot-wr-2'],
      rosterPlayers: [
        createTradeEvaluationPlayer('bot-wr-1', 'WR', 2400),
        createTradeEvaluationPlayer('bot-wr-2', 'WR', 1800),
      ],
      futurePickAssets: [],
    },
    otherTeams: [
      {
        teamId: 'bot-b',
        archetype: 'rb_heavy',
        rosterPlayerIds: ['protected-rb-1', 'protected-rb-2', 'target-rb', 'higher-value-wr'],
        rosterPlayers: [
          createTradeEvaluationPlayer('protected-rb-1', 'RB', 7000),
          createTradeEvaluationPlayer('protected-rb-2', 'RB', 6500),
          createTradeEvaluationPlayer('target-rb', 'RB', 4000),
          createTradeEvaluationPlayer('higher-value-wr', 'WR', 4300),
        ],
        futurePickAssets: [],
      },
    ],
    acceptanceThreshold: 1,
    draftOrder: DRAFT_ORDER,
    usedPickNumbers: new Set(DRAFT_ORDER.map((slot) => slot.pickNumber)),
    playerValues: new Map<string, number>([
      ['bot-wr-1', 2400],
      ['bot-wr-2', 1800],
      ['protected-rb-1', 7000],
      ['protected-rb-2', 6500],
      ['target-rb', 4000],
      ['higher-value-wr', 4300],
    ]),
    futurePickValues: new Map<string, number>(),
    startupPickValues: new Map<number, number>(),
  });

  assert.ok(proposal);
  assert.equal(proposal.receivingTeamId, 'bot-b');
  assert.deepEqual(proposal.assetsReceived, [{ type: 'player', player_id: 'target-rb' }]);
  assert.deepEqual(proposal.assetsSent, [
    { type: 'player', player_id: 'bot-wr-1' },
    { type: 'player', player_id: 'bot-wr-2' },
  ]);
  assert.ok(proposal.sentDynastyValue >= proposal.receivedDynastyValue);
});

// @spec DFF-BOT-043
// @spec DFF-BOT-044
test('findBotToBotTradeOffer skips the trade when no movable fodder package meets the threshold', () => {
  const proposal = findBotToBotTradeOffer({
    botTeam: {
      teamId: 'bot-a',
      archetype: 'balanced',
      rosterPlayerIds: ['bot-wr-1'],
      rosterPlayers: [createTradeEvaluationPlayer('bot-wr-1', 'WR', 2900)],
      futurePickAssets: [],
    },
    otherTeams: [
      {
        teamId: 'bot-b',
        archetype: 'balanced',
        rosterPlayerIds: ['target-wr'],
        rosterPlayers: [createTradeEvaluationPlayer('target-wr', 'WR', 4000)],
        futurePickAssets: [],
      },
    ],
    acceptanceThreshold: 1,
    draftOrder: DRAFT_ORDER,
    usedPickNumbers: new Set(DRAFT_ORDER.map((slot) => slot.pickNumber)),
    playerValues: new Map<string, number>([
      ['bot-wr-1', 2900],
      ['target-wr', 4000],
    ]),
    futurePickValues: new Map<string, number>(),
    startupPickValues: new Map<number, number>(),
  });

  assert.equal(proposal, null);
});

// @spec DFF-SPKV-050
// @spec DFF-SPKV-051
test('buildTradeableBotAssets includes an unfilled startup pick slot with dynasty value from startupPickValues', () => {
  const assets = buildTradeableBotAssets({
    teamId: 'bot-a',
    draftOrder: DRAFT_ORDER,
    usedPickNumbers: new Set([1]),
    rosterPlayerIds: ['player-a'],
    futurePickAssets: [{ year: 2027, round: 1 }],
    playerValues: PLAYER_VALUES,
    futurePickValues: FUTURE_PICK_VALUES,
    startupPickValues: new Map<number, number>([[3, 6400]]),
  });

  assert.deepEqual(assets, [
    { asset: { type: 'player', player_id: 'player-a' }, dynastyValue: 5800 },
    { asset: { type: 'pick_slot', draft_order_id: 'slot-3', pick_number: 3 }, dynastyValue: 6400 },
    { asset: { type: 'future_pick', year: 2027, round: 1 }, dynastyValue: 6000 },
  ]);
});

// @spec DFF-SPKV-050
// @spec DFF-SPKV-051
test('evaluateBotTrade accepts a received startup pick slot when its startupPickValues dynasty value clears the threshold', () => {
  const assetsSent: BotTradeAsset[] = [{ type: 'future_pick', year: 2027, round: 1 }];
  const assetsReceived: BotTradeAsset[] = [{ type: 'pick_slot', draft_order_id: 'slot-3', pick_number: 3 }];

  assert.equal(
    evaluateBotTrade({
      assetsSent,
      assetsReceived,
      acceptanceThreshold: 1,
      playerValues: PLAYER_VALUES,
      futurePickValues: FUTURE_PICK_VALUES,
      startupPickValues: new Map<number, number>([[3, 6100]]),
    }),
    true,
  );
});

// @spec DFF-SPKV-051
test('summarizeBotTrade scores a startup pick slot as zero when startupPickValues has no matching global pick number', () => {
  const summary = summarizeBotTrade({
    assetsSent: [{ type: 'pick_slot', draft_order_id: 'slot-3', pick_number: 3 }],
    assetsReceived: [{ type: 'future_pick', year: 2027, round: 1 }],
    playerValues: PLAYER_VALUES,
    futurePickValues: FUTURE_PICK_VALUES,
    startupPickValues: new Map<number, number>(),
  });

  assert.deepEqual(summary, {
    sentDynastyValue: 0,
    receivedDynastyValue: 6000,
  });
});

// @spec DFF-BOT-042
test('buildTradeableBotAssets excludes rb_heavy top-two RBs from trade fodder', () => {
  const assets = buildTradeableBotAssets({
    teamId: 'bot-a',
    draftOrder: DRAFT_ORDER,
    usedPickNumbers: new Set<number>(),
    rosterPlayerIds: ['rb-1', 'rb-2', 'rb-3', 'wr-1'],
    futurePickAssets: [],
    playerValues: new Map<string, number>([
      ['rb-1', 6200],
      ['rb-2', 5800],
      ['rb-3', 4100],
      ['wr-1', 3900],
    ]),
    futurePickValues: new Map<string, number>(),
    startupPickValues: new Map<number, number>(),
    archetype: 'rb_heavy',
    rosterPlayers: [
      createTradeEvaluationPlayer('rb-1', 'RB', 6200),
      createTradeEvaluationPlayer('rb-2', 'RB', 5800),
      createTradeEvaluationPlayer('rb-3', 'RB', 4100),
      createTradeEvaluationPlayer('wr-1', 'WR', 3900),
    ],
  });

  assert.deepEqual(
    assets.map((entry) => entry.asset),
    [
      { type: 'player', player_id: 'rb-3' },
      { type: 'player', player_id: 'wr-1' },
      { type: 'pick_slot', draft_order_id: 'slot-1', pick_number: 1 },
      { type: 'pick_slot', draft_order_id: 'slot-3', pick_number: 3 },
    ],
  );
});

// @spec DFF-BOT-042
test('buildTradeableBotAssets excludes qb_early starting QB from trade fodder', () => {
  const assets = buildTradeableBotAssets({
    teamId: 'bot-a',
    draftOrder: DRAFT_ORDER,
    usedPickNumbers: new Set<number>(),
    rosterPlayerIds: ['qb-1', 'qb-2', 'wr-1'],
    futurePickAssets: [],
    playerValues: new Map<string, number>([
      ['qb-1', 7100],
      ['qb-2', 4800],
      ['wr-1', 4500],
    ]),
    futurePickValues: new Map<string, number>(),
    startupPickValues: new Map<number, number>(),
    archetype: 'qb_early',
    rosterPlayers: [
      createTradeEvaluationPlayer('qb-1', 'QB', 7100),
      createTradeEvaluationPlayer('qb-2', 'QB', 4800),
      createTradeEvaluationPlayer('wr-1', 'WR', 4500),
    ],
  });

  assert.deepEqual(
    assets.map((entry) => entry.asset),
    [
      { type: 'player', player_id: 'qb-2' },
      { type: 'player', player_id: 'wr-1' },
      { type: 'pick_slot', draft_order_id: 'slot-1', pick_number: 1 },
      { type: 'pick_slot', draft_order_id: 'slot-3', pick_number: 3 },
    ],
  );
});

// @spec DFF-BOT-042
test('buildTradeableBotAssets excludes win_now proven starters from trade fodder', () => {
  const assets = buildTradeableBotAssets({
    teamId: 'bot-a',
    draftOrder: DRAFT_ORDER,
    usedPickNumbers: new Set<number>(),
    rosterPlayerIds: ['vet-1', 'vet-2', 'young-1'],
    futurePickAssets: [],
    playerValues: new Map<string, number>([
      ['vet-1', 5000],
      ['vet-2', 4200],
      ['young-1', 4300],
    ]),
    futurePickValues: new Map<string, number>(),
    startupPickValues: new Map<number, number>(),
    archetype: 'win_now',
    rosterPlayers: [
      createTradeEvaluationPlayer('vet-1', 'WR', 5000, 29),
      createTradeEvaluationPlayer('vet-2', 'RB', 4200, 27),
      createTradeEvaluationPlayer('young-1', 'WR', 4300, 24),
    ],
  });

  assert.deepEqual(
    assets.map((entry) => entry.asset),
    [
      { type: 'player', player_id: 'young-1' },
      { type: 'pick_slot', draft_order_id: 'slot-1', pick_number: 1 },
      { type: 'pick_slot', draft_order_id: 'slot-3', pick_number: 3 },
    ],
  );
});

// @spec DFF-BOT-051
test('evaluateBotTrade declines rb_heavy offers that send a top-two RB even when value math passes', () => {
  assert.equal(
    evaluateBotTrade({
      acceptanceThreshold: 0.5,
      assetsSent: [{ type: 'player', player_id: 'rb-1' }],
      assetsReceived: [{ type: 'future_pick', year: 2027, round: 1 }],
      playerValues: new Map<string, number>([['rb-1', 5000]]),
      futurePickValues: new Map<string, number>([['2027:1', 6000]]),
      startupPickValues: new Map<number, number>(),
      archetype: 'rb_heavy',
      rosterPlayers: [
        createTradeEvaluationPlayer('rb-1', 'RB', 5000),
        createTradeEvaluationPlayer('rb-2', 'RB', 4800),
        createTradeEvaluationPlayer('wr-1', 'WR', 4300),
      ],
    }),
    false,
  );
});

// @spec DFF-BOT-051
test('evaluateBotTrade declines qb_early offers that send the starting QB even when value math passes', () => {
  assert.equal(
    evaluateBotTrade({
      acceptanceThreshold: 0.5,
      assetsSent: [{ type: 'player', player_id: 'qb-1' }],
      assetsReceived: [{ type: 'future_pick', year: 2027, round: 1 }],
      playerValues: new Map<string, number>([['qb-1', 5000]]),
      futurePickValues: new Map<string, number>([['2027:1', 6000]]),
      startupPickValues: new Map<number, number>(),
      archetype: 'qb_early',
      rosterPlayers: [
        createTradeEvaluationPlayer('qb-1', 'QB', 5000),
        createTradeEvaluationPlayer('qb-2', 'QB', 4700),
        createTradeEvaluationPlayer('wr-1', 'WR', 4300),
      ],
    }),
    false,
  );
});

// @spec DFF-BOT-051
test('evaluateBotTrade declines win_now offers that send a proven starter even when value math passes', () => {
  assert.equal(
    evaluateBotTrade({
      acceptanceThreshold: 0.5,
      assetsSent: [{ type: 'player', player_id: 'vet-1' }],
      assetsReceived: [{ type: 'future_pick', year: 2027, round: 1 }],
      playerValues: new Map<string, number>([['vet-1', 5000]]),
      futurePickValues: new Map<string, number>([['2027:1', 6000]]),
      startupPickValues: new Map<number, number>(),
      archetype: 'win_now',
      rosterPlayers: [
        createTradeEvaluationPlayer('vet-1', 'WR', 5000, 28),
        createTradeEvaluationPlayer('young-1', 'WR', 4300, 24),
      ],
    }),
    false,
  );
});

// @spec DFF-BOT-045
// @spec DFF-BOT-048
test('findBotToUserTradeOffer prefers archetype-fit user assets and stays inside a modest value-gain band', () => {
  const proposal = findBotToUserTradeOffer({
    currentRound: 5,
    recentBotToUserOfferRounds: [],
    botTeam: {
      teamId: 'bot-a',
      archetype: 'rb_heavy',
      rosterPlayerIds: ['bot-wr-1'],
      rosterPlayers: [createTradeEvaluationPlayer('bot-wr-1', 'WR', 4100)],
      futurePickAssets: [{ year: 2027, round: 1 }],
    },
    userTeam: {
      teamId: 'user-team',
      archetype: null,
      rosterPlayerIds: ['user-rb-1', 'user-wr-1'],
      rosterPlayers: [
        createTradeEvaluationPlayer('user-rb-1', 'RB', 6200),
        createTradeEvaluationPlayer('user-wr-1', 'WR', 6500),
      ],
      futurePickAssets: [],
    },
    draftOrder: DRAFT_ORDER,
    usedPickNumbers: new Set([1, 2, 3, 4]),
    playerValues: new Map<string, number>([
      ['bot-wr-1', 4100],
      ['user-rb-1', 6200],
      ['user-wr-1', 6500],
    ]),
    futurePickValues: new Map<string, number>([['2027:1', 1700]]),
    startupPickValues: new Map<number, number>(),
  });

  assert.ok(proposal);
  assert.deepEqual(proposal.assetsReceived, [{ type: 'player', player_id: 'user-rb-1' }]);
  assert.equal(proposal.receivedDynastyValue, 6200);
  assert.ok(proposal.sentDynastyValue < proposal.receivedDynastyValue);
  assert.ok(proposal.sentDynastyValue >= Math.floor(proposal.receivedDynastyValue * 0.82));
});

// @spec DFF-BOT-048
test('findBotToUserTradeOffer suppresses repeat proactive offers during the cooldown window', () => {
  const proposal = findBotToUserTradeOffer({
    currentRound: 6,
    recentBotToUserOfferRounds: [5],
    botTeam: {
      teamId: 'bot-a',
      archetype: 'balanced',
      rosterPlayerIds: ['bot-wr-1'],
      rosterPlayers: [createTradeEvaluationPlayer('bot-wr-1', 'WR', 4100)],
      futurePickAssets: [{ year: 2027, round: 1 }],
    },
    userTeam: {
      teamId: 'user-team',
      archetype: null,
      rosterPlayerIds: ['user-wr-1'],
      rosterPlayers: [createTradeEvaluationPlayer('user-wr-1', 'WR', 5200)],
      futurePickAssets: [],
    },
    draftOrder: DRAFT_ORDER,
    usedPickNumbers: new Set([1, 2, 3, 4]),
    playerValues: new Map<string, number>([
      ['bot-wr-1', 4100],
      ['user-wr-1', 5200],
    ]),
    futurePickValues: new Map<string, number>([['2027:1', 1600]]),
    startupPickValues: new Map<number, number>(),
  });

  assert.equal(proposal, null);
});

// @spec DFF-BOT-048
test('findBotToUserTradeOffer also suppresses offers when the same bot traded with the user two rounds ago', () => {
  const proposal = findBotToUserTradeOffer({
    currentRound: 6,
    recentBotToUserOfferRounds: [4],
    botTeam: {
      teamId: 'bot-a',
      archetype: 'balanced',
      rosterPlayerIds: ['bot-wr-1'],
      rosterPlayers: [createTradeEvaluationPlayer('bot-wr-1', 'WR', 4100)],
      futurePickAssets: [{ year: 2027, round: 1 }],
    },
    userTeam: {
      teamId: 'user-team',
      archetype: null,
      rosterPlayerIds: ['user-wr-1'],
      rosterPlayers: [createTradeEvaluationPlayer('user-wr-1', 'WR', 5200)],
      futurePickAssets: [],
    },
    draftOrder: DRAFT_ORDER,
    usedPickNumbers: new Set([1, 2, 3, 4]),
    playerValues: new Map<string, number>([
      ['bot-wr-1', 4100],
      ['user-wr-1', 5200],
    ]),
    futurePickValues: new Map<string, number>([['2027:1', 1600]]),
    startupPickValues: new Map<number, number>(),
  });

  assert.equal(proposal, null);
});
