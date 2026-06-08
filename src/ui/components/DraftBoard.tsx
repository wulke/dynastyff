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
// @spec DFF-UI-132
// @spec DFF-UI-139
// @spec DFF-UI-056
import { useState, type ReactNode } from 'react';
import type { DraftState } from '../context/DraftContext.js';
import { getPositionBadgeClass } from './positionBadge.js';

type DraftBoardProps = {
  draftState: DraftState;
  isInteractionBlocked?: boolean;
  headerAction?: ReactNode;
  onTeamHeaderClick?: (teamId: string) => void;
};

type DraftedPlayerSummary = {
  id: string;
  name: string;
  position: string;
  nflTeam: string | null;
};

// @spec DFF-UI-022
function getDraftedPlayerSummary(draftState: DraftState, playerId: string): DraftedPlayerSummary {
  const player = draftState.playerCatalog[playerId];

  if (!player) {
    return { id: playerId, name: playerId, position: 'NA', nflTeam: null };
  }

  return { id: player.id, name: player.name, position: player.position, nflTeam: player.nflTeam };
}

// @spec DFF-UI-021
// @spec DFF-UI-022
// @spec DFF-UI-024
// @spec DFF-UI-024b
// @spec DFF-UI-025
function DraftBoardCell({ draftState, pickNumber }: { draftState: DraftState; pickNumber: number }) {
  const slot = draftState.draftOrder.find((entry) => entry.pickNumber === pickNumber) ?? null;

  if (!slot) return null;

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
      className="min-w-[12rem] border border-default bg-app align-top"
    >
      <div className="flex min-h-[5.5rem] flex-col justify-between px-2 py-2">
        <p className="font-condensed text-[0.65rem] font-semibold uppercase tracking-wide text-muted tabular-nums">
          {slot.round}.{String(slot.pickInRound).padStart(2, '0')}
        </p>

        {pick ? (
          (() => {
            const player = getDraftedPlayerSummary(draftState, pick.playerId);
            return (
              <div className="space-y-1.5">
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold leading-tight text-primary">{player.name}</p>
                  <p className="text-xs text-muted">{team?.name ?? slot.teamId}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={getPositionBadgeClass(player.position)}>{player.position}</span>
                  {player.nflTeam ? (
                    <span className="text-[0.6rem] uppercase tracking-wide text-muted">{player.nflTeam}</span>
                  ) : null}
                </div>
              </div>
            );
          })()
        ) : showBotSkeleton ? (
          <div data-testid="draft-slot-skeleton" className="space-y-2 animate-pulse">
            <div className="h-3 w-20 rounded bg-surface-raised" />
            <div className="h-4 w-full rounded bg-surface-raised" />
            <div className="h-2.5 w-16 rounded bg-surface-raised" />
          </div>
        ) : (
          <div className="flex h-full items-end">
            <p className="text-xs text-muted">Waiting</p>
          </div>
        )}
      </div>
    </td>
  );
}

// @spec DFF-UI-088
// @spec DFF-UI-089
const LAYOUT_KEY = 'draftBoardLayout';
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

const thHeaderClass = 'sticky top-0 z-10 min-w-[12rem] border border-default bg-app px-3 py-2 text-left';
const thLabelClass = 'font-condensed text-[0.65rem] font-semibold uppercase tracking-widest text-muted';

function TeamHeaderContent({
  team,
  onTeamHeaderClick,
  isInteractionBlocked,
}: {
  team: DraftState['teams'][number];
  onTeamHeaderClick?: (teamId: string) => void;
  isInteractionBlocked?: boolean;
}) {
  const inner = (
    <div className="space-y-0.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-secondary">{team.name}</p>
      <p className="text-[0.6rem] uppercase tracking-wide text-muted">
        {team.isUser ? 'Your Team' : (team.archetype?.replaceAll('_', ' ') ?? 'Bot')}
      </p>
    </div>
  );

  if (!team.isUser && onTeamHeaderClick && !isInteractionBlocked) {
    return (
      <button type="button" onClick={() => onTeamHeaderClick(team.id)} className="w-full text-left">
        {inner}
      </button>
    );
  }

  return inner;
}

