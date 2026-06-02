// @spec DFF-UI-031
// @spec DFF-UI-032
// @spec DFF-UI-033
// @spec DFF-UI-034
// @spec DFF-UI-035
// @spec DFF-UI-036
// @spec DFF-UI-080
// @spec DFF-UI-120
// @spec DFF-UI-121
// @spec DFF-UI-122
// @spec DFF-UI-123
// @spec DFF-UI-124
// @spec DFF-UI-125
// @spec DFF-UI-126
// @spec DFF-UI-139
// @spec DFF-UI-140
// @spec DFF-UI-141
// @spec DFF-UI-142
// @spec DFF-UI-143
// @spec DFF-UI-132
import { useState, type ReactNode } from 'react';

import { useDraftContext, type DraftState } from '../context/DraftContext.js';

type AvailablePlayersPanelProps = {
  draftState: DraftState;
  isInteractionBlocked?: boolean;
  headerAction?: ReactNode;
};

type PositionFilter = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE' | 'Picks';
type AvailablePlayersTab = 'available' | 'targets';

const FILTERS: PositionFilter[] = ['ALL', 'QB', 'RB', 'WR', 'TE', 'Picks'];

function getPositionBadgeClass(position: string): string {
  const base = 'inline-block rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.2em]';

  if (position === 'QB') {
    return `${base} border-amber-400/30 bg-amber-400/10 text-amber-200`;
  }

  if (position === 'RB') {
    return `${base} border-blue-400/30 bg-blue-400/10 text-blue-200`;
  }

  if (position === 'WR') {
    return `${base} border-emerald-400/30 bg-emerald-400/10 text-emerald-200`;
  }

  if (position === 'TE') {
    return `${base} border-purple-400/30 bg-purple-400/10 text-purple-200`;
  }

  if (position === 'PICK' || position === 'RDP') {
    return `${base} border-yellow-400/30 bg-yellow-400/10 text-yellow-200`;
  }

  return `${base} border-stone-400/30 bg-stone-400/10 text-stone-400`;
}

// @spec DFF-UI-035
function isUsersTurn(draftState: DraftState): boolean {
  if (draftState.currentPickNumber === null) {
    return false;
  }

  const currentSlot = draftState.draftOrder.find((slot) => slot.pickNumber === draftState.currentPickNumber) ?? null;
  const currentTeam = currentSlot
    ? draftState.teams.find((team) => team.id === currentSlot.teamId) ?? null
    : null;

  return Boolean(currentTeam?.isUser);
}

// @spec DFF-UI-031
function matchesPositionFilter(position: string, filter: PositionFilter): boolean {
  if (filter === 'ALL') {
    return true;
  }

  if (filter === 'Picks') {
    return position === 'PICK' || position === 'RDP';
  }

  return position === filter;
}

// @spec DFF-UI-121
// @spec DFF-UI-122
// @spec DFF-UI-124
function resolveQueuedPlayers(draftState: DraftState) {
  const availablePlayersById = new Map(draftState.availablePlayers.map((player) => [player.id, player]));

  return [...draftState.userQueue]
    .sort((left, right) => left.rank - right.rank)
    .map((entry) => availablePlayersById.get(entry.playerId) ?? draftState.playerCatalog[entry.playerId] ?? null)
    .filter((player) => player !== null);
}

// @spec DFF-UI-140
function getTabButtonClass(isActive: boolean): string {
  const base =
    'rounded-full border px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-amber-300/50';

  if (isActive) {
    return `${base} border-amber-300/40 bg-amber-300 text-stone-950`;
  }

  return `${base} border-stone-800 bg-stone-950/50 text-stone-300 hover:border-stone-700 hover:text-stone-100`;
}

