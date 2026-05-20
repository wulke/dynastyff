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
  adp: number | null;
};

export type RawPickValue = {
  year: number;
  round: number;
  rawValue: number;
};

export type ScraperResult = {
  source: EtlSource;
  players: RawPlayer[];
  pickValues: RawPickValue[];
};

export type NormalizedPlayer = RawPlayer & {
  normalizedValue: number;
};
