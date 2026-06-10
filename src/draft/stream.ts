// @spec DFF-ENGINE-010
// @spec DFF-ENGINE-011
// @spec DFF-ENGINE-012
// @spec DFF-ENGINE-013
// @spec DFF-ENGINE-014
// @spec DFF-ENGINE-015
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  getAvailablePlayersForDraft,
  getDraftedPlayersForDraft,
  type DraftAvailablePlayer,
} from './available-players.js';
import { parseDraftRosterConfig, type DraftRosterConfig } from './roster-config.js';

import { createDrizzleDb } from '../db/client.js';
import { draftOrder, drafts, picks, rosterPlayers, teamPickAssets, teams, userQueue } from '../db/schema.js';

export type DraftStateSyncPayload = {
  draft_id: string;
  status: string;
  current_pick_number: number | null;
  roster_config: DraftRosterConfig;
  teams: Array<{
    id: string;
    name: string;
    is_user: boolean;
    archetype: string | null;
  }>;
  draft_order: Array<{
    pick_number: number;
    round: number;
    pick_in_round: number;
    team_id: string;
  }>;
  picks: Array<{
    pick_number: number;
    team_id: string;
    player_id: string;
    picked_at: string;
  }>;
  roster_players: Array<{
    team_id: string;
    player_id: string;
  }>;
  team_pick_assets: Array<{
    team_id: string;
    year: number;
    round: number;
  }>;
  user_queue: Array<{
    player_id: string;
    rank: number;
  }>;
  available_players: DraftAvailablePlayer[];
  drafted_players: DraftAvailablePlayer[];
};

export type DraftStreamEvent =
  | { event: 'state_sync'; data: DraftStateSyncPayload }
  | {
      event: 'pick_made';
      data: {
        pick_number: number;
        team_id: string;
        player_id: string;
        is_bot: boolean;
      };
    }
  | {
      event: 'your_turn';
      data: {
        pick_number: number;
        round: number;
        pick_in_round: number;
      };
    }
  | {
      event: 'trade_offered';
      data: {
        trade_id: string;
        initiating_team_id: string;
        receiving_team_id: string;
        assets_sent: unknown[];
        assets_received: unknown[];
        is_bot_to_bot: boolean;
      };
    }
  | {
      event: 'trade_resolved';
      data: {
        trade_id: string;
        status: string;
        assets_sent: unknown[];
        assets_received: unknown[];
        created_at: string;
      };
    }
  | {
      event: 'draft_complete';
      data: {
        draft_id: string;
        completed_at: string;
      };
    };

type DraftEventListener = (event: DraftStreamEvent) => void;

const draftListeners = new Map<string, Set<DraftEventListener>>();

// @spec DFF-ENGINE-010
export function subscribeToDraftStream(
  draftId: string,
  listener: DraftEventListener,
): () => void {
  const listeners = draftListeners.get(draftId) ?? new Set<DraftEventListener>();
  listeners.add(listener);
  draftListeners.set(draftId, listeners);

  return () => {
    const currentListeners = draftListeners.get(draftId);

    if (!currentListeners) {
      return;
    }

    currentListeners.delete(listener);

    if (currentListeners.size === 0) {
      draftListeners.delete(draftId);
    }
  };
}

// @spec DFF-ENGINE-011
export function emitPickMadeEvent(event: {
  draftId: string;
  pickNumber: number;
  teamId: string;
  playerId: string;
  isBot: boolean;
}): void {
  publishDraftEvent(event.draftId, {
    event: 'pick_made',
    data: {
      pick_number: event.pickNumber,
      team_id: event.teamId,
      player_id: event.playerId,
      is_bot: event.isBot,
    },
  });
}

// @spec DFF-ENGINE-012
export function emitYourTurnEvent(event: {
  draftId: string;
  pickNumber: number;
  round: number;
  pickInRound: number;
}): void {
  publishDraftEvent(event.draftId, {
    event: 'your_turn',
    data: {
      pick_number: event.pickNumber,
      round: event.round,
      pick_in_round: event.pickInRound,
    },
  });
}

// @spec DFF-ENGINE-013
export function emitTradeOfferedEvent(event: {
  draftId: string;
  tradeId: string;
  initiatingTeamId: string;
  receivingTeamId: string;
  assetsSent: unknown[];
  assetsReceived: unknown[];
  isBotToBot: boolean;
}): void {
  publishDraftEvent(event.draftId, {
    event: 'trade_offered',
    data: {
      trade_id: event.tradeId,
      initiating_team_id: event.initiatingTeamId,
      receiving_team_id: event.receivingTeamId,
      assets_sent: event.assetsSent,
      assets_received: event.assetsReceived,
      is_bot_to_bot: event.isBotToBot,
    },
  });
}

