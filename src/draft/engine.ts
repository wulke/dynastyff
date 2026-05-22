// @spec DFF-STATIC-020
// @spec DFF-STATIC-021
// @spec DFF-STATIC-022
// @spec DFF-STATIC-023
// @spec DFF-STATIC-024
// @spec DFF-STATIC-025
// @spec DFF-STATIC-026
// @spec DFF-STATIC-027
// @spec DFF-STATIC-028
import type { DraftConfig, Snapshot } from '../ui/types.js';

import { InvariantError } from './invariant.js';

export const BOT_ARCHETYPES = ['win_now', 'punt', 'rb_heavy', 'qb_early', 'bpa', 'balanced'] as const;

// @spec DFF-STATIC-021
// @spec DFF-STATIC-022
export type TeamArchetype = (typeof BOT_ARCHETYPES)[number];

// @spec DFF-STATIC-021
export type Player = Snapshot['players'][number];

// @spec DFF-STATIC-021
export type PickValue = Snapshot['pickValues'][number];

// @spec DFF-STATIC-021
export type QueueEntry = {
  playerId: string;
  rank: number;
};

// @spec DFF-STATIC-021
export type Team = {
  id: string;
  name: string;
  isUser: boolean;
  archetype: TeamArchetype | null;
};

// @spec DFF-STATIC-021
export type DraftSlot = {
  pickNumber: number;
  round: number;
  pickInRound: number;
  teamId: string;
};

// @spec DFF-STATIC-024
export type Pick = {
  pickNumber: number;
  teamId: string;
  playerId: string;
  pickedAt: string;
};

// @spec DFF-STATIC-024
export type RosterEntry = {
  teamId: string;
  playerId: string;
};

// @spec DFF-STATIC-021
export type TeamPickAsset = {
  teamId: string;
  year: number;
  round: number;
};

// @spec DFF-STATIC-021
export type InMemoryDraftState = {
  draftId: string;
  status: 'in_progress' | 'completed';
  config: DraftConfig;
  teams: Team[];
  draftOrder: DraftSlot[];
  picks: Pick[];
  rosterPlayers: RosterEntry[];
  teamPickAssets: TeamPickAsset[];
  userQueue: QueueEntry[];
};

// @spec DFF-STATIC-021
// @spec DFF-STATIC-022
export function createDraft(config: DraftConfig, _players: Player[], pickValues: PickValue[]): InMemoryDraftState {
  const draftId = globalThis.crypto.randomUUID();
  const teams = Array.from({ length: config.teamCount }, (_, index) => {
    const pickPosition = index + 1;
    const isUser = pickPosition === config.userPickPosition;

    return {
      id: globalThis.crypto.randomUUID(),
      name: isUser ? config.name.trim() || 'Your Team' : `Bot ${pickPosition}`,
      isUser,
      archetype: isUser ? null : selectArchetype(),
    };
  });

  return {
    draftId,
    status: 'in_progress',
    config,
    teams,
    draftOrder: buildDraftOrder(teams, config.rounds),
    picks: [],
    rosterPlayers: [],
    teamPickAssets: buildTeamPickAssets(teams, pickValues, config.futurePickYears),
    userQueue: [],
  };
}

// @spec DFF-STATIC-023
// @spec DFF-STATIC-024
// @spec DFF-STATIC-025
// @spec DFF-STATIC-026
export function submitPick(state: InMemoryDraftState, playerId: string): InMemoryDraftState {
  if (state.picks.some((pick) => pick.playerId === playerId)) {
    throw new InvariantError(`Player ${playerId} has already been drafted.`);
  }

  const team = currentTeam(state);

  if (team === null) {
    throw new InvariantError('Cannot submit a pick for a completed draft.');
  }

  const nextPick: Pick = {
    pickNumber: state.picks.length + 1,
    teamId: team.id,
    playerId,
    pickedAt: new Date().toISOString(),
  };

  const picks = [...state.picks, nextPick];
  const draftComplete = picks.length >= state.draftOrder.length;

  return {
    ...state,
    status: draftComplete ? 'completed' : 'in_progress',
    picks,
    rosterPlayers: [
      ...state.rosterPlayers,
      {
        teamId: team.id,
        playerId,
      },
    ],
    userQueue: state.userQueue.filter((entry) => entry.playerId !== playerId),
  };
}

// @spec DFF-STATIC-027
export function currentTeam(state: InMemoryDraftState): Team | null {
  if (state.status === 'completed') {
    return null;
  }

  const nextSlot = state.draftOrder[state.picks.length];

  if (!nextSlot) {
    return null;
  }

  return state.teams.find((team) => team.id === nextSlot.teamId) ?? null;
}

// @spec DFF-STATIC-028
export function availablePlayers(state: InMemoryDraftState, allPlayers: Player[]): Player[] {
  const draftedPlayerIds = new Set(state.picks.map((pick) => pick.playerId));

  return allPlayers
    .filter((player) => !draftedPlayerIds.has(player.id))
    .sort((left, right) => right.dynastyValue - left.dynastyValue);
}

// @spec DFF-STATIC-021
function buildDraftOrder(teams: Team[], rounds: number): DraftSlot[] {
  const draftOrder: DraftSlot[] = [];
  let pickNumber = 1;

  for (let round = 1; round <= rounds; round += 1) {
    const roundTeams = round % 2 === 1 ? teams : [...teams].reverse();

    for (let index = 0; index < roundTeams.length; index += 1) {
      draftOrder.push({
        pickNumber,
        round,
        pickInRound: index + 1,
        teamId: roundTeams[index]!.id,
      });
      pickNumber += 1;
    }
  }

  return draftOrder;
}

// @spec DFF-STATIC-021
function buildTeamPickAssets(teams: Team[], pickValues: PickValue[], futurePickYears: number): TeamPickAsset[] {
  const years = [...new Set(pickValues.map((pickValue) => pickValue.year))].sort((left, right) => left - right);
  const selectedYears = years.slice(0, futurePickYears);
  const roundsByYear = new Map<number, number[]>();

  for (const year of selectedYears) {
    const rounds = [...new Set(pickValues.filter((pickValue) => pickValue.year === year).map((pickValue) => pickValue.round))]
      .sort((left, right) => left - right);
    roundsByYear.set(year, rounds);
  }

  return teams.flatMap((team) =>
    selectedYears.flatMap((year) =>
      (roundsByYear.get(year) ?? []).map((round) => ({
        teamId: team.id,
        year,
        round,
      })),
    ),
  );
}

// @spec DFF-STATIC-022
function selectArchetype(): TeamArchetype {
  const lastIndex = BOT_ARCHETYPES.length - 1;
  const archetypeIndex = Math.min(Math.floor(Math.random() * BOT_ARCHETYPES.length), lastIndex);

  return BOT_ARCHETYPES[archetypeIndex]!;
}
