// @spec DFF-UI-100
// @spec DFF-UI-101
// @spec DFF-UI-102
// @spec DFF-UI-103
// @spec DFF-UI-104
import { useMemo } from 'react';
import type { DraftState } from '../context/DraftContext.js';

type PickFeedPanelProps = {
  draftState: DraftState;
};

// @spec DFF-UI-103
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

// @spec DFF-UI-103
// @spec DFF-UI-101
// @spec DFF-UI-102
export function PickFeedPanel({ draftState }: PickFeedPanelProps) {
  // @spec DFF-UI-101
  // Sort picks by pickNumber descending so most recent pick appears at the top
  const feedEntries = useMemo(
    () => [...draftState.picks].sort((left, right) => right.pickNumber - left.pickNumber),
    [draftState.picks],
  );

  // @spec DFF-UI-103
  function getTeamName(teamId: string): string {
    const team = draftState.teams.find((t) => t.id === teamId);
    return team?.name ?? teamId;
  }

  // @spec DFF-UI-103
  function getPlayerName(playerId: string): string {
    const player = draftState.playerCatalog[playerId];
    return player?.name ?? playerId;
  }

  // @spec DFF-UI-103
  function getPlayerPosition(playerId: string): string {
    const player = draftState.playerCatalog[playerId];
    return player?.position ?? 'NA';
  }

  // @spec DFF-UI-103
  function getPickSlot(pickNumber: number): { round: number; pickInRound: number } | null {
    const slot = draftState.draftOrder.find((s) => s.pickNumber === pickNumber);
    return slot ? { round: slot.round, pickInRound: slot.pickInRound } : null;
  }

  // @spec DFF-UI-100
  // @spec DFF-UI-101
  // @spec DFF-UI-102
  // @spec DFF-UI-103
  // @spec DFF-UI-104
  return (
    <section
      data-testid="pick-feed-panel"
      className="w-full rounded-[2rem] border border-stone-800 bg-stone-900/90 p-6 shadow-2xl shadow-black/20"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-stone-400">
          Pick Feed
        </h2>
        <span className="rounded-full border border-stone-700 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-stone-500">
          {feedEntries.length} pick{feedEntries.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* @spec DFF-UI-100: Fixed max height with independent scroll */}
      <div className="mt-4 max-h-[28rem] space-y-2 overflow-y-auto" data-testid="pick-feed-scroll-container">
        {feedEntries.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-stone-600">No picks yet</p>
          </div>
        ) : (
          feedEntries.map((pick) => {
            const playerName = getPlayerName(pick.playerId);
            const position = getPlayerPosition(pick.playerId);
            const teamName = getTeamName(pick.teamId);
            const pickSlot = getPickSlot(pick.pickNumber);

            return (
              <div
                key={pick.pickNumber}
                data-testid={`pick-feed-entry-${pick.pickNumber}`}
                className="flex items-center justify-between rounded-xl border border-stone-800 bg-stone-950/60 px-4 py-3 transition hover:border-stone-700"
              >
                <div className="flex items-center gap-3">
                  <p className="text-sm font-semibold text-stone-50">{playerName}</p>
                  <span className={getPositionBadgeClass(position)}>{position}</span>
                </div>
                <div className="flex items-center gap-3 text-right">
                  <p className="text-sm text-stone-400">{teamName}</p>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                    {pickSlot ? `Rd ${pickSlot.round}, Pick ${pickSlot.pickInRound}` : '—'}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
