// Shared types for the Sleeper sync module.

export type FetchLike = (url: string) => Promise<Response>;

export type SyncLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export type SleeperConnectionRecord = {
  id: string;
  leagueId: string;
  leagueName: string;
  season: string;
  userId: string;
  rosterId: number;
  connectedAt: string;
  lastSyncedAt: string | null;
};

// Loosely-typed views of Sleeper API payloads. Field-level validation happens
// in sync.ts so malformed items can be skipped (DFF-SLS-061) instead of
// poisoning the whole league sync.

export type SleeperNflStatePayload = {
  season?: unknown;
  week?: unknown;
};

export type SleeperUserPayload = {
  user_id?: unknown;
  username?: unknown;
  display_name?: unknown;
};

export type SleeperLeaguePayload = {
  league_id?: unknown;
  name?: unknown;
  season?: unknown;
  total_rosters?: unknown;
  status?: unknown;
  settings?: unknown;
  scoring_settings?: unknown;
  roster_positions?: unknown;
};

export type SleeperRosterPayload = {
  roster_id?: unknown;
  owner_id?: unknown;
  players?: unknown;
  starters?: unknown;
  taxi?: unknown;
  reserve?: unknown;
  settings?: unknown;
};

export type SleeperUserEntryPayload = {
  user_id?: unknown;
  display_name?: unknown;
  metadata?: unknown;
};

export type SleeperTransactionPayload = {
  transaction_id?: unknown;
  type?: unknown;
  status?: unknown;
  roster_ids?: unknown;
  adds?: unknown;
  drops?: unknown;
  draft_picks?: unknown;
  created?: unknown;
  status_updated?: unknown;
};

export type PlayerRegistryEntry = {
  fullName: string;
  position: string;
};

export type PlayerRegistry = Record<string, PlayerRegistryEntry>;
