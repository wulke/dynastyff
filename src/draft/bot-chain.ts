// @spec DFF-ENGINE-030
// @spec DFF-ENGINE-031
// @spec DFF-ENGINE-032
// @spec DFF-ENGINE-033
// @spec DFF-ENGINE-034
// @spec DFF-ENGINE-035
// @spec DFF-ENGINE-036
// @spec DFF-ENGINE-037
// @spec DFF-ENGINE-038
// @spec DFF-ENGINE-040
// @spec DFF-ENGINE-041
// @spec DFF-ENGINE-042
// @spec DFF-ENGINE-039
// @spec DFF-ENGINE-039b
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';

import { createDrizzleDb } from '../db/client.js';
import { draftOrder, drafts, picks, teams, tradeStatuses } from '../db/schema.js';
import {
  getAcceptanceThresholdForArchetype,
  loadStartupArchetypeConfig,
  type ArchetypeConfig,
} from './archetype-config.js';
import { filterBotPickCandidates, scoreBotPickCandidate } from './bot-pick-scoring.js';
import {
  evaluateBotTrade,
  findBotToBotTradeOffer,
  findBotToUserTradeOffer,
  shouldInitiatePrePickTrade,
} from './bot-trade.js';
import { getAvailablePlayersForDraft, type DraftAvailablePlayer } from './available-players.js';
import { getDraftState, recordPick, resolveTrade, type DraftStateSnapshot } from './service.js';
import { emitTradeOfferedEvent, emitTradeResolvedEvent } from './stream.js';

type TradeStatus = (typeof tradeStatuses)[number];

export type BotPickAction = {
  type: 'pick';
  playerId: string;
};

export type BotTradeAction = {
  type: 'trade';
  tradeId: string;
  initiatingTeamId: string;
  receivingTeamId: string;
  assetsSent: unknown[];
  assetsReceived: unknown[];
  isBotToBot: boolean;
  autoEvaluateByReceivingBot?: boolean;
};

export type BotAction = BotPickAction | BotTradeAction;

type CurrentOpenBotSlot = {
  id: string;
  draftId: string;
  teamId: string;
  pickNumber: number;
  round: number;
  pickInRound: number;
  isUser: boolean;
};

type PendingTradeState = {
  tradeId: string;
  pickNumber: number;
  round: number;
  initiatingTeamId: string;
  receivingTeamId: string;
  assetsSent: unknown[];
  assetsReceived: unknown[];
  resolve: (result: { status: TradeStatus; createdAt: string }) => void;
  reject: (error: unknown) => void;
};

type SubmitUserTradeOfferInput = {
  draftId: string;
  targetTeamId: string;
  offeredAssets: unknown[];
  requestedAssets: unknown[];
};

export type DecideBotActionContext = {
  draftId: string;
  slot: CurrentOpenBotSlot;
  availablePlayers: DraftAvailablePlayer[];
  archetypeConfig: ArchetypeConfig;
  draftState: DraftStateSnapshot;
};

export type BotChainCoordinator = {
  trigger: (draftId: string) => void;
  waitForIdle: (draftId: string) => Promise<void>;
  resolvePendingTrade: (draftId: string, status: TradeStatus) => boolean;
  submitUserTradeOffer: (input: SubmitUserTradeOfferInput) => string;
};

type CreateBotChainCoordinatorOptions = {
  databasePath: string;
  archetypeConfig?: ArchetypeConfig;
  randomness?: number;
  now?: () => string;
  random?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  decideBotAction?: (context: DecideBotActionContext) => Promise<BotAction> | BotAction;
  idGenerator?: () => string;
};

const defaultNow = () => new Date().toISOString();
const defaultRandom = () => Math.random();
const defaultIdGenerator = () => randomUUID();

export class TradeOfferCoordinatorError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

// @spec DFF-ENGINE-031
export function calculateBotPickDelayMs(random: () => number): number {
  return 3000 + Math.floor(random() * 2001);
}

// @spec DFF-ENGINE-031
function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

