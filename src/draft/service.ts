// @spec DFF-ENGINE-001
// @spec DFF-ENGINE-002
// @spec DFF-ENGINE-004
// @spec DFF-ENGINE-005
// @spec DFF-ENGINE-011
// @spec DFF-ENGINE-012
// @spec DFF-ENGINE-013
// @spec DFF-ENGINE-014
// @spec DFF-ENGINE-016
// @spec DFF-ENGINE-015
// @spec DFF-ENGINE-022
// @spec DFF-ENGINE-023
// @spec DFF-ENGINE-024
// @spec DFF-ENGINE-060
// @spec DFF-ENGINE-061
// @spec DFF-ENGINE-062
// @spec DFF-DATA-020
// @spec DFF-DATA-023
// @spec DFF-DATA-030
// @spec DFF-DATA-031
// @spec DFF-DATA-032
// @spec DFF-DATA-040
// @spec DFF-DATA-041
// @spec DFF-DATA-050
// @spec DFF-DATA-052
// @spec DFF-DATA-061
// @spec DFF-DATA-070
// @spec DFF-DATA-092
// @spec DFF-HIST-060
// @spec DFF-HIST-061
import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { getAvailablePlayersForDraft, type DraftAvailablePlayer } from './available-players.js';
import { createDrizzleDb } from '../db/client.js';
import {
  draftOrder,
  drafts,
  draftStatuses,
  etlRuns,
  picks,
  rosterPlayers,
  scoringFormats,
  teamArchetypes,
  teamPickAssets,
  teams,
  tradeStatuses,
  trades,
  userQueue,
} from '../db/schema.js';
import {
  emitDraftCompleteEvent,
  emitPickMadeEvent,
  emitTradeOfferedEvent,
  emitTradeResolvedEvent,
  emitYourTurnEvent,
} from './stream.js';

type DraftStatus = (typeof draftStatuses)[number];
type ScoringFormat = (typeof scoringFormats)[number];
type TeamArchetype = (typeof teamArchetypes)[number];
type TradeStatus = (typeof tradeStatuses)[number];

type RosterConfig = {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  FLEX: number;
  SF: number;
  bench: number;
};

type DraftConfig = {
  teamCount: number;
  rounds: number;
  scoringFormat: ScoringFormat;
  userPickPosition: number;
  futurePickYears: number;
  futurePickRounds: number;
  rosterConfig: RosterConfig;
};

type CreateDraftOptions = {
  databasePath: string;
  config: DraftConfig;
  now?: () => string;
  random?: () => number;
  idGenerator?: () => string;
};

type UpdateDraftStatusOptions = {
  databasePath: string;
  draftId: string;
  status: DraftStatus;
  now?: () => string;
};

type RecordPickOptions = {
  databasePath: string;
  draftOrderId: string;
  playerId: string;
  now?: () => string;
  idGenerator?: () => string;
};

type GetDraftStateOptions = {
  databasePath: string;
  draftId: string;
};

type GetDraftHistoryOptions = {
  databasePath: string;
};

const botTeamNames = [
  'Bob',
  'Carl',
  'Dana',
  'Eli',
  'Fran',
  'Gabe',
  'Hana',
  'Ivan',
  'Jules',
  'Kira',
  'Luca',
  'Mona',
  'Nora',
  'Omar',
  'Pia',
  'Quin',
  'Rosa',
  'Seth',
  'Tara',
  'Uma',
  'Vera',
  'Wade',
  'Xena',
  'Yara',
  'Zane',
] as const;

type TeamSeed = {
  id: string;
  draftId: string;
  name: string;
  isUser: boolean;
  pickPosition: number;
  archetype: TeamArchetype | null;
};

const defaultNow = () => new Date().toISOString();
const defaultRandom = () => Math.random();
const defaultIdGenerator = () => randomUUID();

