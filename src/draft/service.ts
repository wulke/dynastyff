// @spec DFF-ENGINE-001
// @spec DFF-ENGINE-002
// @spec DFF-ENGINE-004
// @spec DFF-ENGINE-005
// @spec DFF-ENGINE-016
// @spec DFF-ENGINE-022
// @spec DFF-ENGINE-023
// @spec DFF-ENGINE-024
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
import { randomUUID } from 'node:crypto';

import { and, asc, eq, isNull } from 'drizzle-orm';
import { createDrizzleDb } from '../db/client.js';
import {
  draftOrder,
  drafts,
  draftStatuses,
  picks,
  rosterPlayers,
  scoringFormats,
  teamArchetypes,
  teamPickAssets,
  teams,
  userQueue,
} from '../db/schema.js';

type DraftStatus = (typeof draftStatuses)[number];
type ScoringFormat = (typeof scoringFormats)[number];
type TeamArchetype = (typeof teamArchetypes)[number];

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

  try {
    db.transaction((tx) => {
      const currentSlot = tx
        .select({
          draftId: draftOrder.draftId,
          teamId: draftOrder.teamId,
          pickNumber: draftOrder.pickNumber,
          round: draftOrder.round,
          status: drafts.status,
        })
        .from(draftOrder)
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

      tx.insert(picks)
        .values({
          id: idGenerator(),
          draftId: currentSlot.draftId,
          draftOrderId,
          teamId: currentSlot.teamId,
          playerId,
          pickNumber: currentSlot.pickNumber,
          round: currentSlot.round,
          pickedAt: now(),
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
    });
  } finally {
    sqlite.close();
  }
}

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
