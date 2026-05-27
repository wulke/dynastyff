// @spec DFF-UI-020
// @spec DFF-UI-021
// @spec DFF-UI-022
// @spec DFF-UI-023
// @spec DFF-UI-024
// @spec DFF-UI-024b
// @spec DFF-UI-025
// @spec DFF-UI-026
// @spec DFF-UI-007
// @spec DFF-UI-088
// @spec DFF-UI-089
// @spec DFF-UI-090
// @spec DFF-UI-091
// @spec DFF-UI-092
import { useState } from 'react';
import type { DraftState } from '../context/DraftContext.js';

type DraftBoardProps = {
  draftState: DraftState;
  isInteractionBlocked?: boolean;
};

type DraftedPlayerSummary = {
  id: string;
  name: string;
  position: string;
  nflTeam: string | null;
};

// @spec DFF-UI-092
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

// @spec DFF-UI-022
function getDraftedPlayerSummary(draftState: DraftState, playerId: string): DraftedPlayerSummary {
  const player = draftState.playerCatalog[playerId];

  if (!player) {
    return {
      id: playerId,
      name: playerId,
      position: 'NA',
      nflTeam: null,
    };
  }

  return {
    id: player.id,
    name: player.name,
    position: player.position,
    nflTeam: player.nflTeam,
  };
}

// @spec DFF-UI-021
// @spec DFF-UI-022
// @spec DFF-UI-024
// @spec DFF-UI-024b
// @spec DFF-UI-025
function DraftBoardCell({
  draftState,
  pickNumber,
}: {
  draftState: DraftState;
  pickNumber: number;
}) {
  const slot = draftState.draftOrder.find((entry) => entry.pickNumber === pickNumber) ?? null;

  if (!slot) {
    return null;
  }

  const team = draftState.teams.find((entry) => entry.id === slot.teamId) ?? null;
  const pick = draftState.picks.find((entry) => entry.pickNumber === pickNumber) ?? null;
  const currentSlot = draftState.currentPickNumber
    ? draftState.draftOrder.find((entry) => entry.pickNumber === draftState.currentPickNumber) ?? null
    : null;
  const showBotSkeleton = !pick && currentSlot?.pickNumber === pickNumber && !team?.isUser;

  return (
    <td
      data-testid={`draft-slot-${pickNumber}`}
      data-round={slot.round}
      data-team-id={slot.teamId}
      className="min-w-[14rem] border border-stone-800 bg-stone-950/45 align-top"
    >
      <div className="flex min-h-[8.75rem] flex-col justify-between px-4 py-3">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.25em] text-stone-500">
          Pick {slot.round}.{String(slot.pickInRound).padStart(2, '0')}
        </p>

        {pick ? (
          (() => {
            const player = getDraftedPlayerSummary(draftState, pick.playerId);

            return (
              <div className="space-y-3">
                <div className="space-y-1">
                  <p className="text-base font-semibold leading-tight text-stone-50">{player.name}</p>
                  <p className="text-sm text-stone-400">{team?.name ?? slot.teamId}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={getPositionBadgeClass(player.position)}>
                    {player.position}
                  </span>
                  {player.nflTeam ? <span className="text-xs uppercase tracking-[0.25em] text-stone-500">{player.nflTeam}</span> : null}
                </div>
              </div>
            );
          })()
        ) : showBotSkeleton ? (
          <div data-testid="draft-slot-skeleton" className="space-y-3 animate-pulse">
            <div className="h-4 w-24 rounded-full bg-stone-700/80" />
            <div className="h-6 w-full rounded-2xl bg-stone-800/80" />
            <div className="h-3 w-20 rounded-full bg-stone-800/80" />
          </div>
        ) : (
          <div className="flex h-full items-end">
            <p className="text-sm text-stone-600">Waiting for selection</p>
          </div>
        )}
      </div>
    </td>
  );
}

// @spec DFF-UI-088
// @spec DFF-UI-089
const LAYOUT_KEY = 'draftBoardLayout';

// @spec DFF-UI-088
// @spec DFF-UI-089
type LayoutMode = 'row' | 'column';

// @spec DFF-UI-089
function getStoredLayout(): LayoutMode {
  const stored = typeof window !== 'undefined' ? localStorage.getItem(LAYOUT_KEY) : null;
  return stored === 'column' ? 'column' : 'row';
}

// @spec DFF-UI-089
function persistLayout(mode: LayoutMode): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LAYOUT_KEY, mode);
  }
}

