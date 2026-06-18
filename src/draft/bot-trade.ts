import type { TeamArchetype } from './engine.js';

export type PlayerTradeAsset = {
  type: 'player';
  player_id: string;
};

export type PickSlotTradeAsset = {
  type: 'pick_slot';
  draft_order_id?: string;
  pick_number?: number;
};

export type FuturePickTradeAsset = {
  type: 'future_pick';
  year: number;
  round: number;
};

export type BotTradeAsset = PlayerTradeAsset | PickSlotTradeAsset | FuturePickTradeAsset;

// @spec DFF-SPKV-050
export type DraftSlotOwnership = {
  draftOrderId: string;
  teamId: string;
  pickNumber: number;
};

type TradeValueContext = {
  playerValues: Map<string, number>;
  futurePickValues: Map<string, number>;
  startupPickValues: Map<number, number>;
};

type BuildTradeableBotAssetsOptions = TradeValueContext & {
  teamId: string;
  draftOrder: DraftSlotOwnership[];
  usedPickNumbers: Set<number>;
  rosterPlayerIds: string[];
  archetype?: TeamArchetype | null;
  rosterPlayers?: TradeEvaluationPlayer[];
  futurePickAssets: Array<{ year: number; round: number }>;
};

type SummarizeBotTradeOptions = TradeValueContext & {
  assetsSent: BotTradeAsset[];
  assetsReceived: BotTradeAsset[];
};

type EvaluateBotTradeOptions = SummarizeBotTradeOptions & {
  acceptanceThreshold: number;
  archetype?: TeamArchetype | null;
  rosterPlayers?: TradeEvaluationPlayer[];
};

export type ScoredBotTradeAsset = {
  asset: BotTradeAsset;
  dynastyValue: number;
};

export type TradeEvaluationPlayer = {
  id: string;
  position: string;
  age: number | null;
  dynastyValue: number;
};

// @spec DFF-SPKV-050
// @spec DFF-SPKV-051
// @spec DFF-BOT-042
export function buildTradeableBotAssets({
  teamId,
  draftOrder,
  usedPickNumbers,
  rosterPlayerIds,
  archetype,
  rosterPlayers = [],
  futurePickAssets,
  playerValues,
  futurePickValues,
  startupPickValues,
}: BuildTradeableBotAssetsOptions): ScoredBotTradeAsset[] {
  const tradeableAssets: ScoredBotTradeAsset[] = [];
  const protectedPlayerIds = getProtectedPlayerIds(archetype, rosterPlayers);

  for (const playerId of rosterPlayerIds) {
    if (protectedPlayerIds.has(playerId)) {
      continue;
    }

    const asset: PlayerTradeAsset = { type: 'player', player_id: playerId };
    tradeableAssets.push({
      asset,
      dynastyValue: scoreBotTradeAsset(asset, {
        playerValues,
        futurePickValues,
        startupPickValues,
      }),
    });
  }

  for (const slot of draftOrder) {
    if (slot.teamId !== teamId || usedPickNumbers.has(slot.pickNumber)) {
      continue;
    }

    const asset: PickSlotTradeAsset = {
      type: 'pick_slot',
      draft_order_id: slot.draftOrderId,
      pick_number: slot.pickNumber,
    };

    tradeableAssets.push({
      asset,
      dynastyValue: scoreBotTradeAsset(asset, {
        playerValues,
        futurePickValues,
        startupPickValues,
      }),
    });
  }

  for (const futurePickAsset of futurePickAssets) {
    const asset: FuturePickTradeAsset = {
      type: 'future_pick',
      year: futurePickAsset.year,
      round: futurePickAsset.round,
    };

    tradeableAssets.push({
      asset,
      dynastyValue: scoreBotTradeAsset(asset, {
        playerValues,
        futurePickValues,
        startupPickValues,
      }),
    });
  }

  return tradeableAssets;
}

// @spec DFF-SPKV-051
export function summarizeBotTrade({
  assetsSent,
  assetsReceived,
  playerValues,
  futurePickValues,
  startupPickValues,
}: SummarizeBotTradeOptions): {
  sentDynastyValue: number;
  receivedDynastyValue: number;
} {
  return {
    sentDynastyValue: sumAssetValues(assetsSent, {
      playerValues,
      futurePickValues,
      startupPickValues,
    }),
    receivedDynastyValue: sumAssetValues(assetsReceived, {
      playerValues,
      futurePickValues,
      startupPickValues,
    }),
  };
}

// @spec DFF-SPKV-050
// @spec DFF-SPKV-051
// @spec DFF-BOT-050
// @spec DFF-BOT-051
export function evaluateBotTrade({
  acceptanceThreshold,
  assetsSent,
  assetsReceived,
  playerValues,
  futurePickValues,
  startupPickValues,
  archetype,
  rosterPlayers = [],
}: EvaluateBotTradeOptions): boolean {
  const protectedPlayerIds = getProtectedPlayerIds(archetype, rosterPlayers);

  if (assetsSent.some((asset) => asset.type === 'player' && protectedPlayerIds.has(asset.player_id))) {
    return false;
  }

  const summary = summarizeBotTrade({
    assetsSent,
    assetsReceived,
    playerValues,
    futurePickValues,
    startupPickValues,
  });

  return summary.receivedDynastyValue >= summary.sentDynastyValue * acceptanceThreshold;
}

// @spec DFF-SPKV-051
export function scoreBotTradeAsset(asset: BotTradeAsset, context: TradeValueContext): number {
  if (asset.type === 'player') {
    return context.playerValues.get(asset.player_id) ?? 0;
  }

  if (asset.type === 'future_pick') {
    return context.futurePickValues.get(toFuturePickValueKey(asset.year, asset.round)) ?? 0;
  }

  return asset.pick_number === undefined ? 0 : context.startupPickValues.get(asset.pick_number) ?? 0;
}

// @spec DFF-SPKV-051
function sumAssetValues(assets: BotTradeAsset[], context: TradeValueContext): number {
  return assets.reduce((total, asset) => total + scoreBotTradeAsset(asset, context), 0);
}

// @spec DFF-SPKV-051
function toFuturePickValueKey(year: number, round: number): string {
  return `${year}:${round}`;
}

// @spec DFF-BOT-042
// @spec DFF-BOT-050
// @spec DFF-BOT-051
function getProtectedPlayerIds(
  archetype: TeamArchetype | null | undefined,
  rosterPlayers: TradeEvaluationPlayer[],
): Set<string> {
  if (archetype === 'rb_heavy') {
    return new Set(
      rosterPlayers
        .filter((player) => player.position === 'RB')
        .sort((left, right) => right.dynastyValue - left.dynastyValue || left.id.localeCompare(right.id))
        .slice(0, 2)
        .map((player) => player.id),
    );
  }

  if (archetype === 'qb_early') {
    const startingQuarterback = rosterPlayers
      .filter((player) => player.position === 'QB')
      .sort((left, right) => right.dynastyValue - left.dynastyValue || left.id.localeCompare(right.id))[0];

    return new Set(startingQuarterback ? [startingQuarterback.id] : []);
  }

  if (archetype === 'win_now') {
    return new Set(
      rosterPlayers
        .filter((player) => (player.age ?? 0) >= 27 && player.dynastyValue >= 4000)
        .map((player) => player.id),
    );
  }

  return new Set();
}