type WeightedPickCandidate = {
  id: string;
  score: number;
};

// @spec DFF-BOT-030
// @spec DFF-BOT-031
function selectWeightedRandomPlayer(
  scoredPlayers: WeightedPickCandidate[],
  randomness: number,
  random: () => number,
): string {
  const bestPlayer = scoredPlayers[0];

  if (!bestPlayer) {
    throw new Error('Cannot process a bot pick without an available player.');
  }

  if (randomness === 0 || scoredPlayers.length === 1) {
    return bestPlayer.id;
  }

  const weightedPlayers = scoredPlayers.map((player) => ({
    id: player.id,
    weight: Math.max(player.score * (1 + randomness * (random() - 0.5) * 2), 0),
  }));
  const totalWeight = weightedPlayers.reduce((sum, player) => sum + player.weight, 0);

  if (totalWeight <= 0) {
    return bestPlayer.id;
  }

  let threshold = random() * totalWeight;

  for (const player of weightedPlayers) {
    threshold -= player.weight;

    if (threshold < 0) {
      return player.id;
    }
  }

  return weightedPlayers[weightedPlayers.length - 1]!.id;
}

// @spec DFF-BOT-031
function normalizeBotPickRandomness(randomness: number): number {
  if (randomness < 0 || randomness > 1 || Number.isNaN(randomness)) {
    throw new Error('[draft] Invalid bot-pick randomness: expected a number between 0.0 and 1.0.');
  }

  return randomness;
}

