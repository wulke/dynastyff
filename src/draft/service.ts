// @spec DFF-ENGINE-001
// @spec DFF-ENGINE-002
// @spec DFF-ENGINE-004
// @spec DFF-ENGINE-005
// @spec DFF-ENGINE-016
// @spec DFF-DATA-020
// @spec DFF-DATA-023
// @spec DFF-DATA-030
// @spec DFF-DATA-031
// @spec DFF-DATA-032
// @spec DFF-DATA-040
// @spec DFF-DATA-041
// @spec DFF-DATA-070
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { createDrizzleDb } from '../db/client.js';
import {
  draftOrder,
  drafts,
  draftStatuses,
  scoringFormats,
  teamArchetypes,
  teamPickAssets,
  teams,
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
      tx.insert(draftOrder).values(buildDraftOrder(draftId, seededTeams, config.rounds, idGenerator)).run();
      tx.insert(teamPickAssets)
        .values(buildTeamPickAssets(draftId, seededTeams, config.futurePickYears, config.futurePickRounds, createdAt, idGenerator))
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
    db.update(drafts)
      .set({
        status,
        completedAt: status === 'completed' ? now() : null,
      })
      .where(eq(drafts.id, draftId))
      .run();
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
      archetype: teamArchetypes[Math.floor(random() * teamArchetypes.length)],
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
  createdAt: string,
  idGenerator: () => string,
) {
  const baseYear = new Date(createdAt).getUTCFullYear();

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
