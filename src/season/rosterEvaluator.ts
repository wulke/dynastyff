// @spec DFF-SM-011
// @spec DFF-SM-012
// @spec DFF-SM-013
// @spec DFF-SM-014
// @spec DFF-SM-015
// @spec DFF-SM-016
// @spec DFF-SM-017
// @spec DFF-SM-025
// @spec DFF-SM-084
import type { LeagueContext, RosterEntry, TeamRoster } from './context.js';

export type LetterGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export type TeamContext = {
  classification: 'contender' | 'rebuilder';
  winPct: number;
  rank: number;
  teamCount: number;
};

export type PositionEvaluation = {
  grade: LetterGrade;
  percentile: number;
  valueScore: number;
  rawStarterValue: number;
  ageCurveScore: number;
  depthScore: number;
  starters: RosterEntry[];
};

export type RosterOverview = {
  overallGrade: LetterGrade;
  overallPercentile: number;
  teamContext: TeamContext;
  positions: Record<string, PositionEvaluation>;
  roster: RosterEntry[];
};

const positionGroups = ['QB', 'RB', 'WR', 'TE'] as const;
type PositionGroup = (typeof positionGroups)[number];

const primeAges: Record<PositionGroup, number> = { QB: 27, RB: 24, WR: 25, TE: 26 };