// @spec DFF-UI-088
// @spec DFF-UI-089
// @spec DFF-UI-090
// @spec DFF-UI-091
// @spec DFF-UI-093
// @spec DFF-UI-056
function ColumnModeDraftBoard({ draftState, onTeamHeaderClick, isInteractionBlocked }: DraftBoardProps) {
  const rounds = Array.from(new Set(draftState.draftOrder.map((slot) => slot.round))).sort((a, b) => a - b);

  return (
    <div data-testid="draft-board-scroller" className="mt-4 max-h-[60vh] overflow-y-auto">
      <table className="min-w-full border-separate border-spacing-0" aria-label="Draft Board">
        <thead>
          <tr>
            <th className={`${thHeaderClass} min-w-[8rem]`}>
              <span className={thLabelClass}>Round</span>
            </th>
            {draftState.teams.map((team) => (
              <th
                key={team.id}
                scope="col"
                className={`${thHeaderClass} ${team.isUser ? 'bg-accent/10' : ''}`}
              >
                <TeamHeaderContent team={team} onTeamHeaderClick={onTeamHeaderClick} isInteractionBlocked={isInteractionBlocked} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rounds.map((round) => (
            <tr key={round} data-testid={`draft-board-round-${round}`}>
              <th scope="row" className="sticky left-0 z-10 min-w-[8rem] border border-default bg-app px-3 py-2 text-left">
                <p className="font-condensed text-xs font-semibold text-secondary tabular-nums">Rd {round}</p>
              </th>
              {draftState.teams.map((team) => {
                const slot = draftState.draftOrder.find((entry) => entry.round === round && entry.teamId === team.id) ?? null;
                return slot ? (
                  <DraftBoardCell key={slot.pickNumber} draftState={draftState} pickNumber={slot.pickNumber} />
                ) : (
                  <td key={`${team.id}-${round}`} className="min-w-[12rem] border border-default bg-app" />
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
// @spec DFF-UI-139
// @spec DFF-UI-132
// @spec DFF-UI-056
export function DraftBoard({
  draftState,
  isInteractionBlocked = false,
  headerAction = null,
  onTeamHeaderClick,
}: DraftBoardProps) {
  const rounds = Array.from(new Set(draftState.draftOrder.map((slot) => slot.round))).sort((a, b) => a - b);
  const [layout, setLayout] = useState<LayoutMode>(getStoredLayout);

  function toggleLayout() {
    if (isInteractionBlocked) return;
    const next: LayoutMode = layout === 'row' ? 'column' : 'row';
    setLayout(next);
    persistLayout(next);
  }

  return (
    <section className="w-full rounded-md border border-default bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-default px-3 py-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">
            Draft {draftState.draftId}
          </p>
          <h1 className="font-condensed text-xl font-bold tracking-tight text-primary">Draft Board</h1>
          <p className="text-xs text-muted">Live board for every round, team, and completed pick.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {draftState.sseStatus === 'connecting' ? (
            <span className="rounded border border-default px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-muted">
              Connecting…
            </span>
          ) : null}
          {headerAction}
          <button
            type="button"
            data-testid="layout-toggle"
            onClick={toggleLayout}
            disabled={isInteractionBlocked}
            className="rounded border border-default p-1.5 text-muted transition hover:border-strong hover:text-secondary disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={layout === 'row' ? 'Switch to column layout' : 'Switch to row layout'}
            title={layout === 'row' ? 'Column layout' : 'Row layout'}
          >
            {layout === 'row' ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M12 3v18" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M3 12h18" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {layout === 'column' ? (
        <div className="px-3 pb-3">
          <ColumnModeDraftBoard
            draftState={draftState}
            isInteractionBlocked={isInteractionBlocked}
            onTeamHeaderClick={isInteractionBlocked ? undefined : onTeamHeaderClick}
          />
        </div>
      ) : (
        <div data-testid="draft-board-scroller" className="mt-0 overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0" aria-label="Draft Board">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-[10rem] border border-default bg-app px-3 py-2 text-left">
                  <span className={thLabelClass}>Team</span>
                </th>
                {rounds.map((round) => (
                  <th key={round} scope="col" className="min-w-[12rem] border border-default bg-app px-3 py-2 text-left">
                    <span className={`${thLabelClass} tabular-nums`}>Round {round}</span>
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
                >
                  <th
                    scope="row"
                    className={`sticky left-0 z-10 min-w-[10rem] border border-default px-3 py-2 text-left ${
                      team.isUser ? 'bg-accent/10' : 'bg-app'
                    }`}
                  >
                    <TeamHeaderContent
                      team={team}
                      onTeamHeaderClick={onTeamHeaderClick}
                      isInteractionBlocked={isInteractionBlocked}
                    />
                  </th>
                  {rounds.map((round) => {
                    const slot = draftState.draftOrder.find((entry) => entry.round === round && entry.teamId === team.id) ?? null;
                    return slot ? (
                      <DraftBoardCell key={slot.pickNumber} draftState={draftState} pickNumber={slot.pickNumber} />
                    ) : (
                      <td key={`${team.id}-${round}`} className="min-w-[12rem] border border-default bg-app" />
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
