// @spec DFF-UI-100
// @spec DFF-UI-101
// @spec DFF-UI-102
// @spec DFF-UI-103
// @spec DFF-UI-104
// @spec DFF-UI-144
// @spec DFF-UI-132
import { useMemo, type ReactNode } from 'react';
import type { DraftState } from '../context/DraftContext.js';

type PickFeedPanelProps = {
  draftState: DraftState;
  headerAction?: ReactNode;
};

// @spec DFF-UI-103
function getPlayerName(draftState: DraftState, playerId: string): string {
  return draftState.playerCatalog[playerId]?.name ?? playerId;
}

// @spec DFF-UI-103
function getPickLabel(draftState: DraftState, pickNumber: number): string {
  const slot = draftState.draftOrder.find((entry) => entry.pickNumber === pickNumber) ?? null;
  if (!slot) return '—';
  return `${slot.round}.${slot.pickInRound}`;
}

// @spec DFF-UI-103
// @spec DFF-UI-101
// @spec DFF-UI-102
// @spec DFF-UI-144
// @spec DFF-UI-132
export function PickFeedPanel({ draftState, headerAction = null }: PickFeedPanelProps) {
  // @spec DFF-UI-101
  const feedEntries = useMemo(
    () => [...draftState.picks].sort((a, b) => b.pickNumber - a.pickNumber),
    [draftState.picks],
  );

  // @spec DFF-UI-100
  // @spec DFF-UI-101
  // @spec DFF-UI-102
  // @spec DFF-UI-103
  // @spec DFF-UI-104
  // @spec DFF-UI-144
  return (
    <section
      data-testid="pick-feed-panel"
      className="flex h-full w-full min-h-0 flex-col rounded-md border border-default bg-surface"
    >
      <div className="flex items-center justify-between gap-2 border-b border-default px-3 py-2">
        <h2 className="font-condensed text-xs font-semibold uppercase tracking-widest text-muted">Pick Feed</h2>
        <div className="flex items-center gap-2">
          <span className="font-condensed text-[0.6rem] font-semibold uppercase tracking-widest text-muted tabular-nums">
            {feedEntries.length} pick{feedEntries.length !== 1 ? 's' : ''}
          </span>
          {headerAction}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2" data-testid="pick-feed-scroll-container">
        {feedEntries.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-xs text-muted">No picks yet</p>
          </div>
        ) : (
          <ol className="space-y-1">
            {feedEntries.map((pick) => (
              <li
                key={pick.pickNumber}
                data-testid={`pick-feed-entry-${pick.pickNumber}`}
                className="rounded border border-default bg-app px-2 py-1.5 text-xs text-secondary"
              >
                <p className="tabular-nums">{`${getPickLabel(draftState, pick.pickNumber)} — ${getPlayerName(draftState, pick.playerId)}`}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
