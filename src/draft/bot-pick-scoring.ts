// @spec DFF-BOT-020
// @spec DFF-BOT-021
// @spec DFF-BOT-022
// @spec DFF-BOT-023
// @spec DFF-BOT-024
// @spec DFF-BOT-025
// @spec DFF-BOT-026
import type { DraftAvailablePlayer } from './available-players.js';
import type { ArchetypeConfig } from './archetype-config.js';
import type { DraftRosterConfig } from './roster-config.js';

type PlayerPosition = 'QB' | 'RB' | 'WR' | 'TE';
type RosterSlot = keyof DraftRosterConfig;
type TeamArchetype = keyof ArchetypeConfig['archetypes'];

type RosteredPlayer = Pick<DraftAvailablePlayer, 'position' | 'nfl_team'>;

const SATURATION_FLOOR = 0.3;
const SLOT_PRIORITY: RosterSlot[] = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SF', 'bench'];
const PUNT_ROOKIE_YOUTH_MODIFIER = 1.3;
const PUNT_YOUTH_AGE_BASELINE = 30;
const PUNT_YOUTH_MODIFIER_RANGE = 0.4;
const HANDCUFF_BONUS_MULTIPLIER = 0.15;

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

// @spec DFF-BOT-020
// @spec DFF-BOT-021
// @spec DFF-BOT-022
// @spec DFF-BOT-024
// @spec DFF-BOT-025
// @spec DFF-BOT-026
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
  let slotNeed = calculateSlotNeed({
    position: player.position as PlayerPosition,
    rosterConfig,
    rosteredPositions: rosteredPlayers
      .map((rosteredPlayer) => rosteredPlayer.position)
      .filter(isPlayerPosition),
  });

  if (archetype === 'rb_heavy' && player.position === 'RB') {
    slotNeed *= 1.5;
  }

  if (archetype === 'qb_early' && player.position === 'QB' && round <= 3) {
    slotNeed *= 2;
  }

  const youthModifier = getYouthModifier(player, archetype);
  const handcuffBonus = getHandcuffBonus(player, rosteredPlayers);

  return (
    player.dynasty_value * profile.valueWeight * (slotNeed * profile.needModifier) * youthModifier +
    handcuffBonus +
    randomness * random()
  );
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

// @spec DFF-BOT-025
function getYouthModifier(player: DraftAvailablePlayer, archetype: TeamArchetype): number {
  if (archetype !== 'punt') {
    return 1;
  }

  if (player.is_rookie) {
    return PUNT_ROOKIE_YOUTH_MODIFIER;
  }

  if (player.age === null) {
    return 1;
  }

  return (
    1 +
    Math.max(0, (PUNT_YOUTH_AGE_BASELINE - player.age) / PUNT_YOUTH_AGE_BASELINE) * PUNT_YOUTH_MODIFIER_RANGE
  );
}

// @spec DFF-BOT-026
function getHandcuffBonus(player: DraftAvailablePlayer, rosteredPlayers: RosteredPlayer[]): number {
  if (player.position !== 'RB' || player.nfl_team === null) {
    return 0;
  }

  return rosteredPlayers.some(
    (rosteredPlayer) => rosteredPlayer.position === 'RB' && rosteredPlayer.nfl_team === player.nfl_team,
  )
    ? player.dynasty_value * HANDCUFF_BONUS_MULTIPLIER
    : 0;
}

// @spec DFF-BOT-023
function isPlayerPosition(value: string): value is PlayerPosition {
  return value === 'QB' || value === 'RB' || value === 'WR' || value === 'TE';
}