export type DraftStateSnapshot = {
  draft_id: string;
  status: DraftStatus;
  current_pick_number: number | null;
  teams: Array<{
    id: string;
    name: string;
    is_user: boolean;
    archetype: TeamArchetype | null;
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
  trades: Array<{
    id: string;
    round: number;
    initiating_team_id: string;
    receiving_team_id: string;
    assets_sent: unknown;
    assets_received: unknown;
    status: TradeStatus;
  }>;
};

export type DraftHistoryEntry = {
  id: string;
  created_at: string;
  completed_at: string | null;
  status: DraftStatus;
  team_count: number;
  rounds: number;
};

export function createDraft({
  databasePath,
  config,
  now = defaultNow,
  random = defaultRandom,
  idGenerator = defaultIdGenerator,
}: CreateDraftOptions): string {
  const { sqlite, db } = createDrizzleDb(databasePath);
  const createdAt = now();
  const baseYear = new Date(createdAt).getUTCFullYear();
  const draftId = idGenerator();

  try {
    db.transaction((tx) => {
      // @spec DFF-HIST-060
      // @spec DFF-HIST-061
      const latestCompletedRun = tx
        .select({
          id: etlRuns.id,
        })
        .from(etlRuns)
        .where(isNotNull(etlRuns.completedAt))
        .orderBy(desc(etlRuns.startedAt))
        .get();

      tx.insert(drafts)
        .values({
          id: draftId,
          createdAt,
          completedAt: null,
          status: 'in_progress',
          teamCount: config.teamCount,
          rounds: config.rounds,
          scoringFormat: config.scoringFormat,
          userPickPosition: config.userPickPosition,
          futurePickYears: config.futurePickYears,
          futurePickRounds: config.futurePickRounds,
          rosterConfig: JSON.stringify(config.rosterConfig),
          etlRunId: latestCompletedRun?.id ?? null,
        })
        .run();

      const seededTeams = buildTeams({
        draftId,
        teamCount: config.teamCount,
        userPickPosition: config.userPickPosition,
        random,
        idGenerator,
      });

      tx.insert(teams).values(seededTeams).run();
      tx.insert(draftOrder)
        .values(buildDraftOrder(draftId, seededTeams, config.rounds, idGenerator))
        .run();
      tx.insert(teamPickAssets)
        .values(
          buildTeamPickAssets(
            draftId,
            seededTeams,
            config.futurePickYears,
            config.futurePickRounds,
            baseYear,
            idGenerator,
          ),
        )
        .run();
    });

    return draftId;
  } finally {
    sqlite.close();
  }
}

export function updateDraftStatus({
  databasePath,
  draftId,
  status,
  now = defaultNow,
}: UpdateDraftStatusOptions): void {
  const { sqlite, db } = createDrizzleDb(databasePath);

  try {
    db.transaction((tx) => {
      const currentDraft = tx
        .select({
          status: drafts.status,
        })
        .from(drafts)
        .where(eq(drafts.id, draftId))
        .get();

      if (!currentDraft) {
        return;
      }

      const nextValues =
        status === 'completed' && currentDraft.status !== 'completed'
          ? { status, completedAt: now() }
          : { status };

      tx.update(drafts).set(nextValues).where(eq(drafts.id, draftId)).run();
    });
  } finally {
    sqlite.close();
  }
}

export function recordPick({
  databasePath,
  draftOrderId,
  playerId,
  now = defaultNow,
  idGenerator = defaultIdGenerator,
}: RecordPickOptions): void {
  const { sqlite, db } = createDrizzleDb(databasePath);
  let pickMadeEvent:
    | {
        draftId: string;
        pickNumber: number;
        teamId: string;
        playerId: string;
        isBot: boolean;
      }
    | undefined;
  let yourTurnEvent:
    | {
        draftId: string;
        pickNumber: number;
        round: number;
        pickInRound: number;
      }
    | undefined;
  let draftCompleteEvent:
    | {
        draftId: string;
        completedAt: string;
      }
    | undefined;

  try {
    db.transaction((tx) => {
      const currentSlot = tx
        .select({
          draftId: draftOrder.draftId,
          teamId: draftOrder.teamId,
          pickNumber: draftOrder.pickNumber,
          round: draftOrder.round,
          status: drafts.status,
          isUser: teams.isUser,
        })
        .from(draftOrder)
        .innerJoin(teams, eq(draftOrder.teamId, teams.id))
        .innerJoin(drafts, eq(draftOrder.draftId, drafts.id))
        .where(eq(draftOrder.id, draftOrderId))
        .get();

      if (!currentSlot) {
        throw new Error(`Draft order slot not found: ${draftOrderId}`);
      }

      if (currentSlot.status !== 'in_progress') {
        throw new Error(`Draft is not in progress for slot: ${draftOrderId}`);
      }

      const nextOpenSlot = tx
        .select({
          draftOrderId: draftOrder.id,
          pickNumber: draftOrder.pickNumber,
        })
        .from(draftOrder)
        .leftJoin(picks, eq(draftOrder.id, picks.draftOrderId))
        .where(and(eq(draftOrder.draftId, currentSlot.draftId), isNull(picks.id)))
        .orderBy(asc(draftOrder.pickNumber))
        .get();

      if (!nextOpenSlot) {
        throw new Error(`Draft has no remaining pick slots: ${currentSlot.draftId}`);
      }

      if (nextOpenSlot.draftOrderId !== draftOrderId) {
        throw new Error(`Draft order slot is not the current pick: ${draftOrderId}`);
      }

      const existingPick = tx
        .select({
          id: picks.id,
        })
        .from(picks)
        .where(and(eq(picks.draftId, currentSlot.draftId), eq(picks.playerId, playerId)))
        .get();

      if (existingPick) {
        throw new Error(`Player has already been drafted in this draft: ${playerId}`);
      }

      const pickedAt = now();

      tx.insert(picks)
        .values({
          id: idGenerator(),
          draftId: currentSlot.draftId,
          draftOrderId,
          teamId: currentSlot.teamId,
          playerId,
          pickNumber: currentSlot.pickNumber,
          round: currentSlot.round,
          pickedAt,
        })
        .run();

      tx.insert(rosterPlayers)
        .values({
          id: idGenerator(),
          draftId: currentSlot.draftId,
          teamId: currentSlot.teamId,
          playerId,
        })
        .run();

      tx.delete(userQueue)
        .where(
          and(eq(userQueue.draftId, currentSlot.draftId), eq(userQueue.playerId, playerId)),
        )
        .run();

      const followingOpenSlot = tx
        .select({
          draftId: draftOrder.draftId,
          pickNumber: draftOrder.pickNumber,
          round: draftOrder.round,
          pickInRound: draftOrder.pickInRound,
          isUser: teams.isUser,
        })
        .from(draftOrder)
        .innerJoin(teams, eq(draftOrder.teamId, teams.id))
        .leftJoin(picks, eq(draftOrder.id, picks.draftOrderId))
        .where(and(eq(draftOrder.draftId, currentSlot.draftId), isNull(picks.id)))
        .orderBy(asc(draftOrder.pickNumber))
        .get();

      pickMadeEvent = {
        draftId: currentSlot.draftId,
        pickNumber: currentSlot.pickNumber,
        teamId: currentSlot.teamId,
        playerId,
        isBot: !currentSlot.isUser,
      };

      if (!followingOpenSlot) {
        tx.update(drafts)
          .set({
            status: 'completed',
            completedAt: pickedAt,
          })
          .where(eq(drafts.id, currentSlot.draftId))
          .run();

        draftCompleteEvent = {
          draftId: currentSlot.draftId,
          completedAt: pickedAt,
        };
        return;
      }

      if (followingOpenSlot.isUser) {
        yourTurnEvent = {
          draftId: followingOpenSlot.draftId,
          pickNumber: followingOpenSlot.pickNumber,
          round: followingOpenSlot.round,
          pickInRound: followingOpenSlot.pickInRound,
        };
      }
    });
  } finally {
    sqlite.close();
  }

  if (pickMadeEvent) {
    emitPickMadeEvent(pickMadeEvent);
  }

  if (yourTurnEvent) {
    emitYourTurnEvent(yourTurnEvent);
  }

  if (draftCompleteEvent) {
    emitDraftCompleteEvent(draftCompleteEvent);
  }
}

// @spec DFF-ENGINE-016
export function getDraftState({
  databasePath,
  draftId,
}: GetDraftStateOptions): DraftStateSnapshot | null {
  const { sqlite, db } = createDrizzleDb(databasePath);

  try {
    const draft = db
      .select({
        id: drafts.id,
        status: drafts.status,
      })
      .from(drafts)
      .where(eq(drafts.id, draftId))
      .get() as { id: string; status: DraftStatus } | undefined;

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
        .all() as DraftStateSnapshot['teams'],
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
        .innerJoin(teams, eq(rosterPlayers.teamId, teams.id))
        .where(eq(rosterPlayers.draftId, draftId))
        .orderBy(asc(teams.pickPosition), asc(rosterPlayers.playerId))
        .all(),
      team_pick_assets: db
        .select({
          team_id: teamPickAssets.teamId,
          year: teamPickAssets.year,
          round: teamPickAssets.round,
        })
        .from(teamPickAssets)
        .innerJoin(teams, eq(teamPickAssets.teamId, teams.id))
        .where(eq(teamPickAssets.draftId, draftId))
        .orderBy(asc(teams.pickPosition), asc(teamPickAssets.year), asc(teamPickAssets.round))
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
      trades: db
        .select({
          id: trades.id,
          round: trades.round,
          initiating_team_id: trades.initiatingTeamId,
          receiving_team_id: trades.receivingTeamId,
          assets_sent: trades.assetsSent,
          assets_received: trades.assetsReceived,
          status: trades.status,
        })
        .from(trades)
        .where(eq(trades.draftId, draftId))
        .orderBy(asc(trades.pickNumber), asc(trades.createdAt))
        .all()
        .map((trade) => ({
          ...trade,
          assets_sent: parseJsonColumn(trade.assets_sent),
          assets_received: parseJsonColumn(trade.assets_received),
        })) as DraftStateSnapshot['trades'],
    };
  } finally {
    sqlite.close();
  }
}

