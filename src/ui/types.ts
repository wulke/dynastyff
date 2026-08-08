// @spec DFF-STATIC-013
// @spec DFF-STATIC-060
// @spec DFF-UI-010
export type ScoringFormat = 'ppr' | 'half_ppr' | 'standard';
export type TePremiumTier = 'off' | 'tep' | 'tepp' | 'teppp';

// @spec DFF-STATIC-060
// @spec DFF-UI-010
export type RosterConfig = {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  FLEX: number;
  SF: number;
  bench: number;
};

// @spec DFF-STATIC-060
// @spec DFF-UI-010
export type DraftConfig = {
  name: string;
  teamCount: number;
  rounds: number;
  scoringFormat: ScoringFormat;
  tePremiumTier?: TePremiumTier;
  userPickPosition: number;
  futurePickYears: number;
  rosterConfig: RosterConfig;
};

// @spec DFF-STATIC-013
// @spec DFF-STATIC-060
export type Snapshot = {
  exportedAt: string;
  players: Array<{
    id: string;
    name: string;
    position: 'QB' | 'RB' | 'WR' | 'TE';
    nflTeam: string | null;
    age: number | null;
    isRookie: boolean;
    dynastyValue: number;
    adp: number | null;
  }>;
  pickValues: Array<{
    year: number;
    round: number;
    dynastyValue: number;
  }>;
};