// @spec DFF-SM-016
export function toLetterGrade(composite: number): LetterGrade {
  if (composite >= 85) return 'A';
  if (composite >= 70) return 'B';
  if (composite >= 55) return 'C';
  if (composite >= 40) return 'D';
  return 'F';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// @spec DFF-SM-012 — per-player age score; 2+ below prime → bonus, 3+ past prime → penalty.
function playerAgeScore(position: PositionGroup, age: number | null): number {
  if (age === null) {
    return 50;
  }

  return clamp(50 + 20 * (primeAges[position] - age), 0, 100);
}

function startersAt(team: TeamRoster, position: PositionGroup): RosterEntry[] {
  return team.players.filter((entry) => entry.position === position && entry.slotType === 'starter');
}

// @spec DFF-SM-084 — taxi counts toward depth; IR excluded from every grade component.
function depthPlayersAt(team: TeamRoster, position: PositionGroup): RosterEntry[] {
  return team.players.filter(
    (entry) => entry.position === position && (entry.slotType === 'starter' || entry.slotType === 'bench' || entry.slotType === 'taxi'),
  );
}

function starterValueSum(team: TeamRoster, position: PositionGroup): number {
  return startersAt(team, position).reduce((sum, entry) => sum + entry.dynastyValue, 0);
}

function depthValueSum(team: TeamRoster, position: PositionGroup): number {
  return depthPlayersAt(team, position).reduce((sum, entry) => sum + entry.dynastyValue, 0);
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// @spec DFF-SM-012 — value-weighted mean of per-player age scores; unweighted when total weight is 0.
function positionAgeScore(team: TeamRoster, position: PositionGroup): number {
  const starters = startersAt(team, position);
  if (starters.length === 0) {
    return 50;
  }

  let weightedSum = 0;
  let totalWeight = 0;

  for (const entry of starters) {
    const weight = Math.max(entry.dynastyValue, 0);
    weightedSum += playerAgeScore(position, entry.age) * weight;
    totalWeight += weight;
  }

  if (totalWeight > 0) {
    return weightedSum / totalWeight;
  }

  const unweighted = starters.reduce((sum, entry) => sum + playerAgeScore(position, entry.age), 0);
  return unweighted / starters.length;
}

// @spec DFF-SM-014 — percentile among other teams; 50 when single team.
function percentileRank(userValue: number, allValues: number[]): number {
  if (allValues.length <= 1) {
    return 50;
  }

  const teamsBelow = allValues.filter((value) => value < userValue).length;

  return (100 * teamsBelow) / (allValues.length - 1);
}

// @spec DFF-SM-025 — top half of standings by win pct → contender, else rebuilder.
export function classifyTeamContext(userTeam: TeamRoster, allRosters: TeamRoster[]): TeamContext {
  const games = userTeam.wins + userTeam.losses + userTeam.ties;
  const winPct = games === 0 ? 0.5 : (userTeam.wins + 0.5 * userTeam.ties) / games;

  const standings = [...allRosters]
    .map((team) => {
      const teamGames = team.wins + team.losses + team.ties;
      const teamWinPct = teamGames === 0 ? 0.5 : (team.wins + 0.5 * team.ties) / teamGames;
      return { rosterId: team.rosterId, winPct: teamWinPct };
    })
    .sort((a, b) => b.winPct - a.winPct || a.rosterId - b.rosterId);

  const rank = standings.findIndex((team) => team.rosterId === userTeam.rosterId);

  return {
    classification: rank < Math.ceil(standings.length / 2) ? 'contender' : 'rebuilder',
    winPct,
    rank: rank >= 0 ? rank + 1 : standings.length,
    teamCount: standings.length,
  };
}

type PositionMath = {
  composites: Map<number, number>;
  userComposite: number;
  percentile: number;
  valueScore: number;
  rawStarterValue: number;
  ageCurveScore: number;
  depthScore: number;
  starters: RosterEntry[];
};

function computePosition(context: LeagueContext, position: PositionGroup): PositionMath {
  const userTeam = context.allRosters.find((team) => team.rosterId === context.userRosterId);
  if (!userTeam) {
    throw new Error(`User roster ${context.userRosterId} missing from league ${context.league.leagueId}.`);
  }

  const rawSums = context.allRosters.map((team) => starterValueSum(team, position));
  const userRawSum = starterValueSum(userTeam, position);
  const leagueMax = Math.max(...rawSums, 0);

  // @spec DFF-SM-011 — normalized 0-100 against the league's best at the position.
  const valueScore = leagueMax > 0 ? (100 * userRawSum) / leagueMax : 50;

  // @spec DFF-SM-013 — depth ratio vs league median, capped at 2x median for the 0-100 scale.
  const depthTotals = context.allRosters.map((team) => depthValueSum(team, position));
  const userDepthTotal = depthValueSum(userTeam, position);
  const leagueMedianDepth = median(depthTotals);
  const depthScore =
    leagueMedianDepth > 0 ? clamp((100 * userDepthTotal) / leagueMedianDepth / 2, 0, 100) : userDepthTotal > 0 ? 100 : 50;

  const ageCurveScore = positionAgeScore(userTeam, position);

  // @spec DFF-SM-015 — value 50%, depth 30%, age curve 20%.
  const compositeFor = (team: TeamRoster): number => {
    const raw = starterValueSum(team, position);
    const value = leagueMax > 0 ? (100 * raw) / leagueMax : 50;
    const depth = depthValueSum(team, position);
    const depthNorm = leagueMedianDepth > 0 ? clamp((100 * depth) / leagueMedianDepth / 2, 0, 100) : depth > 0 ? 100 : 50;
    return 0.5 * value + 0.3 * depthNorm + 0.2 * positionAgeScore(team, position);
  };

  const composites = new Map<number, number>();
  for (const team of context.allRosters) {
    composites.set(team.rosterId, compositeFor(team));
  }

  return {
    composites,
    userComposite: composites.get(userTeam.rosterId) ?? 50,
    // @spec DFF-SM-014
    percentile: percentileRank(userRawSum, rawSums),
    valueScore,
    rawStarterValue: userRawSum,
    ageCurveScore,
    depthScore,
    starters: startersAt(userTeam, position),
  };
}

// @spec DFF-SM-017 — overall grade weighted by roster slot count per position.
function slotWeights(rosterPositions: string[]): Map<PositionGroup, number> {
  const weights = new Map<PositionGroup, number>(
    positionGroups.map((position) => [
      position,
      rosterPositions.filter((slot) => slot === position).length,
    ]),
  );

  if ([...weights.values()].every((weight) => weight === 0)) {
    return new Map(positionGroups.map((position) => [position, 1]));
  }

  return weights;
}

// @spec DFF-SM-010
export function evaluateRoster(context: LeagueContext): RosterOverview {
  const userTeam = context.allRosters.find((team) => team.rosterId === context.userRosterId);
  if (!userTeam) {
    throw new Error(`User roster ${context.userRosterId} missing from league ${context.league.leagueId}.`);
  }

  const math = new Map<PositionGroup, PositionMath>();
  for (const position of positionGroups) {
    math.set(position, computePosition(context, position));
  }

  const weights = slotWeights(context.league.rosterPositions);

  const overallFor = (rosterId: number): number => {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const position of positionGroups) {
      const weight = weights.get(position) ?? 0;
      weightedSum += (math.get(position)?.composites.get(rosterId) ?? 50) * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 50;
  };

  const userOverall = overallFor(userTeam.rosterId);
  const overallPercentile = percentileRank(
    userOverall,
    context.allRosters.map((team) => overallFor(team.rosterId)),
  );

  const positions: Record<string, PositionEvaluation> = {};

  for (const position of positionGroups) {
    const stats = math.get(position);
    if (!stats) {
      continue;
    }

    positions[position] = {
      grade: toLetterGrade(stats.userComposite),
      percentile: stats.percentile,
      valueScore: stats.valueScore,
      rawStarterValue: stats.rawStarterValue,
      ageCurveScore: stats.ageCurveScore,
      depthScore: stats.depthScore,
      starters: stats.starters,
    };
  }

  return {
    overallGrade: toLetterGrade(userOverall),
    overallPercentile,
    teamContext: classifyTeamContext(userTeam, context.allRosters),
    positions,
    // @spec DFF-SM-084 — IR players stay in roster display data.
    roster: userTeam.players,
  };
}