// @spec DFF-ENGINE-032
// @spec DFF-BOT-030
// @spec DFF-BOT-031
// @spec DFF-BOT-040
// @spec DFF-BOT-041
// @spec DFF-BOT-043
// @spec DFF-BOT-044
function defaultDecideBotAction(
  context: DecideBotActionContext,
  randomness: number,
  random: () => number,
  idGenerator: () => string,
): BotAction {
  const draftState = context.draftState;
  const team = draftState.teams.find((draftTeam) => draftTeam.id === context.slot.teamId);
  const userTeam = draftState.teams.find((draftTeam) => draftTeam.is_user);
  const botArchetype = team?.archetype ?? 'balanced';
  const rosteredPlayerIds = new Set(
    draftState.roster_players
      .filter((rosterPlayer) => rosterPlayer.team_id === context.slot.teamId)
      .map((rosterPlayer) => rosterPlayer.player_id),
  );
  const playersById = new Map(
    [...draftState.available_players, ...draftState.drafted_players].map((player) => [player.id, player]),
  );
  const rosteredPlayers = [...rosteredPlayerIds]
    .map((playerId) => playersById.get(playerId))
    .filter((player): player is DraftAvailablePlayer => Boolean(player));

  const userRosteredPlayerIds = new Set(
    draftState.roster_players
      .filter((rosterPlayer) => rosterPlayer.team_id === userTeam?.id)
      .map((rosterPlayer) => rosterPlayer.player_id),
  );
  const userRosteredPlayers = [...userRosteredPlayerIds]
    .map((playerId) => playersById.get(playerId))
    .filter((player): player is DraftAvailablePlayer => Boolean(player));
  const draftOrderOwnership = draftState.draft_order.map((slot) => ({
    draftOrderId: `${draftState.draft_id}:${slot.pick_number}`,
    teamId: slot.team_id,
    pickNumber: slot.pick_number,
  }));
  const usedPickNumbers = new Set(draftState.picks.map((pick) => pick.pick_number));
  const playerValues = new Map(
    [...draftState.available_players, ...draftState.drafted_players].map((player) => [player.id, player.dynasty_value]),
  );
  const futurePickValues = new Map<string, number>();
  for (const asset of draftState.team_pick_assets) {
    futurePickValues.set(`${asset.year}:${asset.round}`, getFuturePickDynastyValue(asset.round));
  }
  const proactiveOfferRounds = draftState.trades
    .filter(
      (trade) => trade.initiating_team_id === context.slot.teamId && userTeam?.id === trade.receiving_team_id,
    )
    .map((trade) => trade.round);
  const proactiveTradeProbability =
    context.archetypeConfig.archetypes[botArchetype].tradeAggressivenessProbability;
  const otherBotTeams = draftState.teams
    .filter((draftTeam) => !draftTeam.is_user && draftTeam.id !== context.slot.teamId)
    .map((draftTeam) => {
      const teamRosteredPlayerIds = new Set(
        draftState.roster_players
          .filter((rosterPlayer) => rosterPlayer.team_id === draftTeam.id)
          .map((rosterPlayer) => rosterPlayer.player_id),
      );

      return {
        teamId: draftTeam.id,
        archetype: draftTeam.archetype,
        rosterPlayerIds: [...teamRosteredPlayerIds],
        rosterPlayers: [...teamRosteredPlayerIds]
          .map((playerId) => playersById.get(playerId))
          .filter((player): player is DraftAvailablePlayer => Boolean(player))
          .map((player) => ({
            id: player.id,
            position: player.position,
            age: player.age,
            dynastyValue: player.dynasty_value,
          })),
        futurePickAssets: draftState.team_pick_assets
          .filter((asset) => asset.team_id === draftTeam.id)
          .map((asset) => ({ year: asset.year, round: asset.round })),
      };
    });

  // @spec DFF-BOT-040
  // @spec DFF-BOT-041
  // @spec DFF-BOT-043
  // @spec DFF-BOT-044
  if (
    rosteredPlayers.length > 0 &&
    otherBotTeams.length > 0 &&
    shouldInitiatePrePickTrade({ probability: proactiveTradeProbability, random })
  ) {
    const proposal = findBotToBotTradeOffer({
      botTeam: {
        teamId: context.slot.teamId,
        archetype: botArchetype,
        rosterPlayerIds: [...rosteredPlayerIds],
        rosterPlayers: rosteredPlayers.map((player) => ({
          id: player.id,
          position: player.position,
          age: player.age,
          dynastyValue: player.dynasty_value,
        })),
        futurePickAssets: draftState.team_pick_assets
          .filter((asset) => asset.team_id === context.slot.teamId)
          .map((asset) => ({ year: asset.year, round: asset.round })),
      },
      otherTeams: otherBotTeams,
      acceptanceThreshold: context.archetypeConfig.archetypes[botArchetype].acceptanceThreshold,
      draftOrder: draftOrderOwnership,
      usedPickNumbers,
      playerValues,
      futurePickValues,
      startupPickValues: buildConservativeStartupPickValues({
        currentPickNumber: draftState.current_pick_number,
        availablePlayers: draftState.available_players,
        startupPickValues: draftState.startup_pick_values,
      }),
    });

    if (proposal) {
      return {
        type: 'trade',
        tradeId: idGenerator(),
        initiatingTeamId: context.slot.teamId,
        receivingTeamId: proposal.receivingTeamId,
        assetsSent: proposal.assetsSent,
        assetsReceived: proposal.assetsReceived,
        isBotToBot: true,
        autoEvaluateByReceivingBot: true,
      };
    }
  }

  if (userTeam && userRosteredPlayers.length > 0 && random() < proactiveTradeProbability) {
    const proposal = findBotToUserTradeOffer({
      currentRound: context.slot.round,
      recentBotToUserOfferRounds: proactiveOfferRounds,
      botTeam: {
        teamId: context.slot.teamId,
        archetype: botArchetype,
        rosterPlayerIds: [...rosteredPlayerIds],
        rosterPlayers: rosteredPlayers.map((player) => ({
          id: player.id,
          position: player.position,
          age: player.age,
          dynastyValue: player.dynasty_value,
        })),
        futurePickAssets: draftState.team_pick_assets
          .filter((asset) => asset.team_id === context.slot.teamId)
          .map((asset) => ({ year: asset.year, round: asset.round })),
      },
      userTeam: {
        teamId: userTeam.id,
        archetype: null,
        rosterPlayerIds: [...userRosteredPlayerIds],
        rosterPlayers: userRosteredPlayers.map((player) => ({
          id: player.id,
          position: player.position,
          age: player.age,
          dynastyValue: player.dynasty_value,
        })),
        futurePickAssets: draftState.team_pick_assets
          .filter((asset) => asset.team_id === userTeam.id)
          .map((asset) => ({ year: asset.year, round: asset.round })),
      },
      draftOrder: draftOrderOwnership,
      usedPickNumbers,
      playerValues,
      futurePickValues,
      startupPickValues: buildConservativeStartupPickValues({
        currentPickNumber: draftState.current_pick_number,
        availablePlayers: draftState.available_players,
        startupPickValues: draftState.startup_pick_values,
      }),
    });

    if (proposal) {
      return {
        type: 'trade',
        tradeId: idGenerator(),
        initiatingTeamId: context.slot.teamId,
        receivingTeamId: userTeam.id,
        assetsSent: proposal.assetsSent,
        assetsReceived: proposal.assetsReceived,
        isBotToBot: false,
      };
    }
  }

  return {
    type: 'pick',
    playerId: selectWeightedRandomPlayer(
      filterBotPickCandidates({
        availablePlayers: context.availablePlayers,
        archetype: botArchetype,
        archetypeConfig: context.archetypeConfig,
        scorePlayer: (player) =>
          scoreBotPickCandidate({
            player,
            archetype: botArchetype,
            archetypeConfig: context.archetypeConfig,
            rosterConfig: draftState.roster_config,
            rosteredPlayers,
            round: context.slot.round,
            randomness,
            random,
            tePremiumTier: draftState.te_premium_tier,
          }),
      }),
      randomness,
      random,
    ),
  };
}

