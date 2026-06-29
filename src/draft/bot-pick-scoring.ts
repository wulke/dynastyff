// @spec DFF-BOT-020
// @spec DFF-BOT-021
// @spec DFF-BOT-022
// @spec DFF-BOT-023
// @spec DFF-BOT-024
// @spec DFF-BOT-025
// @spec DFF-BOT-026
// @spec DFF-BOT-024a
// @spec DFF-BOT-027
// @spec DFF-BOT-028
// @spec DFF-BOT-029
import type { DraftAvailablePlayer } from './available-players.js';
import type { ArchetypeConfig } from './archetype-config.js';
import type { DraftRosterConfig } from './roster-config.js';

type PlayerPosition = 'QB' | 'RB' | 'WR' | 'TE';
type RosterSlot = keyof DraftRosterConfig;
type TeamArchetype = keyof ArchetypeConfig['archetypes'];

type RosteredPlayer = Pick<DraftAvailablePlayer, 'position' | 'nfl_team'>;

const SATURATION_FLOOR = 0.3;
const NEED_NORMALIZATION_CAP = 2;
const SLOT_PRIORITY: RosterSlot[] = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SF', 'bench'];
const PUNT_YOUTH_AGE_BASELINE = 30;

// @spec DFF-BOT-023
export const SLOT_ELIGIBILITY: Record<RosterSlot, readonly PlayerPosition[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  FLEX: ['RB', 'WR', 'TE'],
  SF: ['QB', 'RB', 'WR', 'TE'],
  bench: ['QB', 'RB', 'WR', 'TE'],
};

type ScoreBotPickCandidateArgs = {
  player: DraftAvailablePlayer;
  archetype: TeamArchetype;
  archetypeConfig: ArchetypeConfig;
  rosterConfig: DraftRosterConfig;
  rosteredPlayers: RosteredPlayer[];
  round: number;
  randomness: number;
  random: () => number;
};

type CalculateSlotNeedArgs = {
  position: PlayerPosition;
  rosterConfig: DraftRosterConfig;
  rosteredPositions: PlayerPosition[];
};

type SlotInstance = {
  slot: RosterSlot;
  eligibility: readonly PlayerPosition[];
  filled: boolean;
};

type FilterBotPickCandidatesArgs = {
  availablePlayers: DraftAvailablePlayer[];
  archetype: TeamArchetype;
  archetypeConfig: ArchetypeConfig;
  scorePlayer: (player: DraftAvailablePlayer) => number;
};

export type FilteredBotPickCandidate = {
  id: string;
  score: number;
};

// @spec DFF-BOT-020
// @spec DFF-BOT-021
// @spec DFF-BOT-022
// @spec DFF-BOT-024
// @spec DFF-BOT-025
// @spec DFF-BOT-026
// @spec DFF-BOT-024a
// @spec DFF-BOT-027
export function scoreBotPickCandidate({
  player,
  archetype,
  archetypeConfig,
  rosterConfig,
  rosteredPlayers,
  round,
  randomness,
  random,
}: ScoreBotPickCandidateArgs): number {
  const profile = archetypeConfig.archetypes[archetype];
  const slotNeed = calculateSlotNeed({
    position: player.position as PlayerPosition,
    rosterConfig,
    rosteredPositions: rosteredPlayers
      .map((rosteredPlayer) => rosteredPlayer.position)
      .filter(isPlayerPosition),
  });
  const normalizedNeed = normalizeSlotNeed(slotNeed);
  const combinedBias = Math.max(
    normalizedNeed,
    getPositionBias(player, archetype, round),
    getYouthBias(player, archetype),
    getHandcuffBias(player, rosteredPlayers),
  );
  const needFactor = clampNeedFactor(
    1 + (combinedBias - 0.5) * 2 * profile.needModifier,
    profile.needModifier,
  );

  return player.dynasty_value * profile.valueWeight * needFactor;
}

// @spec DFF-BOT-021
// @spec DFF-BOT-024
export function calculateSlotNeed({
  position,
  rosterConfig,
  rosteredPositions,
}: CalculateSlotNeedArgs): number {
  const slotInstances = buildSlotInstances(rosterConfig);

  for (const rosteredPosition of sortRosteredPositionsForAssignment(rosteredPositions)) {
    const matchingSlot = slotInstances.find(
      (slotInstance) => !slotInstance.filled && slotInstance.eligibility.includes(rosteredPosition),
    );

    if (matchingSlot) {
      matchingSlot.filled = true;
    }
  }

  const weightedNeed = slotInstances.reduce((sum, slotInstance) => {
    if (slotInstance.filled || !slotInstance.eligibility.includes(position)) {
      return sum;
    }

    return sum + 1 / slotInstance.eligibility.length;
  }, 0);

  return weightedNeed > 0 ? weightedNeed : SATURATION_FLOOR;
}

