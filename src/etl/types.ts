// @spec DFF-ETL-011
// @spec DFF-ETL-012
export const supportedEtlPositions = ['QB', 'RB', 'WR', 'TE'] as const;
export const etlSources = ['ktc', 'fantasycalc', 'dynastydaddy', 'rosteraudit'] as const;

export type SupportedEtlPosition = (typeof supportedEtlPositions)[number];
export type EtlSource = (typeof etlSources)[number];

export type RawPlayer = {
  name: string;
  position: SupportedEtlPosition;
  nflTeam: string;
  age: number | null;
  isRookie: boolean;
  rawValue: number;
  tePremiumValues?: { tep: number | null; tepp: number | null; teppp: number | null };
  adp: number | null;
};

// @spec DFF-SPKV-002
export type RawPickValue = {
  year: number;
  round: number;
  pickInRound?: number;
  rawValue: number;
};

export type ScraperResult = {
  source: EtlSource;
  players: RawPlayer[];
  pickValues: RawPickValue[];
};

export type NormalizedPlayer = RawPlayer & {
  normalizedValue: number;
  tePremiumDynastyValues?: { tep: number | null; tepp: number | null; teppp: number | null };
};

export type NormalizedPickValue = RawPickValue & {
  normalizedValue: number;
};
