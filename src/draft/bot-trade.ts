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

export type BotTradeTeamContext = {
  teamId: string;
  archetype?: TeamArchetype | null;
  rosterPlayerIds: string[];
  rosterPlayers: TradeEvaluationPlayer[];
  futurePickAssets: Array<{ year: number; round: number }>;
};

export type BotToUserTradeProposal = {
  assetsSent: BotTradeAsset[];
  assetsReceived: BotTradeAsset[];
  sentDynastyValue: number;
  receivedDynastyValue: number;
};

// @spec DFF-BOT-041
// @spec DFF-BOT-043
export type BotToBotTradeProposal = BotToUserTradeProposal & {
  receivingTeamId: string;
};

export type TradeEvaluationPlayer = {
  id: string;
  position: string;
  age: number | null;
  dynastyValue: number;
};

// @spec DFF-BOT-040
export function shouldInitiatePrePickTrade({
  probability,
  random,
}: {
  probability: number;
  random: () => number;
}): boolean {
  return random() < probability;
}

// @spec DFF-BOT-041
// @spec DFF-BOT-042
// @spec DFF-BOT-043
// @spec DFF-BOT-044
export function findBotToBotTradeOffer({
  botTeam,
  otherTeams,
  acceptanceThreshold,
  draftOrder,
  usedPickNumbers,
  playerValues,
  futurePickValues,
  startupPickValues,
}: {
  botTeam: BotTradeTeamContext;
  otherTeams: BotTradeTeamContext[];
  acceptanceThreshold: number;
  draftOrder: DraftSlotOwnership[];
  usedPickNumbers: Set<number>;
  playerValues: Map<string, number>;
  futurePickValues: Map<string, number>;
  startupPickValues: Map<number, number>;
}): BotToBotTradeProposal | null {
  const botAssets = buildTradeableBotAssets({
    teamId: botTeam.teamId,
    draftOrder,
    usedPickNumbers,
    rosterPlayerIds: botTeam.rosterPlayerIds,
    archetype: botTeam.archetype,
    rosterPlayers: botTeam.rosterPlayers,
    futurePickAssets: botTeam.futurePickAssets,
    playerValues,
    futurePickValues,
    startupPickValues,
  });

  if (botAssets.length === 0) {
    return null;
  }

  const playerDetails = new Map<string, TradeEvaluationPlayer>();
  for (const team of [botTeam, ...otherTeams]) {
    for (const player of team.rosterPlayers) {
      playerDetails.set(player.id, player);
    }
  }

  const targets = otherTeams.flatMap((team) =>
    buildTradeableBotAssets({
      teamId: team.teamId,
      draftOrder,
      usedPickNumbers,
      rosterPlayerIds: team.rosterPlayerIds,
      archetype: team.archetype,
      rosterPlayers: team.rosterPlayers,
      futurePickAssets: team.futurePickAssets,
      playerValues,
      futurePickValues,
      startupPickValues,
    }).map((asset) => ({ ...asset, receivingTeamId: team.teamId })),
  );

  const rankedTargets = targets.sort((left, right) => {
    const leftScore = scoreDesiredAsset(left, botTeam.archetype, playerDetails);
    const rightScore = scoreDesiredAsset(right, botTeam.archetype, playerDetails);
    return rightScore - leftScore || right.dynastyValue - left.dynastyValue;
  });

  for (const target of rankedTargets) {
    const offer = chooseThresholdOfferPackage(
      botAssets.filter((asset) => !sameTradeAsset(asset.asset, target.asset)),
      target.dynastyValue * acceptanceThreshold,
    );

    if (!offer) {
      continue;
    }

    return {
      receivingTeamId: target.receivingTeamId,
      assetsSent: offer.map((entry) => entry.asset),
      assetsReceived: [target.asset],
      sentDynastyValue: offer.reduce((total, entry) => total + entry.dynastyValue, 0),
      receivedDynastyValue: target.dynastyValue,
    };
  }

  return null;
}

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

