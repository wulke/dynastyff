// @spec DFF-SLS-080
// @spec DFF-SLS-081
// @spec DFF-SLS-082
// @spec DFF-SM-001
// @spec DFF-SM-002
import { useCallback, useEffect, useState } from 'react';

type SleeperConnection = {
  id: string;
  leagueId: string;
  leagueName: string;
  season: string;
  rosterId: number;
  lastSyncedAt: string | null;
};

type SyncStatus = {
  leagueId: string;
  leagueName: string;
  lastSyncedAt: string | null;
  lastRun: { startedAt: string; completedAt: string | null; error: string | null } | null;
};

type LeagueSummary = {
  leagueId: string;
  name: string;
  season: string;
  totalRosters: number;
  status: string;
};

// @spec DFF-SM-019
type SeasonRosterEntry = {
  name: string;
  position: string;
  age: number | null;
  dynastyValue: number;
  slotType: 'starter' | 'bench' | 'ir' | 'taxi';
  matched: boolean;
};

type SeasonPositionEval = {
  grade: string;
  percentile: number;
  valueScore: number;
  rawStarterValue: number;
  ageCurveScore: number;
  depthScore: number;
  starters: SeasonRosterEntry[];
};

type SeasonOverview = {
  overallGrade: string;
  overallPercentile: number;
  teamContext: { classification: 'contender' | 'rebuilder'; winPct: number; rank: number; teamCount: number };
  positions: Record<string, SeasonPositionEval>;
  roster: SeasonRosterEntry[];
  staleSince: string | null;
  lastSyncedAt: string | null;
};

function formatTimestamp(iso: string | null): string {
  if (!iso) {
    return 'never';
  }

  const parsed = Date.parse(iso);

  return Number.isNaN(parsed)
    ? 'unknown'
    : new Date(parsed).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

const positionTextTokens: Record<string, string> = {
  QB: 'text-pos-qb',
  RB: 'text-pos-rb',
  WR: 'text-pos-wr',
  TE: 'text-pos-te',
};

const slotOrder: SeasonRosterEntry['slotType'][] = ['starter', 'bench', 'taxi', 'ir'];

// @spec DFF-SM-019
// @spec DFF-SM-026
// @spec DFF-SM-081
// @spec DFF-SM-084
function RosterOverviewView({
  overview,
  onRefresh,
  busy,
}: {
  overview: SeasonOverview;
  onRefresh: () => void;
  busy: boolean;
}) {
  const positions = Object.entries(overview.positions);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent bg-surface px-3 py-2">
        <div className="flex items-baseline gap-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">Roster Overview</p>
          <span className="font-condensed text-3xl font-bold tabular-nums text-primary" aria-label={`Overall grade ${overview.overallGrade}`}>
            {overview.overallGrade}
          </span>
          <span className="font-condensed text-lg tabular-nums text-secondary">PCTL {Math.round(overview.overallPercentile)}</span>
          <span className="rounded border border-info px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-info">
            {overview.teamContext.classification}
          </span>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          Refresh
        </button>
      </div>

      {overview.staleSince !== null ? (
        <p className="mb-2 rounded-md border border-warning bg-surface px-3 py-2 text-sm text-warning" role="status">
          Sleeper data is stale (last synced {formatTimestamp(overview.staleSince)}). Refresh to pull the latest league state.
        </p>
      ) : null}

      <div className="mb-3 rounded-md border border-default bg-surface">
        <div className="border-b border-default px-3 py-2">
          <h2 className="font-condensed text-lg font-semibold text-primary">Position Grades</h2>
        </div>
        {positions.map(([position, evaluation]) => (
          <div key={position} className="flex flex-wrap items-center gap-3 border-b border-default px-3 py-2 text-sm last:border-b-0 hover:bg-surface-hover">
            <span className={`w-8 font-condensed text-sm font-bold ${positionTextTokens[position] ?? 'text-primary'}`}>{position}</span>
            <span className="font-condensed text-xl font-bold tabular-nums text-primary">{evaluation.grade}</span>
            <span className="font-condensed text-xs tabular-nums text-secondary">PCTL {Math.round(evaluation.percentile)}</span>
            <span className="font-condensed text-xs tabular-nums text-secondary">
              VAL {Math.round(evaluation.rawStarterValue)} · DEP {Math.round(evaluation.depthScore)} · AGE {Math.round(evaluation.ageCurveScore)}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted">
              {evaluation.starters.map((entry) => entry.name).join(', ') || 'No starters synced'}
            </span>
          </div>
        ))}
      </div>

      <div className="rounded-md border border-default bg-surface">
        <div className="border-b border-default px-3 py-2">
          <h2 className="font-condensed text-lg font-semibold text-primary">Roster</h2>
        </div>
        {slotOrder.flatMap((slot) =>
          overview.roster
            .filter((entry) => entry.slotType === slot)
            .map((entry) => (
              <div key={`${slot}-${entry.name}`} className="flex items-center gap-3 border-b border-default px-3 py-1 text-sm last:border-b-0 hover:bg-surface-hover">
                <span className={`w-8 font-condensed text-sm font-bold ${positionTextTokens[entry.position] ?? 'text-primary'}`}>{entry.position}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-primary">{entry.name}</span>
                {!entry.matched ? (
                  <span className="rounded border border-default px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-muted">unmatched</span>
                ) : null}
                <span className="font-condensed text-xs tabular-nums text-secondary">{entry.age !== null ? `${entry.age}y` : '—'}</span>
                <span className="font-condensed text-xs tabular-nums text-secondary">{entry.dynastyValue}</span>
                <span className="rounded border border-default px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-muted">{entry.slotType}</span>
              </div>
            )),
        )}
      </div>
    </>
  );
}

