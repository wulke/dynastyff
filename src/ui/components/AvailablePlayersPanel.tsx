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
import { getPositionBadgeClass } from './positionBadge.js';

type AvailablePlayersPanelProps = {
  draftState: DraftState;
  isInteractionBlocked?: boolean;
  headerAction?: ReactNode;
};

type PositionFilter = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE' | 'Picks';
type AvailablePlayersTab = 'available' | 'targets';

const FILTERS: PositionFilter[] = ['ALL', 'QB', 'RB', 'WR', 'TE', 'Picks'];

// @spec DFF-UI-035
function isUsersTurn(draftState: DraftState): boolean {
  if (draftState.currentPickNumber === null) return false;

  const currentSlot = draftState.draftOrder.find((slot) => slot.pickNumber === draftState.currentPickNumber) ?? null;
  const currentTeam = currentSlot ? draftState.teams.find((team) => team.id === currentSlot.teamId) ?? null : null;

  return Boolean(currentTeam?.isUser);
}

// @spec DFF-UI-031
function matchesPositionFilter(position: string, filter: PositionFilter): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'Picks') return position === 'PICK' || position === 'RDP';
  return position === filter;
}

// @spec DFF-UI-121
// @spec DFF-UI-122
// @spec DFF-UI-124
function resolveQueuedPlayers(draftState: DraftState) {
  const availablePlayersById = new Map(draftState.availablePlayers.map((player) => [player.id, player]));

  return [...draftState.userQueue]
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => availablePlayersById.get(entry.playerId) ?? draftState.playerCatalog[entry.playerId] ?? null)
    .filter((player) => player !== null);
}

// @spec DFF-UI-140
function getTabButtonClass(isActive: boolean): string {
  if (isActive) return 'rounded border border-accent/30 bg-accent text-accent-fg px-3 py-1 text-xs font-semibold transition';
  return 'rounded border border-default px-3 py-1 text-xs font-semibold text-muted transition hover:border-strong hover:text-secondary';
}

