// @spec DFF-ETL-011
// @spec DFF-ETL-012
export const supportedEtlPositions = ['QB', 'RB', 'WR', 'TE'] as const;

export type SupportedEtlPosition = (typeof supportedEtlPositions)[number];

export type KtcRawPlayer = {
  name: string;
  position: SupportedEtlPosition;
  nflTeam: string;
  age: number | null;
  isRookie: boolean;
  rawValue: number;
  adp: number | null;
};

export type NormalizedPlayer = KtcRawPlayer & {
  normalizedValue: number;
};