// @spec DFF-BOT-045
// @spec DFF-BOT-046
// @spec DFF-BOT-048
export function findBotToUserTradeOffer({
  currentRound,
  recentBotToUserOfferRounds,
  botTeam,
  userTeam,
  draftOrder,
  usedPickNumbers,
  playerValues,
  futurePickValues,
  startupPickValues,
}: {
  currentRound: number;
  recentBotToUserOfferRounds: number[];
  botTeam: BotTradeTeamContext;
  userTeam: BotTradeTeamContext;
  draftOrder: DraftSlotOwnership[];
  usedPickNumbers: Set<number>;
  playerValues: Map<string, number>;
  futurePickValues: Map<string, number>;
  startupPickValues: Map<number, number>;
}): BotToUserTradeProposal | null {
  if (recentBotToUserOfferRounds.some((round) => round >= currentRound - 2)) {
    return null;
  }

  const botAssets = buildTradeableBotAssets({
    teamId: botTeam.teamId,
    draftOrder,
    usedPickNumbers,
    rosterPlayerIds: botTeam.rosterPlayerIds,
    archetype: botTeam.archetype,
    rosterPlayers: botTeam.rosterPlayers,
    futurePickAssets: botTeam.futurePickAssets,
    playerValues,
    futurePickValues,
    startupPickValues,
  });
  const userAssets = buildTradeableBotAssets({
    teamId: userTeam.teamId,
    draftOrder,
    usedPickNumbers,
    rosterPlayerIds: userTeam.rosterPlayerIds,
    archetype: userTeam.archetype,
    rosterPlayers: userTeam.rosterPlayers,
    futurePickAssets: userTeam.futurePickAssets,
    playerValues,
    futurePickValues,
    startupPickValues,
  });

  if (botAssets.length === 0 || userAssets.length === 0) {
    return null;
  }

  const playerDetails = new Map<string, TradeEvaluationPlayer>();
  for (const player of [...botTeam.rosterPlayers, ...userTeam.rosterPlayers]) {
    playerDetails.set(player.id, player);
  }

  const desiredAssets = [...userAssets].sort((left, right) => {
    const leftScore = scoreDesiredAsset(left, botTeam.archetype, playerDetails);
    const rightScore = scoreDesiredAsset(right, botTeam.archetype, playerDetails);
    return rightScore - leftScore || right.dynastyValue - left.dynastyValue;
  });
  const outboundAssets = [...botAssets].sort((left, right) => {
    const leftScore = scoreOutboundAsset(left, botTeam.archetype, playerDetails);
    const rightScore = scoreOutboundAsset(right, botTeam.archetype, playerDetails);
    return leftScore - rightScore || left.dynastyValue - right.dynastyValue;
  });

  for (const targetAsset of desiredAssets) {
    const offer = chooseOfferPackage(outboundAssets, targetAsset.dynastyValue);

    if (!offer) {
      continue;
    }

    return {
      assetsSent: offer.map((entry) => entry.asset),
      assetsReceived: [targetAsset.asset],
      sentDynastyValue: offer.reduce((total, entry) => total + entry.dynastyValue, 0),
      receivedDynastyValue: targetAsset.dynastyValue,
    };
  }

  return null;
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

// @spec DFF-BOT-045
function scoreDesiredAsset(
  asset: ScoredBotTradeAsset,
  archetype: TeamArchetype | null | undefined,
  playerDetails: Map<string, TradeEvaluationPlayer>,
): number {
  return asset.dynastyValue * getDesiredAssetMultiplier(asset.asset, archetype, playerDetails);
}

// @spec DFF-BOT-045
function scoreOutboundAsset(
  asset: ScoredBotTradeAsset,
  archetype: TeamArchetype | null | undefined,
  playerDetails: Map<string, TradeEvaluationPlayer>,
): number {
  return asset.dynastyValue * getOutboundAssetMultiplier(asset.asset, archetype, playerDetails);
}

// @spec DFF-BOT-045
function chooseOfferPackage(
  outboundAssets: ScoredBotTradeAsset[],
  targetValue: number,
): ScoredBotTradeAsset[] | null {
  const minimumOfferValue = Math.ceil(targetValue * 0.82);
  const maximumOfferValue = Math.floor(targetValue * 0.97);
  let bestOffer: ScoredBotTradeAsset[] | null = null;
  let bestOfferValue = -1;

  for (let firstIndex = 0; firstIndex < outboundAssets.length; firstIndex += 1) {
    const first = outboundAssets[firstIndex]!;
    const firstValue = first.dynastyValue;

    if (firstValue >= minimumOfferValue && firstValue <= maximumOfferValue && firstValue > bestOfferValue) {
      bestOffer = [first];
      bestOfferValue = firstValue;
    }

    for (let secondIndex = firstIndex + 1; secondIndex < outboundAssets.length; secondIndex += 1) {
      const second = outboundAssets[secondIndex]!;
      const secondValue = firstValue + second.dynastyValue;

      if (secondValue >= minimumOfferValue && secondValue <= maximumOfferValue && secondValue > bestOfferValue) {
        bestOffer = [first, second];
        bestOfferValue = secondValue;
      }

      for (let thirdIndex = secondIndex + 1; thirdIndex < outboundAssets.length; thirdIndex += 1) {
        const third = outboundAssets[thirdIndex]!;
        const thirdValue = secondValue + third.dynastyValue;

        if (thirdValue >= minimumOfferValue && thirdValue <= maximumOfferValue && thirdValue > bestOfferValue) {
          bestOffer = [first, second, third];
          bestOfferValue = thirdValue;
        }
      }
    }
  }

  return bestOffer;
}

// @spec DFF-BOT-043
function chooseThresholdOfferPackage(
  outboundAssets: ScoredBotTradeAsset[],
  minimumOfferValue: number,
): ScoredBotTradeAsset[] | null {
  const packagesByValue = new Map<number, ScoredBotTradeAsset[]>([[0, []]]);
  let bestOfferValue = Number.POSITIVE_INFINITY;
  let bestOffer: ScoredBotTradeAsset[] | null = null;

  for (const asset of outboundAssets) {
    for (const [currentValue, currentPackage] of [...packagesByValue]) {
      const packageValue = currentValue + asset.dynastyValue;

      if (packageValue >= bestOfferValue) {
        continue;
      }

      const candidatePackage = [...currentPackage, asset];

      if (packageValue >= minimumOfferValue) {
        bestOfferValue = packageValue;
        bestOffer = candidatePackage;
        continue;
      }

      if (!packagesByValue.has(packageValue)) {
        packagesByValue.set(packageValue, candidatePackage);
      }
    }
  }

  return bestOffer;
}

// @spec DFF-BOT-043
function sameTradeAsset(left: BotTradeAsset, right: BotTradeAsset): boolean {
  if (left.type !== right.type) {
    return false;
  }

  if (left.type === 'player' && right.type === 'player') {
    return left.player_id === right.player_id;
  }

  if (left.type === 'future_pick' && right.type === 'future_pick') {
    return left.year === right.year && left.round === right.round;
  }

  return left.pick_number === right.pick_number;
}

// @spec DFF-BOT-045
function getDesiredAssetMultiplier(
  asset: BotTradeAsset,
  archetype: TeamArchetype | null | undefined,
  playerDetails: Map<string, TradeEvaluationPlayer>,
): number {
  if (asset.type === 'player') {
    const player = playerDetails.get(asset.player_id);

    if (!player) {
      return 1;
    }

    if (archetype === 'rb_heavy') {
      return player.position === 'RB' ? 1.2 : 1;
    }

    if (archetype === 'qb_early') {
      return player.position === 'QB' ? 1.2 : 1;
    }

    if (archetype === 'punt') {
      return (player.age ?? 99) <= 24 ? 1.15 : 0.95;
    }

    if (archetype === 'win_now') {
      return (player.age ?? 0) >= 25 ? 1.1 : 0.95;
    }

    return 1;
  }

  if (asset.type === 'future_pick') {
    if (archetype === 'punt') {
      return 1.18;
    }

    if (archetype === 'win_now') {
      return 0.92;
    }

    return 1;
  }

  if (archetype === 'win_now') {
    return 1.08;
  }

  return 1;
}

// @spec DFF-BOT-045
function getOutboundAssetMultiplier(
  asset: BotTradeAsset,
  archetype: TeamArchetype | null | undefined,
  playerDetails: Map<string, TradeEvaluationPlayer>,
): number {
  if (asset.type === 'player') {
    const player = playerDetails.get(asset.player_id);

    if (!player) {
      return 1;
    }

    if (archetype === 'rb_heavy') {
      return player.position === 'RB' ? 1.25 : 0.95;
    }

    if (archetype === 'qb_early') {
      return player.position === 'QB' ? 1.25 : 0.95;
    }

    if (archetype === 'punt') {
      return (player.age ?? 99) <= 24 ? 1.2 : 0.92;
    }

    if (archetype === 'win_now') {
      return (player.age ?? 0) >= 25 ? 1.15 : 0.95;
    }

    return 1;
  }

  if (asset.type === 'future_pick') {
    if (archetype === 'punt') {
      return 1.25;
    }

    if (archetype === 'win_now') {
      return 0.9;
    }

    return 0.98;
  }

  if (archetype === 'punt') {
    return 0.92;
  }

  return 1;
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
