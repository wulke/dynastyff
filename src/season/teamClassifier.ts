// @spec DFF-SM-100
// @spec DFF-SM-101
// @spec DFF-SM-102
// @spec DFF-SM-103
// @spec DFF-SM-104
import type { TeamRoster } from './context.js';

// @spec DFF-SM-100
export type TeamTier = 'contender' | 'middle' | 'rebuilder';

// @spec DFF-SM-101
// @spec DFF-SM-102
export type TeamClassification = {
  tier: TeamTier;
  winNowScore: number;
  inputs: {
    strengthPct: number;
    pointsForPct: number;
    winPct: number;
    gamesPlayed: number;
  };
};

// @spec DFF-SM-101 — roster strength is summed starter dynasty value; IR is not a starter.
function starterStrength(team: TeamRoster): number {
  return team.players
    .filter((player) => player.slotType === 'starter')
    .reduce((sum, player) => sum + player.dynastyValue, 0);
}

// @spec DFF-SM-101 — ties count as half a win.
function winPercentage(team: TeamRoster): number {
  const games = team.wins + team.losses + team.ties;
  return games === 0 ? 0.5 : (team.wins + 0.5 * team.ties) / games;
}

// @spec DFF-SM-101 — equal values receive the mean of their league-relative ranks.
function percentiles(values: number[]): number[] {
  if (values.length <= 1) {
    return values.map(() => 0.5);
  }

  return values.map((value) => {
    const below = values.filter((candidate) => candidate < value).length;
    const equalOthers = values.filter((candidate) => candidate === value).length - 1;
    return (below + equalOthers / 2) / (values.length - 1);
  });
}

// @spec DFF-SM-102
function seasonProgress(teams: TeamRoster[]): number {
  const gamesPlayed = Math.max(0, ...teams.map((team) => team.wins + team.losses + team.ties));
  return Math.min(gamesPlayed / 8, 1);
}

// @spec DFF-SM-100
// @spec DFF-SM-101
// @spec DFF-SM-102
// @spec DFF-SM-103
// @spec DFF-SM-104
export function classifyTeams(teams: TeamRoster[]): Map<number, TeamClassification> {
  const classifications = new Map<number, TeamClassification>();
  if (teams.length === 0) {
    return classifications;
  }

  const progress = seasonProgress(teams);
  const gamesPlayed = Math.max(0, ...teams.map((team) => team.wins + team.losses + team.ties));
  const strengthPcts = percentiles(teams.map(starterStrength));
  const winPcts = gamesPlayed === 0 ? teams.map(() => 0.5) : percentiles(teams.map(winPercentage));
  const pointsAvailable = teams.every((team) => team.pointsFor !== null && team.pointsFor !== undefined);
  const pointsPcts = pointsAvailable ? percentiles(teams.map((team) => team.pointsFor ?? 0)) : teams.map(() => 0.5);
  const strengthWeight = 0.6 - 0.3 * progress;
  const pointsWeight = 0.2 + 0.1 * progress;
  const recordWeight = 0.2 + 0.2 * progress;

  for (const [index, team] of teams.entries()) {
    const winNowScore =
      strengthWeight * strengthPcts[index] + pointsWeight * pointsPcts[index] + recordWeight * winPcts[index];
    const tier: TeamTier = winNowScore >= 0.6 ? 'contender' : winNowScore <= 0.4 ? 'rebuilder' : 'middle';

    classifications.set(team.rosterId, {
      tier,
      winNowScore,
      inputs: {
        strengthPct: strengthPcts[index],
        pointsForPct: pointsPcts[index],
        winPct: winPcts[index],
        gamesPlayed,
      },
    });
  }

  return classifications;
}