// @spec DFF-SPKV-052
export function buildConservativeStartupPickValues({
  currentPickNumber,
  availablePlayers,
  startupPickValues,
}: {
  currentPickNumber: number | null;
  availablePlayers: DraftAvailablePlayer[];
  startupPickValues: Array<{
    global_pick_number: number;
    dynasty_value: number;
  }>;
}): Map<number, number> {
  const conservativeStartupPickValues = new Map<number, number>();
  const shouldUseDerivedValues = currentPickNumber !== null && availablePlayers.length > 0;

  for (const entry of startupPickValues) {
    const etlValue = entry.dynasty_value;

    if (!shouldUseDerivedValues) {
      conservativeStartupPickValues.set(entry.global_pick_number, etlValue);
      continue;
    }

    const estimatedRank = Math.max(0, entry.global_pick_number - currentPickNumber - 1);
    const derivedValue = availablePlayers[estimatedRank]?.dynasty_value ?? 0;

    // Future archetypes can override this conservative floor during map construction.
    conservativeStartupPickValues.set(entry.global_pick_number, Math.min(etlValue, derivedValue));
  }

  return conservativeStartupPickValues;
}

// @spec DFF-ENGINE-030
// @spec DFF-ENGINE-031
// @spec DFF-ENGINE-032
// @spec DFF-ENGINE-033
// @spec DFF-ENGINE-039
// @spec DFF-ENGINE-039b
// @spec DFF-BOT-001
// @spec DFF-BOT-002
// @spec DFF-BOT-003
// @spec DFF-BOT-004
// @spec DFF-BOT-030
// @spec DFF-BOT-031
// @spec DFF-BOT-040
export function createBotChainCoordinator({
  databasePath,
  archetypeConfig = loadStartupArchetypeConfig(),
  randomness,
  now = defaultNow,
  random = defaultRandom,
  sleep = defaultSleep,
  decideBotAction,
  idGenerator = defaultIdGenerator,
}: CreateBotChainCoordinatorOptions): BotChainCoordinator {
  const activeChains = new Map<string, Promise<void>>();
  const pendingTrades = new Map<string, PendingTradeState>();
  const botPickRandomness = normalizeBotPickRandomness(randomness ?? archetypeConfig.randomness);
  const resolvedDecideBotAction =
    decideBotAction ??
    ((context: DecideBotActionContext) => defaultDecideBotAction(context, botPickRandomness, random, idGenerator));

  async function runBotChain(draftId: string): Promise<void> {
    try {
      while (true) {
        if (pendingTrades.has(draftId)) {
          return;
        }

        const nextSlot = getCurrentOpenSlot({ databasePath, draftId });

        if (!nextSlot || nextSlot.isUser) {
          return;
        }

        await sleep(calculateBotPickDelayMs(random));

        const refreshedSlot = getCurrentOpenSlot({ databasePath, draftId });

        if (pendingTrades.has(draftId) || !refreshedSlot || refreshedSlot.isUser) {
          return;
        }

        const draftState = getDraftState({ databasePath, draftId });

        if (!draftState) {
          return;
        }

        const availablePlayers = draftState.available_players;
        const action = await resolvedDecideBotAction({
          draftId,
          slot: refreshedSlot,
          availablePlayers,
          archetypeConfig,
          draftState,
        });

        if (action.type === 'trade') {
          await awaitTradeResolution(
            draftId,
            refreshedSlot,
            action,
            pendingTrades,
            action.autoEvaluateByReceivingBot
              ? () => {
                  const status = evaluateUserTradeOffer({
                    archetypeConfig,
                    draftState,
                    targetTeamId: action.receivingTeamId,
                    assetsSent: action.assetsSent.map(parseTradeAssetOrThrow),
                    assetsReceived: action.assetsReceived.map(parseTradeAssetOrThrow),
                  })
                    ? 'accepted'
                    : 'declined';

                  queueMicrotask(() => {
                    coordinator.resolvePendingTrade(draftId, status);
                  });
                }
              : undefined,
          );
          continue;
        }

        recordPick({
          databasePath,
          draftOrderId: refreshedSlot.id,
          playerId: action.playerId,
          now,
        });
      }
    } finally {
      activeChains.delete(draftId);
    }
  }

  const coordinator: BotChainCoordinator = {
    trigger(draftId) {
      if (activeChains.has(draftId)) {
        return;
      }

      const chainPromise = runBotChain(draftId).catch((error) => {
        console.error(`[draft] bot chain failed for ${draftId}`, error);
      });
      activeChains.set(draftId, chainPromise);
    },
    waitForIdle(draftId) {
      return activeChains.get(draftId) ?? Promise.resolve();
    },
    resolvePendingTrade(draftId, status) {
      const pendingTrade = pendingTrades.get(draftId);

      if (!pendingTrade) {
        return false;
      }

      try {
        const { createdAt } = resolveTrade({
          databasePath,
          tradeId: pendingTrade.tradeId,
          draftId,
          pickNumber: pendingTrade.pickNumber,
          round: pendingTrade.round,
          initiatingTeamId: pendingTrade.initiatingTeamId,
          receivingTeamId: pendingTrade.receivingTeamId,
          assetsSent: pendingTrade.assetsSent,
          assetsReceived: pendingTrade.assetsReceived,
          status,
          now,
        });

        pendingTrade.resolve({ status, createdAt });
        return true;
      } catch (error) {
        pendingTrade.reject(error);
        throw error;
      } finally {
        pendingTrades.delete(draftId);
      }
    },
    submitUserTradeOffer({ draftId, targetTeamId, offeredAssets, requestedAssets }) {
      const draftState = getDraftState({ databasePath, draftId });

      if (!draftState) {
        throw new TradeOfferCoordinatorError('Draft not found.', 404);
      }

      const userTeam = draftState.teams.find((team) => team.is_user);
      const targetTeam = draftState.teams.find((team) => team.id === targetTeamId);
      const pendingTrade = pendingTrades.get(draftId);

      if (pendingTrade) {
        const isCounterToPendingBotOffer =
          Boolean(userTeam) &&
          pendingTrade.initiatingTeamId === targetTeamId &&
          pendingTrade.receivingTeamId === userTeam?.id;

        if (!isCounterToPendingBotOffer) {
          throw new TradeOfferCoordinatorError('A trade is already pending for this draft.', 409);
        }
      }

      if (!userTeam || !targetTeam || targetTeam.is_user) {
        throw new TradeOfferCoordinatorError('Invalid trade offer.', 400);
      }

      const parsedOfferedAssets = offeredAssets.map(parseTradeAssetOrThrow);
      const parsedRequestedAssets = requestedAssets.map(parseTradeAssetOrThrow);

      if (
        !assetsBelongToTeam({
          draftState,
          teamId: userTeam.id,
          assets: parsedOfferedAssets,
        }) ||
        !assetsBelongToTeam({
          draftState,
          teamId: targetTeam.id,
          assets: parsedRequestedAssets,
        })
      ) {
        throw new TradeOfferCoordinatorError('Invalid trade offer.', 400);
      }

      const tradeId = idGenerator();
      const currentRound =
        draftState.current_pick_number === null
          ? 0
          : draftState.draft_order.find((slot) => slot.pick_number === draftState.current_pick_number)?.round ?? 0;

      if (pendingTrade) {
        const { createdAt } = resolveTrade({
          databasePath,
          tradeId: pendingTrade.tradeId,
          draftId,
          pickNumber: pendingTrade.pickNumber,
          round: pendingTrade.round,
          initiatingTeamId: pendingTrade.initiatingTeamId,
          receivingTeamId: pendingTrade.receivingTeamId,
          assetsSent: pendingTrade.assetsSent,
          assetsReceived: pendingTrade.assetsReceived,
          status: 'declined',
          now,
        });

        pendingTrades.set(draftId, {
          tradeId,
          pickNumber: draftState.current_pick_number ?? 0,
          round: currentRound,
          initiatingTeamId: userTeam.id,
          receivingTeamId: targetTeam.id,
          assetsSent: parsedOfferedAssets,
          assetsReceived: parsedRequestedAssets,
          resolve: () => undefined,
          reject: () => undefined,
        });
        pendingTrade.resolve({ status: 'declined', createdAt });
      } else {
        pendingTrades.set(draftId, {
          tradeId,
          pickNumber: draftState.current_pick_number ?? 0,
          round: currentRound,
          initiatingTeamId: userTeam.id,
          receivingTeamId: targetTeam.id,
          assetsSent: parsedOfferedAssets,
          assetsReceived: parsedRequestedAssets,
          resolve: () => undefined,
          reject: () => undefined,
        });
      }

      emitTradeOfferedEvent({
        draftId,
        tradeId,
        initiatingTeamId: userTeam.id,
        receivingTeamId: targetTeam.id,
        assetsSent: parsedOfferedAssets,
        assetsReceived: parsedRequestedAssets,
        isBotToBot: false,
      });

      queueMicrotask(() => {
        try {
          const status = evaluateUserTradeOffer({
            archetypeConfig,
            draftState,
            targetTeamId: targetTeam.id,
            assetsSent: parsedOfferedAssets,
            assetsReceived: parsedRequestedAssets,
          })
            ? 'accepted'
            : 'declined';

          const { createdAt } = resolveTrade({
            databasePath,
            tradeId,
            draftId,
            pickNumber: draftState.current_pick_number ?? 0,
            round: currentRound,
            initiatingTeamId: userTeam.id,
            receivingTeamId: targetTeam.id,
            assetsSent: parsedOfferedAssets,
            assetsReceived: parsedRequestedAssets,
            status,
            now,
          });

          emitTradeResolvedEvent({
            draftId,
            tradeId,
            status,
            assetsSent: parsedOfferedAssets,
            assetsReceived: parsedRequestedAssets,
            createdAt,
          });
        } catch (error) {
          console.error(`[draft] user trade offer failed for ${draftId}`, error);
        } finally {
          pendingTrades.delete(draftId);
          queueMicrotask(() => {
            if (!pendingTrades.has(draftId) && getCurrentOpenSlot({ databasePath, draftId })) {
              coordinator.trigger(draftId);
            }
          });
        }
      });

      return tradeId;
    },
  };

  return coordinator;
}

