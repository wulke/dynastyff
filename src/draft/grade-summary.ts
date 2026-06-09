// @spec DFF-GRADE-001
// @spec DFF-GRADE-002
// @spec DFF-GRADE-003
// @spec DFF-GRADE-010
// @spec DFF-GRADE-011
// @spec DFF-GRADE-012
// @spec DFF-GRADE-013
// @spec DFF-GRADE-020
// @spec DFF-GRADE-021
// @spec DFF-GRADE-022
// @spec DFF-GRADE-030
// @spec DFF-GRADE-031
// @spec DFF-GRADE-032
// @spec DFF-GRADE-033
// @spec DFF-GRADE-040
// @spec DFF-GRADE-041
// @spec DFF-GRADE-050
// @spec DFF-GRADE-051
// @spec DFF-GRADE-052
export type GradeDimensionKey =
  | 'valueOverExpectedAdp'
  | 'positionalBalance'
  | 'rosterConstruction';

export type GradeWarning =
  | 'missing_adp'
  | 'missing_required_position'
  | 'degenerate_roster';

export type GradeDimensionScore = {
  key: GradeDimensionKey;
  label: string;
  score: number;
  weight: number;
  summary: string;
  warnings: GradeWarning[];
};

export type TeamGradeSummary = {
  teamId: string;
  teamName: string;
  isUser: boolean;
  overallScore: number;
  letterGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  dimensions: Record<GradeDimensionKey, GradeDimensionScore>;
  warnings: GradeWarning[];
};

export type DraftGradeSummaryResult = {
  teamSummaries: TeamGradeSummary[];
};

export type DraftGradeSummaryInput = {
  status: 'in_progress' | 'completed';
  rosterConfig: {
    QB: number;
    RB: number;
    WR: number;
    TE: number;
    FLEX: number;
    SF: number;
    bench: number;
  };
  teams: Array<{
    id: string;
    name: string;
    isUser: boolean;
  }>;
  draftOrder: Array<{
    pickNumber: number;
    teamId: string;
  }>;
  picks: Array<{
    pickNumber: number;
    teamId: string;
    playerId: string;
  }>;
  rosterPlayers: Array<{
    teamId: string;
    playerId: string;
  }>;
  playerCatalog: Record<string, {
    id: string;
    name: string;
    position: string;
    dynastyValue: number;
    adp: number | null;
  }>;
};

const POSITION_KEYS = ['QB', 'RB', 'WR', 'TE'] as const;
type PositionKey = (typeof POSITION_KEYS)[number];

const DIMENSION_WEIGHTS = {
  valueOverExpectedAdp: 0.5,
  positionalBalance: 0.2,
  rosterConstruction: 0.3,
} as const;