export function getDraftHistory({ databasePath }: GetDraftHistoryOptions): DraftHistoryEntry[] {
  const { sqlite, db } = createDrizzleDb(databasePath);

  try {
    return db
      .select({
        id: drafts.id,
        created_at: drafts.createdAt,
        completed_at: drafts.completedAt,
        status: drafts.status,
        team_count: drafts.teamCount,
        rounds: drafts.rounds,
      })
      .from(drafts)
      .orderBy(desc(drafts.createdAt), desc(drafts.id))
      .all() as DraftHistoryEntry[];
  } finally {
    sqlite.close();
  }
}

// @spec DFF-ENGINE-013
export const emitTradeOffered = emitTradeOfferedEvent;
// @spec DFF-ENGINE-014
export const emitTradeResolved = emitTradeResolvedEvent;
export { getAvailablePlayersForDraft };

function buildTeams({
  draftId,
  teamCount,
  userPickPosition,
  random,
  idGenerator,
}: {
  draftId: string;
  teamCount: number;
  userPickPosition: number;
  random: () => number;
  idGenerator: () => string;
}): TeamSeed[] {
  let botIndex = 0;

  return Array.from({ length: teamCount }, (_, index) => {
    const pickPosition = index + 1;
    const isUser = pickPosition === userPickPosition;

    if (isUser) {
      return {
        id: idGenerator(),
        draftId,
        name: 'You',
        isUser: true,
        pickPosition,
        archetype: null,
      };
    }

    const team = {
      id: idGenerator(),
      draftId,
      name: botTeamNames[botIndex % botTeamNames.length],
      isUser: false,
      pickPosition,
      archetype: selectArchetype(random),
    };

    botIndex += 1;
    return team;
  });
}

