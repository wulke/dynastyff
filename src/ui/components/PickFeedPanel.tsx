// @spec DFF-UI-100
// @spec DFF-UI-101
// @spec DFF-UI-102
// @spec DFF-UI-103
// @spec DFF-UI-104
// @spec DFF-UI-144
import { useMemo } from 'react';
import type { DraftState } from '../context/DraftContext.js';

type PickFeedPanelProps = {
  draftState: DraftState;
};

// @spec DFF-UI-103
function getPlayerName(draftState: DraftState, playerId: string): string {
  const player = draftState.playerCatalog[playerId];
  return player?.name ?? playerId;
}

// @spec DFF-UI-103
function getPickLabel(draftState: DraftState, pickNumber: number): string {
  const slot = draftState.draftOrder.find((entry) => entry.pickNumber === pickNumber) ?? null;

  if (!slot) {
    return '—';
  }

  return `${slot.round}.${slot.pickInRound}`;
}

// @spec DFF-UI-103
// @spec DFF-UI-101
// @spec DFF-UI-102
// @spec DFF-UI-144
export function PickFeedPanel({ draftState }: PickFeedPanelProps) {
  // @spec DFF-UI-101
  const feedEntries = useMemo(
    () => [...draftState.picks].sort((left, right) => right.pickNumber - left.pickNumber),
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
      className="flex h-full w-full min-h-0 flex-col rounded-[1.75rem] border border-stone-800 bg-stone-900/90 p-4 shadow-2xl shadow-black/20"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-stone-400">Pick Feed</h2>
        <span className="text-xs font-semibold uppercase tracking-[0.25em] text-stone-500">
          {feedEntries.length} pick{feedEntries.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto" data-testid="pick-feed-scroll-container">
        {feedEntries.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-stone-600">No picks yet</p>
          </div>
        ) : (
          <ol className="space-y-1.5">
            {feedEntries.map((pick) => (
              <li
                key={pick.pickNumber}
                data-testid={`pick-feed-entry-${pick.pickNumber}`}
                className="rounded-lg border border-stone-800/80 bg-stone-950/40 px-3 py-2 text-sm text-stone-200"
              >
                <p>{`${getPickLabel(draftState, pick.pickNumber)} - ${getPlayerName(draftState, pick.playerId)}`}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