// @spec DFF-ENGINE-033
// @spec DFF-ENGINE-039
// @spec DFF-ENGINE-039b
async function awaitTradeResolution(
  draftId: string,
  slot: CurrentOpenBotSlot,
  action: BotTradeAction,
  pendingTrades: Map<string, PendingTradeState>,
  autoEvaluate?: () => void,
): Promise<void> {
  const result = await new Promise<{ status: TradeStatus; createdAt: string }>((resolve, reject) => {
    pendingTrades.set(draftId, {
      tradeId: action.tradeId,
      pickNumber: slot.pickNumber,
      round: slot.round,
      initiatingTeamId: action.initiatingTeamId,
      receivingTeamId: action.receivingTeamId,
      assetsSent: action.assetsSent,
      assetsReceived: action.assetsReceived,
      resolve,
      reject,
    });

    emitTradeOfferedEvent({
      draftId,
      tradeId: action.tradeId,
      initiatingTeamId: action.initiatingTeamId,
      receivingTeamId: action.receivingTeamId,
      assetsSent: action.assetsSent,
      assetsReceived: action.assetsReceived,
      isBotToBot: action.isBotToBot,
    });

    autoEvaluate?.();
  });

  emitTradeResolvedEvent({
    draftId,
    tradeId: action.tradeId,
    status: result.status,
    assetsSent: action.assetsSent,
    assetsReceived: action.assetsReceived,
    createdAt: result.createdAt,
  });
}

