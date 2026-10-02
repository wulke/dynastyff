import type {
  FetchLike,
  SleeperLeaguePayload,
  SleeperNflStatePayload,
  SleeperRosterPayload,
  SleeperTradedPickPayload,
  SleeperTransactionPayload,
  SleeperUserEntryPayload,
  SleeperUserPayload,
} from './types.js';

export class SleeperApiError extends Error {}

// Thin typed wrapper over the read-only Sleeper public API. All endpoints are
// documented in docs/llds/sleeper-sync.md. Inject `fetchImpl` for tests.
export function createSleeperClient({
  baseUrl = 'https://api.sleeper.app/v1',
  fetchImpl = fetch as FetchLike,
}: {
  baseUrl?: string;
  fetchImpl?: FetchLike;
} = {}) {
  async function getJson<T>(path: string): Promise<T> {
    let response: Response;

    try {
      response = await fetchImpl(`${baseUrl}${path}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SleeperApiError(`Sleeper request failed for ${path}: ${message}`);
    }

    if (!response.ok) {
      throw new SleeperApiError(`Sleeper returned ${response.status} for ${path}.`);
    }

    try {
      return (await response.json()) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SleeperApiError(`Sleeper returned invalid JSON for ${path}: ${message}`);
    }
  }

  return {
    // @spec DFF-SLS-037
    fetchNflState: (): Promise<SleeperNflStatePayload> => getJson('/state/nfl'),
    // @spec DFF-SLS-010
    fetchUserByUsername: (username: string): Promise<SleeperUserPayload | null> =>
      getJson<SleeperUserPayload | null>(`/user/${encodeURIComponent(username)}`),
    // @spec DFF-SLS-071
    fetchUserLeagues: (userId: string, season: number): Promise<SleeperLeaguePayload[]> =>
      getJson(`/user/${encodeURIComponent(userId)}/leagues/nfl/${season}`),
    // @spec DFF-SLS-011
    fetchLeague: (leagueId: string): Promise<SleeperLeaguePayload> => getJson(`/league/${leagueId}`),
    // @spec DFF-SLS-031
    fetchLeagueRosters: (leagueId: string): Promise<SleeperRosterPayload[]> =>
      getJson(`/league/${leagueId}/rosters`),
    // @spec DFF-SLS-032
    fetchLeagueUsers: (leagueId: string): Promise<SleeperUserEntryPayload[]> =>
      getJson(`/league/${leagueId}/users`),
    // @spec DFF-SLS-033
    fetchLeagueTransactions: (leagueId: string, week: number): Promise<SleeperTransactionPayload[]> =>
      getJson(`/league/${leagueId}/transactions/${week}`),
    // @spec DFF-SLS-090
    fetchLeagueTradedPicks: (leagueId: string): Promise<SleeperTradedPickPayload[]> =>
      getJson(`/league/${leagueId}/traded_picks`),
    // @spec DFF-SLS-034
    fetchPlayerRegistry: (): Promise<Record<string, unknown>> => getJson('/players/nfl'),
  };
}

export type SleeperClient = ReturnType<typeof createSleeperClient>;
