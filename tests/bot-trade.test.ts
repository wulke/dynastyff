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