function AvailablePlayersLoadingState() {
  return (
    <section
      className="rounded-[1.75rem] border border-stone-800 bg-stone-900/90 p-5 shadow-2xl shadow-black/20"
      data-testid="available-players-loading"
      aria-label="Loading available players"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">On The Clock</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-stone-50">Available Players</h2>
        </div>
        <div className="h-8 w-24 animate-pulse rounded-full bg-stone-800" />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(10rem,12rem)_minmax(0,1fr)]" aria-hidden="true">
        <div className="h-10 animate-pulse rounded-xl bg-stone-800" />
        <div className="h-10 animate-pulse rounded-xl bg-stone-800" />
      </div>
      <div className="mt-5 space-y-2" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={`available-player-skeleton-${index}`}
            className="rounded-xl border border-stone-800 bg-stone-950/60 px-4 py-3"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-2">
                <div className="h-4 w-32 animate-pulse rounded bg-stone-800" />
                <div className="h-3 w-24 animate-pulse rounded bg-stone-800" />
              </div>
              <div className="h-4 w-16 animate-pulse rounded bg-stone-800" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// @spec DFF-UI-031
// @spec DFF-UI-032
// @spec DFF-UI-033
// @spec DFF-UI-034
// @spec DFF-UI-035
// @spec DFF-UI-036
// @spec DFF-UI-080
// @spec DFF-UI-120
// @spec DFF-UI-122
// @spec DFF-UI-123
// @spec DFF-UI-125
// @spec DFF-UI-126
// @spec DFF-UI-139
// @spec DFF-UI-140
// @spec DFF-UI-141
// @spec DFF-UI-142
// @spec DFF-UI-143
// @spec DFF-UI-132
export function AvailablePlayersPanel({
  draftState,
  isInteractionBlocked = false,
  headerAction = null,
}: AvailablePlayersPanelProps) {
  const { submitPick } = useDraftContext();
  const [activeTab, setActiveTab] = useState<AvailablePlayersTab>('available');
  const [positionFilter, setPositionFilter] = useState<PositionFilter>('ALL');
  const [nameQuery, setNameQuery] = useState('');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  if (draftState.isHydrating) {
    return <AvailablePlayersLoadingState />;
  }

  const userTurn = isUsersTurn(draftState) && !isInteractionBlocked;
  const queuedPlayers = resolveQueuedPlayers(draftState);
  const normalizedQuery = nameQuery.trim().toLowerCase();
  const filteredPlayers = draftState.availablePlayers.filter((player) => {
    if (!matchesPositionFilter(player.position, positionFilter)) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return player.name.toLowerCase().includes(normalizedQuery);
  });
  const selectedPlayer =
    draftState.availablePlayers.find((player) => player.id === selectedPlayerId) ??
    queuedPlayers.find((player) => player.id === selectedPlayerId) ??
    null;

  async function handleConfirmPick() {
    if (!selectedPlayer) {
      return;
    }

    await submitPick(selectedPlayer.id);
    setSelectedPlayerId(null);
  }

  return (
    <section
      className={`rounded-[1.75rem] border border-stone-800 bg-stone-900/90 p-5 shadow-2xl shadow-black/20 ${
        isInteractionBlocked ? 'opacity-80' : ''
      }`}
    >
      <div className="rounded-[1.5rem] border border-stone-800 bg-stone-900/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">
              {activeTab === 'available' ? 'On The Clock' : 'Queue'}
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-stone-50">
              {activeTab === 'available' ? 'Available Players' : 'Targets'}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2" aria-label="Available players views">
            {headerAction}
            <button
              type="button"
              aria-pressed={activeTab === 'available'}
              disabled={isInteractionBlocked}
              onClick={() => setActiveTab('available')}
              className={getTabButtonClass(activeTab === 'available')}
            >
              Available
            </button>
            <button
              type="button"
              aria-pressed={activeTab === 'targets'}
              disabled={isInteractionBlocked}
              onClick={() => setActiveTab('targets')}
              className={getTabButtonClass(activeTab === 'targets')}
            >
              Targets
            </button>
          </div>
        </div>

        {activeTab === 'available' ? (
          <div data-testid="available-players-panel">
            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(10rem,12rem)_minmax(0,1fr)]">
              <label className="block">
                <span className="mb-1 block text-[0.68rem] font-semibold uppercase tracking-[0.25em] text-stone-500">
                  Position Filter
                </span>
                <select
                  value={positionFilter}
                  disabled={isInteractionBlocked}
                  onChange={(event) => setPositionFilter(event.target.value as PositionFilter)}
                  aria-label="Position filter"
                  className="w-full rounded-xl border border-stone-700 bg-stone-950/80 px-3 py-2.5 text-sm text-stone-100 outline-none transition focus:border-amber-300"
                >
                  {FILTERS.map((filter) => (
                    <option key={filter} value={filter}>
                      {filter}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="sr-only">Search players</span>
                <input
                  type="search"
                  value={nameQuery}
                  disabled={isInteractionBlocked}
                  onChange={(event) => setNameQuery(event.target.value)}
                  placeholder="Search players"
                  aria-label="Search players"
                  className="w-full rounded-xl border border-stone-700 bg-stone-950/80 px-4 py-2.5 text-sm text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-amber-300"
                />
              </label>
            </div>

            <div className="mt-5 space-y-2">
              {filteredPlayers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-stone-700 px-4 py-8 text-center text-sm text-stone-500">
                  No players match the current filters.
                </div>
              ) : (
                filteredPlayers.map((player) => (
                  <button
                    key={player.id}
                    type="button"
                    data-testid={`available-player-row-${player.id}`}
                    data-player-id={player.id}
                    disabled={!userTurn}
                    onClick={() => setSelectedPlayerId(player.id)}
                    className="flex w-full items-center justify-between gap-4 rounded-xl border border-stone-800 bg-stone-950/55 px-4 py-3 text-left transition hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-stone-800"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-stone-50">{player.name}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <span className={getPositionBadgeClass(player.position)}>{player.position}</span>
                        <span className="text-xs uppercase tracking-[0.25em] text-stone-500">
                          {player.nflTeam ?? 'FA'}
                        </span>
                        <span className="text-xs uppercase tracking-[0.25em] text-stone-500">
                          Age {player.age ?? 'NA'}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.25em] text-stone-500">
                        Dynasty
                      </p>
                      <p className="mt-1 text-base font-semibold text-amber-300">{player.dynastyValue}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <section className="mt-4" data-testid="targets-panel">
            <div className="space-y-2">
              {queuedPlayers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-stone-700 px-4 py-6 text-center text-sm text-stone-500">
                  No targets added yet
                </div>
              ) : (
                queuedPlayers.map((player) => (
                  <button
                    key={player.id}
                    type="button"
                    data-testid={`target-player-row-${player.id}`}
                    data-player-id={player.id}
                    disabled={!userTurn}
                    onClick={() => setSelectedPlayerId(player.id)}
                    className="flex w-full items-center justify-between gap-4 rounded-xl border border-stone-800 bg-stone-950/55 px-4 py-2.5 text-left transition hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-stone-800"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-stone-50">{player.name}</p>
                      <div className="mt-1.5">
                        <span className={getPositionBadgeClass(player.position)}>{player.position}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.25em] text-stone-500">
                        Dynasty
                      </p>
                      <p className="mt-1 text-base font-semibold text-amber-300">{player.dynastyValue}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>
        )}
      </div>

      <div className="mt-6">
        {selectedPlayer ? (
          <section
            className="rounded-[1.5rem] border border-amber-300/30 bg-amber-300/10 px-4 py-4"
            data-testid="pick-confirmation-card"
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-300">Selected Player</p>
                <h3 className="mt-2 text-xl font-semibold text-stone-50">{selectedPlayer.name}</h3>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className={getPositionBadgeClass(selectedPlayer.position)}>{selectedPlayer.position}</span>
                  <span className="text-sm text-stone-400">
                    Dynasty {selectedPlayer.dynastyValue}
                  </span>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedPlayerId(null)}
                  disabled={isInteractionBlocked}
                  className="rounded-full border border-stone-700 px-4 py-2 text-sm font-semibold text-stone-200 transition hover:border-stone-500 hover:text-stone-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmPick()}
                  disabled={isInteractionBlocked}
                  className="rounded-full bg-amber-300 px-4 py-2 text-sm font-semibold text-stone-950 transition hover:bg-amber-200"
                >
                  Confirm Pick
                </button>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}