// @spec DFF-ENGINE-030
function getCurrentOpenSlot({
  databasePath,
  draftId,
}: {
  databasePath: string;
  draftId: string;
}): CurrentOpenBotSlot | null {
  const { sqlite, db } = createDrizzleDb(databasePath);

  try {
    const slot = db
      .select({
        id: draftOrder.id,
        draftId: draftOrder.draftId,
        teamId: draftOrder.teamId,
        pickNumber: draftOrder.pickNumber,
        round: draftOrder.round,
        pickInRound: draftOrder.pickInRound,
        isUser: teams.isUser,
        status: drafts.status,
      })
      .from(draftOrder)
      .innerJoin(teams, eq(draftOrder.teamId, teams.id))
      .innerJoin(drafts, eq(draftOrder.draftId, drafts.id))
      .leftJoin(picks, eq(draftOrder.id, picks.draftOrderId))
      .where(and(eq(draftOrder.draftId, draftId), isNull(picks.id)))
      .orderBy(asc(draftOrder.pickNumber))
      .get() as (CurrentOpenBotSlot & { status: string }) | undefined;

    if (!slot || slot.status !== 'in_progress') {
      return null;
    }

    return {
      id: slot.id,
      draftId: slot.draftId,
      teamId: slot.teamId,
      pickNumber: slot.pickNumber,
      round: slot.round,
      pickInRound: slot.pickInRound,
      isUser: slot.isUser,
    };
  } finally {
    sqlite.close();
  }
}

