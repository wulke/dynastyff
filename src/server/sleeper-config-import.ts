// @spec DFF-UI-194
export type SleeperDraftConfigPrefill = {
  teamCount: number;
  scoringFormat: 'ppr' | 'half_ppr' | 'standard';
  tePremiumTier: 'off' | 'tep' | 'tepp' | 'teppp';
  rosterConfig: {
    QB: number;
    RB: number;
    WR: number;
    TE: number;
    FLEX: number;
    SF: number;
    bench: number;
  };
};

// @spec DFF-UI-194
export class SleeperLeagueSettingsError extends Error {}

// @spec DFF-UI-194
function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SleeperLeagueSettingsError(`Sleeper league response has invalid ${field}.`);
  }

  return value as Record<string, unknown>;
}

// @spec DFF-UI-194
function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SleeperLeagueSettingsError(`Sleeper league response has invalid ${field}.`);
  }

  return value;
}

// @spec DFF-UI-194
function scoringFormatFromReceptionBonus(receptionBonus: number): SleeperDraftConfigPrefill['scoringFormat'] {
  const formats: Array<{ value: number; format: SleeperDraftConfigPrefill['scoringFormat'] }> = [
    { value: 0, format: 'standard' },
    { value: 0.5, format: 'half_ppr' },
    { value: 1, format: 'ppr' },
  ];

  return formats.reduce((closest, candidate) =>
    Math.abs(candidate.value - receptionBonus) < Math.abs(closest.value - receptionBonus) ? candidate : closest,
  ).format;
}

// @spec DFF-UI-194
function tePremiumTierFromBonus(value: unknown): SleeperDraftConfigPrefill['tePremiumTier'] {
  switch (value) {
    case 0.5:
      return 'tep';
    case 1:
      return 'tepp';
    case 1.5:
      return 'teppp';
    default:
      return 'off';
  }
}

// @spec DFF-UI-194
function rosterConfigFromPositions(rosterPositions: unknown): SleeperDraftConfigPrefill['rosterConfig'] {
  if (!Array.isArray(rosterPositions) || !rosterPositions.every((position) => typeof position === 'string')) {
    throw new SleeperLeagueSettingsError('Sleeper league response has invalid roster_positions.');
  }

  const rosterConfig: SleeperDraftConfigPrefill['rosterConfig'] = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    FLEX: 0,
    SF: 0,
    bench: 0,
  };
  const supportedPositions: Record<string, keyof SleeperDraftConfigPrefill['rosterConfig']> = {
    QB: 'QB',
    RB: 'RB',
    WR: 'WR',
    TE: 'TE',
    FLEX: 'FLEX',
    SUPER_FLEX: 'SF',
    BN: 'bench',
  };

  for (const position of rosterPositions) {
    const rosterKey = supportedPositions[position];
    if (rosterKey) rosterConfig[rosterKey] += 1;
  }

  return rosterConfig;
}

// @spec DFF-UI-194
export function mapSleeperLeagueSettings(input: unknown): SleeperDraftConfigPrefill {
  const league = requireRecord(input, 'league');
  const scoringSettings = requireRecord(league.scoring_settings, 'scoring_settings');
  const teamCount = requireFiniteNumber(league.num_teams, 'num_teams');

  if (!Number.isInteger(teamCount)) {
    throw new SleeperLeagueSettingsError('Sleeper league response has invalid num_teams.');
  }

  return {
    teamCount,
    scoringFormat: scoringFormatFromReceptionBonus(requireFiniteNumber(scoringSettings.rec, 'scoring_settings.rec')),
    tePremiumTier: tePremiumTierFromBonus(scoringSettings.bonus_rec_te),
    rosterConfig: rosterConfigFromPositions(league.roster_positions),
  };
}
