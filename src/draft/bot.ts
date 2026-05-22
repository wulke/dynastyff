// @spec DFF-STATIC-030
// @spec DFF-STATIC-031
// @spec DFF-STATIC-032
// @spec DFF-STATIC-033
import { InvariantError } from './invariant.js';
import type { Player, RosterEntry, Team, TeamArchetype } from './engine.js';

type ArchetypeProfile = {
  valueWeight: number;
  defaultNeedMultiplier: number;
};

const ARCHETYPE_PROFILES: Record<TeamArchetype, ArchetypeProfile> = {
  bpa: { valueWeight: 1.0, defaultNeedMultiplier: 0.5 },
  balanced: { valueWeight: 0.8, defaultNeedMultiplier: 0.8 },
  win_now: { valueWeight: 0.6, defaultNeedMultiplier: 1.2 },
  punt: { valueWeight: 0.9, defaultNeedMultiplier: 0.3 },
  rb_heavy: { valueWeight: 0.7, defaultNeedMultiplier: 0.6 },
  qb_early: { valueWeight: 0.5, defaultNeedMultiplier: 0.7 },
};

// @spec DFF-STATIC-030
// @spec DFF-STATIC-031
// @spec DFF-STATIC-032
// @spec DFF-STATIC-033
export function selectBotPick(available: Player[], team: Team, roster: RosterEntry[], noise: number): string {
  if (available.length === 0) {
    throw new InvariantError('Cannot select a bot pick without available players.');
  }

  const scoredPlayers = available.map((player) => ({
    id: player.id,
    score: scorePlayer(player, team.archetype ?? 'balanced', roster, noise),
  }));

  scoredPlayers.sort((left, right) => right.score - left.score);
  return scoredPlayers[0]!.id;
}

// @spec DFF-STATIC-031
function scorePlayer(player: Player, archetype: TeamArchetype, roster: RosterEntry[], noise: number): number {
  const profile = ARCHETYPE_PROFILES[archetype];
  const needMultiplier = getNeedMultiplier(archetype, player.position, roster.length + 1);

  return player.dynastyValue * profile.valueWeight * needMultiplier + noise * Math.random();
}

// @spec DFF-STATIC-031
function getNeedMultiplier(archetype: TeamArchetype, position: Player['position'], currentRound: number): number {
  if (archetype === 'rb_heavy') {
    return position === 'RB' ? 1.5 : 0.6;
  }

  if (archetype === 'qb_early') {
    return position === 'QB' && currentRound <= 3 ? 1.8 : 0.7;
  }

  return ARCHETYPE_PROFILES[archetype].defaultNeedMultiplier;
}
