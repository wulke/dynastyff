// @spec DFF-ENGINE-030
// @spec DFF-ENGINE-031
// @spec DFF-ENGINE-032
// @spec DFF-ENGINE-033
// @spec DFF-ENGINE-039
// @spec DFF-ENGINE-039b
import { and, asc, eq, isNull } from 'drizzle-orm';

import { createDrizzleDb } from '../db/client.js';
import { draftOrder, drafts, picks, teams, tradeStatuses } from '../db/schema.js';
import { getAvailablePlayersForDraft, type DraftAvailablePlayer } from './available-players.js';
import { recordPick } from './service.js';
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
  assetsSent: unknown[];
  assetsReceived: unknown[];
  resolve: (status: TradeStatus) => void;
};

export type DecideBotActionContext = {
  draftId: string;
  slot: CurrentOpenBotSlot;
  availablePlayers: DraftAvailablePlayer[];
};

export type BotChainCoordinator = {
  trigger: (draftId: string) => void;
  waitForIdle: (draftId: string) => Promise<void>;
  resolvePendingTrade: (draftId: string, status: TradeStatus) => boolean;
};

type CreateBotChainCoordinatorOptions = {
  databasePath: string;
  now?: () => string;
  random?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  decideBotAction?: (context: DecideBotActionContext) => Promise<BotAction> | BotAction;
};

const defaultNow = () => new Date().toISOString();
const defaultRandom = () => Math.random();

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

// @spec DFF-ENGINE-032
function selectHighestValuePlayer(availablePlayers: DraftAvailablePlayer[]): string {
  const bestPlayer = availablePlayers[0];

  if (!bestPlayer) {
    throw new Error('Cannot process a bot pick without an available player.');
  }

  return bestPlayer.id;
}

// @spec DFF-ENGINE-032
function defaultDecideBotAction(context: DecideBotActionContext): BotAction {
  return {
    type: 'pick',
    playerId: selectHighestValuePlayer(context.availablePlayers),
  };
}

// @spec DFF-ENGINE-030
// @spec DFF-ENGINE-031
// @spec DFF-ENGINE-032
// @spec DFF-ENGINE-033
// @spec DFF-ENGINE-039
// @spec DFF-ENGINE-039b
export function createBotChainCoordinator({
  databasePath,
  now = defaultNow,
  random = defaultRandom,
  sleep = defaultSleep,
  decideBotAction = defaultDecideBotAction,
}: CreateBotChainCoordinatorOptions): BotChainCoordinator {
  const activeChains = new Map<string, Promise<void>>();
  const pendingTrades = new Map<string, PendingTradeState>();

  async function runBotChain(draftId: string): Promise<void> {
    try {
      while (true) {
        const nextSlot = getCurrentOpenSlot({ databasePath, draftId });

        if (!nextSlot || nextSlot.isUser) {
          return;
        }

        await sleep(calculateBotPickDelayMs(random));

        const refreshedSlot = getCurrentOpenSlot({ databasePath, draftId });

        if (!refreshedSlot || refreshedSlot.isUser) {
          return;
        }

        const availablePlayers = getAvailablePlayersForDraft({ databasePath, draftId });
        const action = await decideBotAction({
          draftId,
          slot: refreshedSlot,
          availablePlayers,
        });

        if (action.type === 'trade') {
          await awaitTradeResolution(draftId, action, pendingTrades);
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

  return {
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

      pendingTrades.delete(draftId);
      pendingTrade.resolve(status);
      return true;
    },
  };
}

// @spec DFF-ENGINE-033
// @spec DFF-ENGINE-039
// @spec DFF-ENGINE-039b
async function awaitTradeResolution(
  draftId: string,
  action: BotTradeAction,
  pendingTrades: Map<string, PendingTradeState>,
): Promise<void> {
  const status = await new Promise<TradeStatus>((resolve) => {
    pendingTrades.set(draftId, {
      tradeId: action.tradeId,
      assetsSent: action.assetsSent,
      assetsReceived: action.assetsReceived,
      resolve,
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
  });

  emitTradeResolvedEvent({
    draftId,
    tradeId: action.tradeId,
    status,
    assetsSent: action.assetsSent,
    assetsReceived: action.assetsReceived,
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