// @spec DFF-SLS-080
// @spec DFF-SLS-081
function ConnectionPrompt({
  username,
  leagueId,
  onUsernameChange,
  onLeagueIdChange,
  onFindLeagues,
  onPreviewLeague,
  onConnect,
  leagueOptions,
  preview,
  busy,
  error,
}: {
  username: string;
  leagueId: string;
  onUsernameChange: (value: string) => void;
  onLeagueIdChange: (value: string) => void;
  onFindLeagues: () => void;
  onPreviewLeague: () => void;
  onConnect: (leagueIdToConnect: string) => void;
  leagueOptions: LeagueSummary[] | null;
  preview: LeagueSummary | null;
  busy: boolean;
  error: string | null;
}) {
  return (
    <section className="w-full max-w-3xl" aria-labelledby="my-team-connect-title">
      <div className="mb-3 rounded-md border border-accent bg-surface px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">My Team</p>
        <h1 id="my-team-connect-title" className="font-condensed text-2xl font-bold text-primary">
          Connect Your Sleeper League
        </h1>
        <p className="text-sm text-secondary">
          Enter your Sleeper username to list your dynasty leagues, or enter a league ID directly.
        </p>
      </div>

      <div className="rounded-md border border-default bg-surface">
        <div className="border-b border-default px-3 py-2">
          <h2 className="font-condensed text-lg font-semibold text-primary">League Connection</h2>
        </div>
        <div className="flex flex-wrap items-end gap-2 px-3 py-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted">
            Sleeper username
            <input
              type="text"
              aria-label="Sleeper username"
              value={username}
              onChange={(event) => onUsernameChange(event.target.value)}
              className="mt-1 block w-56 rounded border border-default bg-app px-2 py-1 text-sm font-medium text-primary outline-none focus:border-accent"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-muted">
            League ID
            <input
              type="text"
              aria-label="Sleeper league ID"
              value={leagueId}
              onChange={(event) => onLeagueIdChange(event.target.value)}
              placeholder="optional"
              className="mt-1 block w-44 rounded border border-default bg-app px-2 py-1 text-sm font-medium text-primary outline-none focus:border-accent"
            />
          </label>
          <button
            type="button"
            onClick={onFindLeagues}
            disabled={busy || username.trim().length === 0}
            className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            Find my leagues
          </button>
          <button
            type="button"
            onClick={onPreviewLeague}
            disabled={busy || leagueId.trim().length === 0}
            className="rounded border border-default px-3 py-1.5 text-sm font-medium text-secondary transition hover:border-strong hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            Preview league
          </button>
        </div>

        {error !== null ? (
          <p className="border-t border-default px-3 py-2 text-sm text-negative" role="alert">
            {error}
          </p>
        ) : null}

        {preview !== null ? (
          <div className="border-t border-default px-3 py-2" aria-label="League preview">
            <div className="flex items-center gap-2 px-2 py-1">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary">
                {preview.name}
              </span>
              <span className="font-condensed tabular-nums text-xs text-secondary">
                {preview.season} · {preview.totalRosters} teams
              </span>
              <button
                type="button"
                onClick={() => onConnect(preview.leagueId)}
                disabled={busy || username.trim().length === 0}
                className="rounded bg-accent px-3 py-1 text-xs font-semibold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                Connect
              </button>
            </div>
            {username.trim().length === 0 ? (
              <p className="px-2 pb-1 text-xs text-muted">
                Enter your Sleeper username to bind this league to your roster.
              </p>
            ) : null}
          </div>
        ) : null}

        {leagueOptions !== null ? (
          <div className="border-t border-default px-3 py-2" aria-label="League options">
            {leagueOptions.length === 0 ? (
              <p className="px-2 py-1 text-sm text-muted">
                No dynasty leagues found for this username in the current season.
              </p>
            ) : (
              leagueOptions.map((league) => (
                <div
                  key={league.leagueId}
                  className="flex items-center gap-2 border-b border-default px-2 py-1 text-sm last:border-b-0 hover:bg-surface-hover"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-primary">
                    {league.name}
                  </span>
                  <span className="font-condensed tabular-nums text-xs text-secondary">
                    {league.season} · {league.totalRosters} teams
                  </span>
                  <button
                    type="button"
                    onClick={() => onConnect(league.leagueId)}
                    disabled={busy}
                    className="rounded bg-accent px-3 py-1 text-xs font-semibold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Connect
                  </button>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

// @spec DFF-SLS-082
function ConnectionRow({
  connection,
  status,
  onDisconnect,
  busy,
}: {
  connection: SleeperConnection;
  status: SyncStatus | undefined;
  onDisconnect: (id: string) => void;
  busy: boolean;
}) {
  const hasError = status?.lastRun?.error ?? null;
  const badgeClass =
    hasError !== null
      ? 'rounded border border-negative px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-negative'
      : connection.lastSyncedAt !== null
        ? 'rounded border border-info px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-info'
        : 'rounded border border-default px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-muted';

  return (
    <div className="flex items-center gap-2 border-b border-default px-2 py-1 text-sm last:border-b-0 hover:bg-surface-hover">
      <span className="min-w-0 flex-1 truncate font-medium text-primary">
        {connection.leagueName}
      </span>
      <span className="font-condensed tabular-nums text-xs text-secondary">
        {connection.season} · R{connection.rosterId}
      </span>
      <span className="text-xs text-muted" title={status?.lastRun?.error ?? undefined}>
        synced {formatTimestamp(connection.lastSyncedAt)}
      </span>
      <span className={badgeClass}>{hasError !== null ? 'error' : connection.lastSyncedAt !== null ? 'ok' : 'new'}</span>
      <button
        type="button"
        onClick={() => onDisconnect(connection.id)}
        disabled={busy}
        className="rounded border border-default px-2 py-1 text-xs font-medium text-secondary transition hover:border-negative hover:text-negative disabled:cursor-not-allowed disabled:opacity-40"
      >
        Disconnect
      </button>
    </div>
  );
}

// @spec DFF-SLS-080
// @spec DFF-SLS-081
// @spec DFF-SLS-082
// @spec DFF-SM-001
// @spec DFF-SM-002
// @spec DFF-SM-003
// @spec DFF-SM-004
// @spec DFF-SM-019
// @spec DFF-SM-026
export function MyTeamSection() {
  const [connections, setConnections] = useState<SleeperConnection[] | null>(null);
  const [status, setStatus] = useState<SyncStatus[]>([]);
  const [username, setUsername] = useState('');
  const [leagueId, setLeagueId] = useState('');
  const [leagueOptions, setLeagueOptions] = useState<LeagueSummary[] | null>(null);
  const [preview, setPreview] = useState<LeagueSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null);
  const [overview, setOverview] = useState<SeasonOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [showConnections, setShowConnections] = useState(false);
  const [overviewNonce, setOverviewNonce] = useState(0);

  const load = useCallback(async () => {
    try {
      const [connectionsResponse, statusResponse] = await Promise.all([
        fetch('/sleeper/connections'),
        fetch('/sleeper/sync/status'),
      ]);

      const connectionsJson = connectionsResponse.ok
        ? ((await connectionsResponse.json()) as unknown)
        : [];
      const statusJson = statusResponse.ok ? ((await statusResponse.json()) as unknown) : [];

      setConnections(Array.isArray(connectionsJson) ? (connectionsJson as SleeperConnection[]) : []);
      setStatus(Array.isArray(statusJson) ? (statusJson as SyncStatus[]) : []);
    } catch {
      setConnections([]);
      setStatus([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // @spec DFF-SM-003 — first connected league is selected by default; overview is the landing view.
  useEffect(() => {
    if (connections === null || connections.length === 0) {
      setSelectedLeagueId(null);
      setOverview(null);
      setOverviewError(null);
      return;
    }

    if (selectedLeagueId === null || !connections.some((entry) => entry.leagueId === selectedLeagueId)) {
      setSelectedLeagueId(connections[0].leagueId);
    }
  }, [connections, selectedLeagueId]);

  useEffect(() => {
    if (selectedLeagueId === null) {
      return;
    }

    let cancelled = false;

    const loadOverview = async () => {
      setOverviewError(null);

      try {
        const body = (await requestJson(`/season/${encodeURIComponent(selectedLeagueId)}/overview`)) as SeasonOverview;
        if (!cancelled) {
          setOverview(body);
        }
      } catch (caught) {
        if (!cancelled) {
          setOverview(null);
          setOverviewError(caught instanceof Error ? caught.message : String(caught));
        }
      }
    };

    void loadOverview();

    return () => {
      cancelled = true;
    };
  }, [selectedLeagueId, overviewNonce]);

  async function requestJson(input: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(input, init);
    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        body && typeof body === 'object' && 'error' in body
          ? String((body as { error: unknown }).error)
          : `Request failed (${response.status}).`;
      throw new Error(message);
    }

    return body;
  }

  // @spec DFF-SLS-080
  async function findLeagues() {
    setBusy(true);
    setError(null);
    setPreview(null);

    try {
      const payload = (await requestJson(`/sleeper/user/${encodeURIComponent(username.trim())}`)) as {
        leagues?: LeagueSummary[];
      };
      setLeagueOptions(payload.leagues ?? []);
    } catch (caught) {
      setLeagueOptions(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  // @spec DFF-SLS-081
  async function previewLeague() {
    setBusy(true);
    setError(null);
    setLeagueOptions(null);

    try {
      setPreview(
        (await requestJson(`/sleeper/league/${encodeURIComponent(leagueId.trim())}`)) as LeagueSummary,
      );
    } catch (caught) {
      setPreview(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  // @spec DFF-SLS-080
  // @spec DFF-SLS-081
  async function connect(leagueIdToConnect: string) {
    setBusy(true);
    setError(null);

    try {
      await requestJson('/sleeper/connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), league_id: leagueIdToConnect }),
      });
      setLeagueOptions(null);
      setPreview(null);
      setLeagueId('');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  // @spec DFF-SLS-082
  // @spec DFF-SM-004 — refresh triggers a Sleeper sync, then re-fetches the overview.
  async function syncNow() {
    setBusy(true);
    setError(null);

    try {
      await requestJson('/sleeper/sync', { method: 'POST' });
      await load();
      setOverviewNonce((nonce) => nonce + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  // @spec DFF-SLS-082
  async function disconnect(id: string) {
    setBusy(true);
    setError(null);

    try {
      await fetch(`/sleeper/connections/${id}`, { method: 'DELETE' });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  if (connections === null) {
    return (
      <section className="w-full max-w-3xl" aria-label="My Team loading">
        <p className="text-xs text-muted">Checking Sleeper connections…</p>
      </section>
    );
  }

  if (connections.length === 0) {
    return (
      <ConnectionPrompt
        username={username}
        leagueId={leagueId}
        onUsernameChange={(value) => {
          setUsername(value);
          setLeagueOptions(null);
        }}
        onLeagueIdChange={(value) => {
          setLeagueId(value);
          setPreview(null);
        }}
        onFindLeagues={() => void findLeagues()}
        onPreviewLeague={() => void previewLeague()}
        onConnect={(leagueIdToConnect) => void connect(leagueIdToConnect)}
        leagueOptions={leagueOptions}
        preview={preview}
        busy={busy}
        error={error}
      />
    );
  }

  const selectedConnection =
    connections.find((entry) => entry.leagueId === selectedLeagueId) ?? null;

  return (
    <section className="w-full max-w-3xl" aria-labelledby="my-team-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent bg-surface px-3 py-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">My Team</p>
          <h1 id="my-team-title" className="font-condensed text-2xl font-bold text-primary">
            {selectedConnection ? selectedConnection.leagueName : 'My Team'}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {connections.map((connection) => (
            <button
              key={connection.id}
              type="button"
              onClick={() => setSelectedLeagueId(connection.leagueId)}
              className={`rounded px-2 py-1 text-xs font-semibold transition ${
                connection.leagueId === selectedLeagueId
                  ? 'border border-accent bg-surface text-accent'
                  : 'border border-default bg-surface text-secondary hover:border-strong hover:text-primary'
              }`}
            >
              {connection.leagueName}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowConnections((visible) => !visible)}
            aria-expanded={showConnections}
            className="rounded border border-default px-2 py-1 text-xs font-medium text-secondary transition hover:border-strong hover:text-primary"
          >
            {showConnections ? 'Hide connections' : 'Manage connections'}
          </button>
        </div>
      </div>

      {error !== null ? (
        <p className="mb-2 rounded-md border border-negative bg-surface px-3 py-2 text-sm text-negative" role="alert">
          {error}
        </p>
      ) : null}

      {showConnections ? (
        <div className="mb-3 rounded-md border border-default bg-surface">
          <div className="flex items-center justify-between border-b border-default px-3 py-2">
            <h2 className="font-condensed text-lg font-semibold text-primary">Connected Leagues</h2>
            <button
              type="button"
              onClick={() => void syncNow()}
              disabled={busy}
              className="rounded border border-default px-3 py-1 text-sm font-medium text-secondary transition hover:border-strong hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              Sync now
            </button>
          </div>
          {connections.map((connection) => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              status={status.find((entry) => entry.leagueId === connection.leagueId)}
              onDisconnect={(id) => void disconnect(id)}
              busy={busy}
            />
          ))}
        </div>
      ) : null}

      {overviewError !== null ? (
        <div className="rounded-md border border-negative bg-surface px-3 py-2 text-sm text-negative" role="alert">
          <p className="font-semibold">Roster overview unavailable</p>
          <p className="text-xs">{overviewError}</p>
        </div>
      ) : overview !== null ? (
        <RosterOverviewView overview={overview} onRefresh={() => void syncNow()} busy={busy} />
      ) : (
        <p className="text-xs text-muted">Loading roster overview…</p>
      )}
    </section>
  );
}