// @spec DFF-BOT-028
// @spec DFF-BOT-029
export function filterBotPickCandidates({
  availablePlayers,
  archetype,
  archetypeConfig,
  scorePlayer,
}: FilterBotPickCandidatesArgs): FilteredBotPickCandidate[] {
  const profile = archetypeConfig.archetypes[archetype];
  const floorFilteredPlayers = availablePlayers.filter((player) => {
    if (!isPlayerPosition(player.position)) {
      return true;
    }

    return player.dynasty_value >= profile.preferredPositionValueFloors[player.position];
  });
  const playersToScore = floorFilteredPlayers.length > 0 ? floorFilteredPlayers : availablePlayers;
  const scoredCandidates = playersToScore
    .map((player) => ({
      id: player.id,
      score: scorePlayer(player),
    }))
    .sort((left, right) => normalizeComparableScore(right.score) - normalizeComparableScore(left.score));
  const topCandidate = scoredCandidates[0];

  if (!topCandidate) {
    return [];
  }

  const threshold = topCandidate.score * (1 - profile.candidatePoolThreshold);
  const tierFilteredCandidates = scoredCandidates.filter((candidate) => candidate.score >= threshold);

  return tierFilteredCandidates.length > 0 ? tierFilteredCandidates : [topCandidate];
}

// @spec DFF-BOT-023
function buildSlotInstances(rosterConfig: DraftRosterConfig): SlotInstance[] {
  return SLOT_PRIORITY.flatMap((slot) =>
    Array.from({ length: rosterConfig[slot] }, () => ({
      slot,
      eligibility: SLOT_ELIGIBILITY[slot],
      filled: false,
    })),
  );
}

// @spec DFF-BOT-024
function sortRosteredPositionsForAssignment(rosteredPositions: PlayerPosition[]): PlayerPosition[] {
  return [...rosteredPositions].sort((left, right) => {
    const restrictionDelta = getEligibleSlotCount(left) - getEligibleSlotCount(right);

    if (restrictionDelta !== 0) {
      return restrictionDelta;
    }

    return SLOT_PRIORITY.findIndex((slot) => SLOT_ELIGIBILITY[slot].includes(left)) -
      SLOT_PRIORITY.findIndex((slot) => SLOT_ELIGIBILITY[slot].includes(right));
  });
}

// @spec DFF-BOT-024
function getEligibleSlotCount(position: PlayerPosition): number {
  return SLOT_PRIORITY.filter((slot) => SLOT_ELIGIBILITY[slot].includes(position)).length;
}

// @spec DFF-BOT-029
function normalizeComparableScore(score: number): number {
  return Number.isFinite(score) ? score : Number.NEGATIVE_INFINITY;
}

// @spec DFF-BOT-024a
function normalizeSlotNeed(slotNeed: number): number {
  return clamp(slotNeed / NEED_NORMALIZATION_CAP, 0, 1);
}

// @spec DFF-BOT-027
function getPositionBias(player: DraftAvailablePlayer, archetype: TeamArchetype, round: number): number {
  if (archetype === 'rb_heavy' && player.position === 'RB') {
    return 1;
  }

  if (archetype === 'qb_early' && player.position === 'QB' && round <= 3) {
    return 1;
  }

  return 0;
}

// @spec DFF-BOT-025
function getYouthBias(player: DraftAvailablePlayer, archetype: TeamArchetype): number {
  if (archetype !== 'punt') {
    return 0;
  }

  if (player.is_rookie) {
    return 1;
  }

  if (player.age === null) {
    return 0;
  }

  return clamp((PUNT_YOUTH_AGE_BASELINE - player.age) / PUNT_YOUTH_AGE_BASELINE, 0, 1);
}

// @spec DFF-BOT-026
function getHandcuffBias(player: DraftAvailablePlayer, rosteredPlayers: RosteredPlayer[]): number {
  if (player.position !== 'RB' || player.nfl_team === null) {
    return 0;
  }

  return rosteredPlayers.some(
    (rosteredPlayer) => rosteredPlayer.position === 'RB' && rosteredPlayer.nfl_team === player.nfl_team,
  )
    ? 1
    : 0;
}

// @spec DFF-BOT-023
function isPlayerPosition(value: string): value is PlayerPosition {
  return value === 'QB' || value === 'RB' || value === 'WR' || value === 'TE';
}

// @spec DFF-BOT-027
function clampNeedFactor(value: number, needModifier: number): number {
  return clamp(value, 1 - needModifier, 1 + needModifier);
}

// @spec DFF-BOT-024a
// @spec DFF-BOT-027
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