type SupportedTradeAsset =
  | { type: 'player'; player_id: string }
  | { type: 'pick_slot'; draft_order_id?: string; pick_number?: number }
  | { type: 'future_pick'; year: number; round: number };

function parseTradeAssetOrThrow(asset: unknown): SupportedTradeAsset {
  if (typeof asset !== 'object' || asset === null) {
    throw new TradeOfferCoordinatorError('Invalid trade offer.', 400);
  }

  const candidate = asset as {
    type?: unknown;
    player_id?: unknown;
    draft_order_id?: unknown;
    pick_number?: unknown;
    year?: unknown;
    round?: unknown;
  };

  if (candidate.type === 'player' && typeof candidate.player_id === 'string') {
    return { type: 'player', player_id: candidate.player_id };
  }

  if (
    candidate.type === 'pick_slot' &&
    ((typeof candidate.draft_order_id === 'string' && candidate.draft_order_id.length > 0) ||
      typeof candidate.pick_number === 'number')
  ) {
    return {
      type: 'pick_slot',
      draft_order_id: typeof candidate.draft_order_id === 'string' ? candidate.draft_order_id : undefined,
      pick_number: typeof candidate.pick_number === 'number' ? candidate.pick_number : undefined,
    };
  }

  if (
    candidate.type === 'future_pick' &&
    typeof candidate.year === 'number' &&
    typeof candidate.round === 'number'
  ) {
    return {
      type: 'future_pick',
      year: candidate.year,
      round: candidate.round,
    };
  }

  throw new TradeOfferCoordinatorError('Invalid trade offer.', 400);
}