// @spec DFF-UI-088
// @spec DFF-UI-089
// @spec DFF-UI-090
// @spec DFF-UI-091
// @spec DFF-UI-093
function ColumnModeDraftBoard({ draftState }: DraftBoardProps) {
  const rounds = Array.from(new Set(draftState.draftOrder.map((slot) => slot.round))).sort((left, right) => left - right);

  return (
    <div data-testid="draft-board-scroller" className="mt-8 max-h-[60vh] overflow-y-auto pb-2">
      <table className="min-w-full border-separate border-spacing-0" aria-label="Draft Board">
        <thead>
          <tr>
            <th className="sticky top-0 z-10 min-w-[12rem] border border-stone-800 bg-stone-950 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">
              Round
            </th>
            {draftState.teams.map((team) => (
              <th
                key={team.id}
                scope="col"
                className={`sticky top-0 z-10 min-w-[14rem] border border-stone-800 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.3em] ${
                  team.isUser ? 'bg-amber-300/10' : 'bg-stone-950'
                } text-stone-400`}
              >
                <div className="space-y-1">
                  <p className="text-sm font-semibold uppercase tracking-[0.25em] text-stone-200">{team.name}</p>
                  <p className="text-xs uppercase tracking-[0.2em] text-stone-500">
                    {team.isUser ? 'Your Team' : team.archetype?.replaceAll('_', ' ') ?? 'Bot'}
                  </p>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rounds.map((round) => (
            <tr
              key={round}
              data-testid={`draft-board-round-${round}`}
              className="bg-transparent"
            >
              <th
                scope="row"
                className="sticky left-0 z-10 min-w-[12rem] border border-stone-800 bg-stone-950 px-4 py-4 text-left"
              >
                <div className="space-y-1">
                  <p className="text-sm font-semibold uppercase tracking-[0.25em] text-stone-200">Round {round}</p>
                </div>
              </th>
              {draftState.teams.map((team) => {
                const slot =
                  draftState.draftOrder.find((entry) => entry.round === round && entry.teamId === team.id) ?? null;

                return slot ? (
                  <DraftBoardCell key={slot.pickNumber} draftState={draftState} pickNumber={slot.pickNumber} />
                ) : (
                  <td key={`${team.id}-${round}`} className="min-w-[14rem] border border-stone-800 bg-stone-950/45" />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// @spec DFF-UI-020
// @spec DFF-UI-021
// @spec DFF-UI-023
// @spec DFF-UI-024
// @spec DFF-UI-024b
// @spec DFF-UI-025
// @spec DFF-UI-026
// @spec DFF-UI-088
// @spec DFF-UI-089
// @spec DFF-UI-090
// @spec DFF-UI-091
// @spec DFF-UI-093
export function DraftBoard({ draftState, isInteractionBlocked = false }: DraftBoardProps) {
  const rounds = Array.from(new Set(draftState.draftOrder.map((slot) => slot.round))).sort((left, right) => left - right);
  const [layout, setLayout] = useState<LayoutMode>(getStoredLayout);

  function toggleLayout() {
    if (isInteractionBlocked) {
      return;
    }

    const nextLayout: LayoutMode = layout === 'row' ? 'column' : 'row';
    setLayout(nextLayout);
    persistLayout(nextLayout);
  }

  return (
    <section className="w-full rounded-[2rem] border border-stone-800 bg-stone-900/90 p-6 shadow-2xl shadow-black/20">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">
            Draft {draftState.draftId}
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-stone-50">Draft Board</h1>
          <p className="mt-3 text-sm text-stone-300">
            Pick {draftState.currentPickNumber ?? draftState.picks.length} of {draftState.draftOrder.length}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {draftState.sseStatus === 'connecting' ? (
            <span className="rounded-full border border-stone-700 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-stone-300">
              Connecting…
            </span>
          ) : null}
          <button
            type="button"
            data-testid="layout-toggle"
            onClick={toggleLayout}
            disabled={isInteractionBlocked}
            className="rounded-full border border-stone-700 p-2.5 text-sm text-stone-400 transition hover:border-stone-500 hover:text-stone-200 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={layout === 'row' ? 'Switch to column layout' : 'Switch to row layout'}
            title={layout === 'row' ? 'Column layout' : 'Row layout'}
          >
            {layout === 'row' ? (
              /* Columns icon (rows → icon shows columns to indicate what you'll get) */
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M12 3v18" />
              </svg>
            ) : (
              /* Rows icon */
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M3 12h18" />
              </svg>
            )}
          </button>
        <div className="rounded-full border border-stone-700 px-4 py-2 text-sm text-stone-200">
            {draftState.isHydrating
              ? 'Loading draft…'
              : draftState.currentPickNumber
              ? draftState.teams.find(
                  (team) =>
                    team.id ===
                    (draftState.draftOrder.find((slot) => slot.pickNumber === draftState.currentPickNumber)?.teamId ?? ''),
                )?.isUser
                ? 'Your turn'
                : 'Bot is picking…'
              : 'Draft complete'}
          </div>
        </div>
      </div>

      {layout === 'column' ? (
        <ColumnModeDraftBoard draftState={draftState} />
      ) : (
        <div data-testid="draft-board-scroller" className="mt-8 overflow-x-auto pb-2">
          <table className="min-w-full border-separate border-spacing-0" aria-label="Draft Board">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-[12rem] border border-stone-800 bg-stone-950 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">
                  Team
                </th>
                {rounds.map((round) => (
                  <th
                    key={round}
                    scope="col"
                    className="min-w-[14rem] border border-stone-800 bg-stone-950 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.3em] text-stone-400"
                  >
                    Round {round}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {draftState.teams.map((team) => (
                <tr
                  key={team.id}
                  data-testid={`draft-board-row-${team.id}`}
                  data-user-team={team.isUser ? 'true' : 'false'}
                  className={team.isUser ? 'bg-amber-300/8' : 'bg-transparent'}
                >
                  <th
                    scope="row"
                    className={`sticky left-0 z-10 min-w-[12rem] border border-stone-800 px-4 py-4 text-left ${
                      team.isUser ? 'bg-amber-300/10' : 'bg-stone-950'
                    }`}
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-semibold uppercase tracking-[0.25em] text-stone-200">{team.name}</p>
                      <p className="text-xs uppercase tracking-[0.2em] text-stone-500">
                        {team.isUser ? 'Your Team' : team.archetype?.replaceAll('_', ' ') ?? 'Bot'}
                      </p>
                    </div>
                  </th>
                  {rounds.map((round) => {
                    const slot =
                      draftState.draftOrder.find((entry) => entry.round === round && entry.teamId === team.id) ?? null;

                    return slot ? (
                      <DraftBoardCell key={slot.pickNumber} draftState={draftState} pickNumber={slot.pickNumber} />
                    ) : (
                      <td key={`${team.id}-${round}`} className="min-w-[14rem] border border-stone-800 bg-stone-950/45" />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