// @spec DFF-GRADE-041
export function toLetterGrade(score: number): TeamGradeSummary['letterGrade'] {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// @spec DFF-GRADE-001
// @spec DFF-GRADE-040
// @spec DFF-GRADE-041
// @spec DFF-GRADE-050
export function calculateDraftGradeSummaries(input: DraftGradeSummaryInput): DraftGradeSummaryResult | null {
  if (input.status !== 'completed') {
    return null;
  }

  const teamSummaries = input.teams
    .map((team) => calculateTeamGradeSummary(input, team))
    .sort((left, right) => {
      if (right.overallScore !== left.overallScore) {
        return right.overallScore - left.overallScore;
      }

      if (left.isUser !== right.isUser) {
        return left.isUser ? -1 : 1;
      }

      return left.teamName.localeCompare(right.teamName);
    });

  return { teamSummaries };
}

// @spec DFF-GRADE-003
export function getUserTeamGradeSummary(input: DraftGradeSummaryInput): TeamGradeSummary | null {
  return calculateDraftGradeSummaries(input)?.teamSummaries.find((team) => team.isUser) ?? null;
}

// @spec DFF-GRADE-003
// @spec DFF-GRADE-040
function calculateTeamGradeSummary(
  input: DraftGradeSummaryInput,
  team: DraftGradeSummaryInput['teams'][number],
): TeamGradeSummary {
  const valueOverExpectedAdp = calculateValueOverExpectedAdp(input, team.id);
  const positionalBalance = calculatePositionalBalance(input, team.id);
  const rosterConstruction = calculateRosterConstruction(input, team.id);
  const overallScore = roundScore(
    (valueOverExpectedAdp.score * DIMENSION_WEIGHTS.valueOverExpectedAdp) +
    (positionalBalance.score * DIMENSION_WEIGHTS.positionalBalance) +
    (rosterConstruction.score * DIMENSION_WEIGHTS.rosterConstruction),
  );
  const warnings = dedupeWarnings([
    ...valueOverExpectedAdp.warnings,
    ...positionalBalance.warnings,
    ...rosterConstruction.warnings,
  ]);

  return {
    teamId: team.id,
    teamName: team.name,
    isUser: team.isUser,
    overallScore,
    letterGrade: toLetterGrade(overallScore),
    dimensions: {
      valueOverExpectedAdp,
      positionalBalance,
      rosterConstruction,
    },
    warnings,
  };
}

// @spec DFF-GRADE-010
// @spec DFF-GRADE-011
// @spec DFF-GRADE-012
// @spec DFF-GRADE-013
// @spec DFF-GRADE-052
function calculateValueOverExpectedAdp(
  input: DraftGradeSummaryInput,
  teamId: string,
): GradeDimensionScore {
  const teamPicks = input.picks.filter((pick) => pick.teamId === teamId);
  const playersWithAdp = teamPicks
    .map((pick) => ({ pick, player: input.playerCatalog[pick.playerId] }))
    .filter((entry) => entry.player && typeof entry.player.adp === 'number');
  const missingAdpCount = teamPicks.length - playersWithAdp.length;
  const warnings: GradeWarning[] = missingAdpCount > 0 ? ['missing_adp'] : [];

  if (playersWithAdp.length === 0) {
    return {
      key: 'valueOverExpectedAdp',
      label: 'Value Over Expected ADP',
      score: 50,
      weight: DIMENSION_WEIGHTS.valueOverExpectedAdp,
      summary: 'No usable ADP values were available, so this dimension remains neutral.',
      warnings,
    };
  }

  const totalDraftedDynastyValue = teamPicks.reduce((sum, pick) => {
    const player = input.playerCatalog[pick.playerId];
    return sum + Math.max(player?.dynastyValue ?? 0, 0);
  }, 0);
  const totalPicks = Math.max(input.draftOrder.length, 1);
  const equalWeight = 1 / playersWithAdp.length;
  const weightedScore = playersWithAdp.reduce((sum, entry) => {
    const slotDelta = (entry.player!.adp ?? 0) - entry.pick.pickNumber;
    const normalizedDelta = clamp(slotDelta / totalPicks, -1, 1);
    const pickScore = 50 + (normalizedDelta * 50);
    const weight = totalDraftedDynastyValue > 0
      ? Math.max(entry.player!.dynastyValue, 0) / totalDraftedDynastyValue
      : equalWeight;
    return sum + (pickScore * weight);
  }, 0);
  const score = roundScore(weightedScore);

  return {
    key: 'valueOverExpectedAdp',
    label: 'Value Over Expected ADP',
    score,
    weight: DIMENSION_WEIGHTS.valueOverExpectedAdp,
    summary: score >= 50
      ? 'This team captured neutral-to-positive market value relative to draft slot.'
      : 'This team paid above market expectation on enough picks to drag the value grade down.',
    warnings,
  };
}

// @spec DFF-GRADE-020
// @spec DFF-GRADE-021
// @spec DFF-GRADE-022
// @spec DFF-GRADE-051
function calculatePositionalBalance(
  input: DraftGradeSummaryInput,
  teamId: string,
): GradeDimensionScore {
  const positionCounts = getTeamPositionCounts(input, teamId);
  const positionValues = getTeamPositionValues(input, teamId);
  const requiredPositions = POSITION_KEYS.filter((position) => input.rosterConfig[position] > 0);
  const missingRequiredPositions = requiredPositions.filter((position) => positionCounts[position] === 0);
  const totalCount = POSITION_KEYS.reduce((sum, position) => sum + positionCounts[position], 0);
  const dominantShare = totalCount === 0
    ? 0
    : Math.max(...POSITION_KEYS.map((position) => positionCounts[position])) / totalCount;
  const warnings: GradeWarning[] = [];

  if (missingRequiredPositions.length > 0) {
    warnings.push('missing_required_position');
  }

  if (dominantShare > 0.6) {
    warnings.push('degenerate_roster');
  }

  let score: number;

  if (missingRequiredPositions.length > 0) {
    score = 0;
  } else {
    const valueDensity = requiredPositions.map((position) => positionValues[position] / input.rosterConfig[position]);
    const mean = valueDensity.reduce((sum, value) => sum + value, 0) / Math.max(valueDensity.length, 1);
    const variance = mean <= 0
      ? 1
      : valueDensity.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / valueDensity.length;
    const cv = mean <= 0 ? 1 : Math.sqrt(variance) / mean;
    score = clamp(100 - (cv * 100), 0, 100);
  }

  if (dominantShare > 0.6) {
    score = Math.min(score, 20);
  }

  score = roundScore(score);

  return {
    key: 'positionalBalance',
    label: 'Positional Balance',
    score,
    weight: DIMENSION_WEIGHTS.positionalBalance,
    summary: score >= 70
      ? 'Roster value is distributed across required starter positions with minimal overconcentration.'
      : 'Roster value is concentrated too heavily in too few positions.',
    warnings: dedupeWarnings(warnings),
  };
}

// @spec DFF-GRADE-030
// @spec DFF-GRADE-031
// @spec DFF-GRADE-032
// @spec DFF-GRADE-033
// @spec DFF-GRADE-051
function calculateRosterConstruction(
  input: DraftGradeSummaryInput,
  teamId: string,
): GradeDimensionScore {
  const positionCounts = getTeamPositionCounts(input, teamId);
  const requiredPositions = POSITION_KEYS.filter((position) => input.rosterConfig[position] > 0);
  const missingRequiredPositions = requiredPositions.filter((position) => positionCounts[position] === 0);
  const totalCount = POSITION_KEYS.reduce((sum, position) => sum + positionCounts[position], 0);
  const dominantShare = totalCount === 0
    ? 0
    : Math.max(...POSITION_KEYS.map((position) => positionCounts[position])) / totalCount;
  const warnings: GradeWarning[] = [];

  if (missingRequiredPositions.length > 0) {
    warnings.push('missing_required_position');
  }

  if (dominantShare > 0.6 && missingRequiredPositions.length >= 2) {
    warnings.push('degenerate_roster');
  }

  const dedicatedRequiredTotal = POSITION_KEYS.reduce((sum, position) => sum + input.rosterConfig[position], 0);
  const dedicatedFilledTotal = POSITION_KEYS.reduce(
    (sum, position) => sum + Math.min(positionCounts[position], input.rosterConfig[position]),
    0,
  );
  const dedicatedScore = dedicatedRequiredTotal === 0
    ? 40
    : 40 * (dedicatedFilledTotal / dedicatedRequiredTotal);

  const remainingAfterDedicated = {
    QB: Math.max(positionCounts.QB - input.rosterConfig.QB, 0),
    RB: Math.max(positionCounts.RB - input.rosterConfig.RB, 0),
    WR: Math.max(positionCounts.WR - input.rosterConfig.WR, 0),
    TE: Math.max(positionCounts.TE - input.rosterConfig.TE, 0),
  } satisfies Record<PositionKey, number>;
  const remainingFlexEligible = remainingAfterDedicated.RB + remainingAfterDedicated.WR + remainingAfterDedicated.TE;
  const flexUsed = Math.min(remainingFlexEligible, input.rosterConfig.FLEX);
  const flexScore = input.rosterConfig.FLEX === 0
    ? 20
    : 20 * (flexUsed / input.rosterConfig.FLEX);
  const remainingSuperflexEligible =
    remainingAfterDedicated.QB + remainingFlexEligible - flexUsed;
  const superflexUsed = Math.min(remainingSuperflexEligible, input.rosterConfig.SF);
  const superflexScore = input.rosterConfig.SF === 0
    ? 20
    : 20 * (superflexUsed / input.rosterConfig.SF);

  const benchScore = calculateBenchRedundancyScore(input.rosterConfig, positionCounts);
  let score = dedicatedScore + flexScore + superflexScore + benchScore;

  if (dominantShare > 0.6 && missingRequiredPositions.length >= 2) {
    score = Math.min(score, 25);
  }

  score = roundScore(score);

  return {
    key: 'rosterConstruction',
    label: 'Roster Construction',
    score,
    weight: DIMENSION_WEIGHTS.rosterConstruction,
    summary: score >= 70
      ? 'This team can cover the configured lineup and has at least minimal redundancy.'
      : 'This team cannot cleanly cover the configured lineup without exposing structural holes.',
    warnings: dedupeWarnings(warnings),
  };
}

// @spec DFF-GRADE-032
// @spec DFF-GRADE-033
function calculateBenchRedundancyScore(
  rosterConfig: DraftGradeSummaryInput['rosterConfig'],
  positionCounts: Record<PositionKey, number>,
): number {
  if (rosterConfig.bench <= 0) {
    return 20;
  }

  const qbReserveTarget = rosterConfig.QB > 0 || rosterConfig.SF > 0 ? 1 : 0;
  const teReserveTarget = rosterConfig.TE > 0 ? 1 : 0;
  const rbwrReserveTarget = Math.min(2, rosterConfig.bench);
  const cappedExpectedBodies = Math.min(
    qbReserveTarget + teReserveTarget + rbwrReserveTarget,
    rosterConfig.bench,
  );

  if (cappedExpectedBodies <= 0) {
    return 20;
  }

  const qbReserve = Math.min(Math.max(positionCounts.QB - rosterConfig.QB, 0), qbReserveTarget);
  const teReserve = Math.min(Math.max(positionCounts.TE - rosterConfig.TE, 0), teReserveTarget);
  const rbwrReserve = Math.min(
    Math.max(positionCounts.RB - rosterConfig.RB, 0) + Math.max(positionCounts.WR - rosterConfig.WR, 0),
    rbwrReserveTarget,
  );
  const achievedBodies = Math.min(qbReserve + teReserve + rbwrReserve, cappedExpectedBodies);

  return 20 * (achievedBodies / cappedExpectedBodies);
}

function getTeamPositionCounts(
  input: DraftGradeSummaryInput,
  teamId: string,
): Record<PositionKey, number> {
  const counts = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
  } satisfies Record<PositionKey, number>;

  for (const entry of input.rosterPlayers) {
    if (entry.teamId !== teamId) {
      continue;
    }

    const position = input.playerCatalog[entry.playerId]?.position;

    if (isPositionKey(position)) {
      counts[position] += 1;
    }
  }

  return counts;
}

function getTeamPositionValues(
  input: DraftGradeSummaryInput,
  teamId: string,
): Record<PositionKey, number> {
  const values = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
  } satisfies Record<PositionKey, number>;

  for (const entry of input.rosterPlayers) {
    if (entry.teamId !== teamId) {
      continue;
    }

    const player = input.playerCatalog[entry.playerId];

    if (isPositionKey(player?.position)) {
      values[player.position] += Math.max(player.dynastyValue, 0);
    }
  }

  return values;
}

function isPositionKey(value: string | undefined): value is PositionKey {
  return value === 'QB' || value === 'RB' || value === 'WR' || value === 'TE';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundScore(value: number): number {
  return Math.round(clamp(value, 0, 100));
}

function dedupeWarnings(warnings: GradeWarning[]): GradeWarning[] {
  return [...new Set(warnings)];
}