function assetsBelongToTeam({
  draftState,
  teamId,
  assets,
}: {
  draftState: NonNullable<ReturnType<typeof getDraftState>>;
  teamId: string;
  assets: SupportedTradeAsset[];
}): boolean {
  return assets.every((asset) => {
    if (asset.type === 'player') {
      return draftState.roster_players.some(
        (entry) => entry.team_id === teamId && entry.player_id === asset.player_id,
      );
    }

    if (asset.type === 'future_pick') {
      return draftState.team_pick_assets.some(
        (entry) => entry.team_id === teamId && entry.year === asset.year && entry.round === asset.round,
      );
    }

    const matchingSlot = draftState.draft_order.find((slot) => {
      if (slot.team_id !== teamId) {
        return false;
      }

      if (asset.pick_number !== undefined) {
        return slot.pick_number === asset.pick_number;
      }

      return false;
    });

    return Boolean(
      matchingSlot &&
        !draftState.picks.some((pick) => pick.pick_number === matchingSlot.pick_number),
    );
  });
}

function evaluateUserTradeOffer({
  archetypeConfig,
  draftState,
  targetTeamId,
  assetsSent,
  assetsReceived,
}: {
  archetypeConfig: ArchetypeConfig;
  draftState: NonNullable<ReturnType<typeof getDraftState>>;
  targetTeamId: string;
  assetsSent: SupportedTradeAsset[];
  assetsReceived: SupportedTradeAsset[];
}): boolean {
  const playerValues = new Map<string, number>();
  for (const player of [...draftState.available_players, ...draftState.drafted_players]) {
    playerValues.set(player.id, player.dynasty_value);
  }

  const futurePickValues = new Map<string, number>();
  for (const asset of draftState.team_pick_assets) {
    futurePickValues.set(`${asset.year}:${asset.round}`, getFuturePickDynastyValue(asset.round));
  }

  const startupPickValues = buildConservativeStartupPickValues({
    currentPickNumber: draftState.current_pick_number,
    availablePlayers: draftState.available_players,
    startupPickValues: draftState.startup_pick_values,
  });

  const targetTeam = draftState.teams.find((team) => team.id === targetTeamId);
  const threshold = getAcceptanceThresholdForArchetype(archetypeConfig, targetTeam?.archetype);
  const playersById = new Map(
    [...draftState.available_players, ...draftState.drafted_players].map((player) => [player.id, player]),
  );
  const receivingRosterPlayers = draftState.roster_players
    .filter((rosterPlayer) => rosterPlayer.team_id === targetTeamId)
    .map((rosterPlayer) => {
      const player = playersById.get(rosterPlayer.player_id);

      return player
        ? {
            id: player.id,
            position: player.position,
            age: player.age,
            dynastyValue: player.dynasty_value,
          }
        : null;
    })
    .filter((player): player is NonNullable<typeof player> => player !== null);

  return evaluateBotTrade({
    acceptanceThreshold: threshold,
    assetsSent: assetsReceived,
    assetsReceived: assetsSent,
    playerValues,
    futurePickValues,
    startupPickValues,
    archetype: targetTeam?.archetype,
    rosterPlayers: receivingRosterPlayers,
  });
}

function getFuturePickDynastyValue(round: number): number {
  if (round <= 1) {
    return 4500;
  }

  if (round === 2) {
    return 2500;
  }

  if (round === 3) {
    return 1500;
  }

  return 1000;
}
