// @spec DFF-SPKV-050
// @spec DFF-SPKV-051
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTradeableBotAssets,
  evaluateBotTrade,
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