// @spec DFF-ENGINE-014
export function emitTradeResolvedEvent(event: {
  draftId: string;
  tradeId: string;
  status: string;
  assetsSent: unknown[];
  assetsReceived: unknown[];
  createdAt: string;
}): void {
  publishDraftEvent(event.draftId, {
    event: 'trade_resolved',
    data: {
      trade_id: event.tradeId,
      status: event.status,
      assets_sent: event.assetsSent,
      assets_received: event.assetsReceived,
      created_at: event.createdAt,
    },
  });
}

// @spec DFF-ENGINE-015
export function emitDraftCompleteEvent(event: {
  draftId: string;
  completedAt: string;
}): void {
  publishDraftEvent(event.draftId, {
    event: 'draft_complete',
    data: {
      draft_id: event.draftId,
      completed_at: event.completedAt,
    },
  });
}

// @spec DFF-ENGINE-010
export function getDraftStateSyncPayload({
  databasePath,
  draftId,
}: {
  databasePath: string;
  draftId: string;
}): DraftStateSyncPayload | null {
  const { sqlite, db } = createDrizzleDb(databasePath);

  try {
    const draft = db
      .select({
        id: drafts.id,
        status: drafts.status,
        roster_config: drafts.rosterConfig,
      })
      .from(drafts)
      .where(eq(drafts.id, draftId))
      .get();

    if (!draft) {
      return null;
    }

    const currentPick = db
      .select({
        pickNumber: draftOrder.pickNumber,
      })
      .from(draftOrder)
      .leftJoin(picks, eq(draftOrder.id, picks.draftOrderId))
      .where(and(eq(draftOrder.draftId, draftId), isNull(picks.id)))
      .orderBy(asc(draftOrder.pickNumber))
      .get();

    return {
      draft_id: draft.id,
      status: draft.status,
      current_pick_number: currentPick?.pickNumber ?? null,
      roster_config: parseDraftRosterConfig(draft.roster_config),
      teams: db
        .select({
          id: teams.id,
          name: teams.name,
          is_user: teams.isUser,
          archetype: teams.archetype,
        })
        .from(teams)
        .where(eq(teams.draftId, draftId))
        .orderBy(asc(teams.pickPosition))
        .all(),
      draft_order: db
        .select({
          pick_number: draftOrder.pickNumber,
          round: draftOrder.round,
          pick_in_round: draftOrder.pickInRound,
          team_id: draftOrder.teamId,
        })
        .from(draftOrder)
        .where(eq(draftOrder.draftId, draftId))
        .orderBy(asc(draftOrder.pickNumber))
        .all(),
      picks: db
        .select({
          pick_number: picks.pickNumber,
          team_id: picks.teamId,
          player_id: picks.playerId,
          picked_at: picks.pickedAt,
        })
        .from(picks)
        .where(eq(picks.draftId, draftId))
        .orderBy(asc(picks.pickNumber))
        .all(),
      roster_players: db
        .select({
          team_id: rosterPlayers.teamId,
          player_id: rosterPlayers.playerId,
        })
        .from(rosterPlayers)
        .where(eq(rosterPlayers.draftId, draftId))
        .orderBy(asc(rosterPlayers.teamId), asc(rosterPlayers.playerId))
        .all(),
      team_pick_assets: db
        .select({
          team_id: teamPickAssets.teamId,
          year: teamPickAssets.year,
          round: teamPickAssets.round,
        })
        .from(teamPickAssets)
        .where(eq(teamPickAssets.draftId, draftId))
        .orderBy(asc(teamPickAssets.teamId), asc(teamPickAssets.year), asc(teamPickAssets.round))
        .all(),
      user_queue: db
        .select({
          player_id: userQueue.playerId,
          rank: userQueue.rank,
        })
        .from(userQueue)
        .where(eq(userQueue.draftId, draftId))
        .orderBy(asc(userQueue.rank))
        .all(),
      available_players: getAvailablePlayersForDraft({ databasePath, draftId }),
      drafted_players: getDraftedPlayersForDraft({ databasePath, draftId }),
    };
  } finally {
    sqlite.close();
  }
}

function publishDraftEvent(draftId: string, event: DraftStreamEvent): void {
  const listeners = draftListeners.get(draftId);

  if (!listeners) {
    return;
  }

  for (const listener of listeners) {
    listener(event);
  }
}