function buildDraftOrder(
  draftId: string,
  seededTeams: TeamSeed[],
  rounds: number,
  idGenerator: () => string,
) {
  const ascendingTeams = [...seededTeams].sort((left, right) => left.pickPosition - right.pickPosition);
  let pickNumber = 1;

  return Array.from({ length: rounds }, (_, roundIndex) => {
    const round = roundIndex + 1;
    const roundTeams = round % 2 === 1 ? ascendingTeams : [...ascendingTeams].reverse();

    return roundTeams.map((team, pickIndex) => ({
      id: idGenerator(),
      draftId,
      pickNumber: pickNumber++,
      round,
      pickInRound: pickIndex + 1,
      teamId: team.id,
    }));
  }).flat();
}

function buildTeamPickAssets(
  draftId: string,
  seededTeams: TeamSeed[],
  futurePickYears: number,
  futurePickRounds: number,
  baseYear: number,
  idGenerator: () => string,
) {
  return seededTeams.flatMap((team) =>
    Array.from({ length: futurePickYears }, (_, yearIndex) => yearIndex + 1).flatMap((yearOffset) =>
      Array.from({ length: futurePickRounds }, (_, roundIndex) => ({
        id: idGenerator(),
        draftId,
        teamId: team.id,
        year: baseYear + yearOffset,
        round: roundIndex + 1,
      })),
    ),
  );
}

function selectArchetype(random: () => number): TeamArchetype {
  const lastIndex = teamArchetypes.length - 1;
  const index = Math.min(Math.floor(random() * teamArchetypes.length), lastIndex);

  return teamArchetypes[index];
}

function parseJsonColumn(value: string): unknown {
  return JSON.parse(value);
}