function AvailablePlayersLoadingState() {
  return (
    <section
      className="rounded-md border border-default bg-surface"
      data-testid="available-players-loading"
      aria-label="Loading available players"
    >
      <div className="flex items-center justify-between gap-3 border-b border-default px-3 py-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">On The Clock</p>
          <h2 className="font-condensed text-lg font-semibold text-primary">Available Players</h2>
        </div>
        <div className="h-6 w-20 animate-pulse rounded bg-surface-raised" />
      </div>
      <div className="p-3">
        <div className="grid gap-2 md:grid-cols-[minmax(8rem,10rem)_minmax(0,1fr)]" aria-hidden="true">
          <div className="h-7 animate-pulse rounded bg-surface-raised" />
          <div className="h-7 animate-pulse rounded bg-surface-raised" />
        </div>
        <div className="mt-3 space-y-1.5" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={`available-player-skeleton-${index}`}
              className="rounded border border-default bg-app px-2 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="h-3.5 w-28 animate-pulse rounded bg-surface-raised" />
                  <div className="h-2.5 w-20 animate-pulse rounded bg-surface-raised" />
                </div>
                <div className="h-3.5 w-12 animate-pulse rounded bg-surface-raised" />
              </div>
            </div>
          ))}
        </div>
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
// @spec DFF-UI-050
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

  if (draftState.isHydrating) return <AvailablePlayersLoadingState />;

  const userTurn = isUsersTurn(draftState) && !isInteractionBlocked;
  const queuedPlayers = resolveQueuedPlayers(draftState);
  const normalizedQuery = nameQuery.trim().toLowerCase();
  const filteredPlayers = draftState.availablePlayers.filter((player) => {
    if (!matchesPositionFilter(player.position, positionFilter)) return false;
    if (!normalizedQuery) return true;
    return player.name.toLowerCase().includes(normalizedQuery);
  });
  const selectedPlayer =
    draftState.availablePlayers.find((player) => player.id === selectedPlayerId) ??
    queuedPlayers.find((player) => player.id === selectedPlayerId) ??
    null;

  async function handleConfirmPick() {
    if (!selectedPlayer) return;
    await submitPick(selectedPlayer.id);
    setSelectedPlayerId(null);
  }

  return (
    <section className={`rounded-md border border-default bg-surface ${isInteractionBlocked ? 'opacity-80' : ''}`}>
      {/* Panel header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-default px-3 py-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">
            {activeTab === 'available' ? 'On The Clock' : 'Queue'}
          </p>
          <h2 className="font-condensed text-lg font-semibold text-primary">
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

      <div className="p-3">
        {activeTab === 'available' ? (
          <div data-testid="available-players-panel">
            <div className="grid gap-2 md:grid-cols-[minmax(8rem,10rem)_minmax(0,1fr)]">
              <label className="block">
                <span className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-widest text-muted">
                  Position
                </span>
                <select
                  value={positionFilter}
                  disabled={isInteractionBlocked}
                  onChange={(event) => setPositionFilter(event.target.value as PositionFilter)}
                  aria-label="Position filter"
                  className="w-full rounded border border-strong bg-app px-2 py-1.5 text-xs text-primary outline-none transition focus:border-accent"
                >
                  {FILTERS.map((filter) => (
                    <option key={filter} value={filter}>{filter}</option>
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
                  placeholder="Search players…"
                  aria-label="Search players"
                  className="w-full rounded border border-strong bg-app px-2 py-1.5 text-xs text-primary outline-none transition placeholder:text-muted focus:border-accent"
                />
              </label>
            </div>

            <div className="mt-3 space-y-1">
              {filteredPlayers.length === 0 ? (
                <div className="rounded border border-dashed border-default px-3 py-6 text-center text-xs text-muted">
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
                    className="flex w-full items-center justify-between gap-3 rounded border border-default bg-app px-2 py-2 text-left transition hover:border-accent hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-default disabled:hover:bg-app"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-primary">{player.name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className={getPositionBadgeClass(player.position)}>{player.position}</span>
                        <span className="text-[0.6rem] uppercase tracking-wide text-muted">{player.nflTeam ?? 'FA'}</span>
                        <span className="text-[0.6rem] uppercase tracking-wide text-muted">Age {player.age ?? 'NA'}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[0.6rem] font-semibold uppercase tracking-widest text-muted">Dynasty</p>
                      <p className="font-condensed text-sm font-bold tabular-nums text-accent">{player.dynastyValue}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <section className="mt-0" data-testid="targets-panel">
            <div className="space-y-1">
              {queuedPlayers.length === 0 ? (
                <div className="rounded border border-dashed border-default px-3 py-6 text-center text-xs text-muted">
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
                    className="flex w-full items-center justify-between gap-3 rounded border border-default bg-app px-2 py-2 text-left transition hover:border-accent hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-default disabled:hover:bg-app"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-primary">{player.name}</p>
                      <div className="mt-1">
                        <span className={getPositionBadgeClass(player.position)}>{player.position}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[0.6rem] font-semibold uppercase tracking-widest text-muted">Dynasty</p>
                      <p className="font-condensed text-sm font-bold tabular-nums text-accent">{player.dynastyValue}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>
        )}

        {selectedPlayer ? (
          <section
            className="mt-3 rounded-md border border-accent/30 bg-accent/10 px-3 py-3"
            data-testid="pick-confirmation-card"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-accent">Selected</p>
                <h3 className="font-condensed text-lg font-semibold text-primary">{selectedPlayer.name}</h3>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className={getPositionBadgeClass(selectedPlayer.position)}>{selectedPlayer.position}</span>
                  <span className="text-xs text-muted tabular-nums">Dynasty {selectedPlayer.dynastyValue}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedPlayerId(null)}
                  disabled={isInteractionBlocked}
                  className="rounded border border-default px-3 py-1.5 text-xs font-semibold text-secondary transition hover:border-strong hover:text-primary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmPick()}
                  disabled={isInteractionBlocked}
                  className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition hover:bg-accent-hover"
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
