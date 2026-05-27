// @spec DFF-UI-031
// @spec DFF-UI-032
// @spec DFF-UI-033
// @spec DFF-UI-034
// @spec DFF-UI-035
// @spec DFF-UI-036
// @spec DFF-UI-080
import { useState } from 'react';

import { useDraftContext, type DraftState } from '../context/DraftContext.js';

type AvailablePlayersPanelProps = {
  draftState: DraftState;
};

type PositionFilter = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE' | 'Picks';

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

function AvailablePlayersLoadingState() {
  return (
    <section
      className="rounded-[2rem] border border-stone-800 bg-stone-900/90 p-6 shadow-2xl shadow-black/20"
      data-testid="available-players-loading"
      aria-label="Loading available players"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">On The Clock</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-stone-50">Available Players</h2>
        </div>
        <div className="h-8 w-24 animate-pulse rounded-full bg-stone-800" />
      </div>
      <div className="mt-6 flex flex-wrap gap-2" aria-hidden="true">
        {FILTERS.map((filter) => (
          <div key={filter} className="h-9 w-14 animate-pulse rounded-full bg-stone-800" />
        ))}
      </div>
      <div className="mt-4 h-11 animate-pulse rounded-2xl bg-stone-800" aria-hidden="true" />
      <div className="mt-6 space-y-3" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={`available-player-skeleton-${index}`}
            className="rounded-[1.5rem] border border-stone-800 bg-stone-950/60 px-4 py-4"
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
export function AvailablePlayersPanel({ draftState }: AvailablePlayersPanelProps) {
  const { submitPick } = useDraftContext();
  const [positionFilter, setPositionFilter] = useState<PositionFilter>('ALL');
  const [nameQuery, setNameQuery] = useState('');

  if (draftState.isHydrating) {
    return <AvailablePlayersLoadingState />;
  }

  const userTurn = isUsersTurn(draftState);
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

  return (
    <section
      className="rounded-[2rem] border border-stone-800 bg-stone-900/90 p-6 shadow-2xl shadow-black/20"
      data-testid="available-players-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">On The Clock</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-stone-50">Available Players</h2>
        </div>
        <div className="rounded-full border border-stone-700 px-4 py-2 text-sm text-stone-200">
          {userTurn ? 'Your turn' : 'Bot is picking…'}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {FILTERS.map((filter) => {
          const isActive = filter === positionFilter;

          return (
            <button
              key={filter}
              type="button"
              onClick={() => setPositionFilter(filter)}
              className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] transition ${
                isActive
                  ? 'border-amber-300 bg-amber-300 text-stone-950'
                  : 'border-stone-700 text-stone-300 hover:border-stone-500 hover:text-stone-100'
              }`}
            >
              {filter}
            </button>
          );
        })}
      </div>

      <label className="mt-4 block">
        <span className="sr-only">Search players</span>
        <input
          type="search"
          value={nameQuery}
          onChange={(event) => setNameQuery(event.target.value)}
          placeholder="Search players"
          aria-label="Search players"
          className="w-full rounded-2xl border border-stone-700 bg-stone-950/80 px-4 py-3 text-sm text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-amber-300"
        />
      </label>

      <div className="mt-6 space-y-3">
        {filteredPlayers.length === 0 ? (
          <div className="rounded-[1.5rem] border border-dashed border-stone-700 px-4 py-8 text-center text-sm text-stone-500">
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
              onClick={() => submitPick(player.id)}
              className="flex w-full items-center justify-between gap-4 rounded-[1.5rem] border border-stone-800 bg-stone-950/70 px-4 py-4 text-left transition hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-stone-800"
            >
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-stone-50">{player.name}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
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
                <p className="mt-1 text-lg font-semibold text-amber-300">{player.dynastyValue}</p>
              </div>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
