// @spec DFF-UI-100
// @spec DFF-UI-101
// @spec DFF-UI-102
// @spec DFF-UI-103
// @spec DFF-UI-104
// @spec DFF-UI-144
// @spec DFF-UI-132
// @spec DFF-UI-165
import { useMemo, type ReactNode } from 'react';
import type { DraftState } from '../context/DraftContext.js';
import { getTradeAssetPresentation } from './tradeAssetPresentation.js';

type PickFeedPanelProps = {
  draftState: DraftState;
  headerAction?: ReactNode;
};

type DraftLogEntry =
  | { id: string; type: 'pick'; sortKey: string; pickNumber: number; playerId: string }
  | { id: string; type: 'trade'; sortKey: string; trade: DraftState['trades'][number] };

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

function getTeamName(draftState: DraftState, teamId: string): string {
  return draftState.teams.find((team) => team.id === teamId)?.name ?? teamId;
}

function summarizeTradeAssets(draftState: DraftState, assets: unknown[]): string {
  if (assets.length === 0) {
    return 'nothing';
  }

  return assets
    .map((asset) =>
      getTradeAssetPresentation(asset, draftState, {
        futurePickLabelStyle: 'abbreviated',
        playerLabelStyle: 'name-only',
      }).label,
    )
    .join(', ');
}

// @spec DFF-UI-165
function getTradeSummary(draftState: DraftState, trade: DraftState['trades'][number]): string {
  return `${getTeamName(draftState, trade.initiatingTeamId)} traded ${summarizeTradeAssets(draftState, trade.assetsSent)} to ${getTeamName(draftState, trade.receivingTeamId)} for ${summarizeTradeAssets(draftState, trade.assetsReceived)}`;
}

// @spec DFF-UI-165
function formatLogTimestamp(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}

// @spec DFF-UI-103
// @spec DFF-UI-101
// @spec DFF-UI-102
// @spec DFF-UI-144
// @spec DFF-UI-132
// @spec DFF-UI-165
export function PickFeedPanel({ draftState, headerAction = null }: PickFeedPanelProps) {
  // @spec DFF-UI-101
  const feedEntries = useMemo<DraftLogEntry[]>(
    () =>
      [
        ...draftState.picks.map((pick) => ({
          id: String(pick.pickNumber),
          type: 'pick' as const,
          sortKey: pick.pickedAt,
          pickNumber: pick.pickNumber,
          playerId: pick.playerId,
        })),
        ...draftState.trades.map((trade) => ({
          id: trade.id,
          type: 'trade' as const,
          sortKey: trade.createdAt,
          trade,
        })),
      ].sort((left, right) => right.sortKey.localeCompare(left.sortKey)),
    [draftState.picks, draftState.trades],
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
            {feedEntries.length} event{feedEntries.length !== 1 ? 's' : ''}
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
            {feedEntries.map((entry) =>
              entry.type === 'pick' ? (
                <li
                  key={entry.id}
                  data-testid={`pick-feed-entry-${entry.pickNumber}`}
                  className="rounded border border-default bg-app px-2 py-1.5 text-xs text-secondary"
                >
                  <p className="tabular-nums">{`${getPickLabel(draftState, entry.pickNumber)} — ${getPlayerName(draftState, entry.playerId)}`}</p>
                </li>
              ) : (
                <li
                  key={entry.id}
                  data-testid={`pick-feed-entry-${entry.trade.id}`}
                  className="rounded border border-default bg-app px-2 py-1.5 text-xs text-secondary"
                >
                  <p className="font-condensed tabular-nums text-muted">{formatLogTimestamp(entry.trade.createdAt)}</p>
                  <p>{getTradeSummary(draftState, entry.trade)}</p>
                </li>
              ),
            )}
          </ol>
        )}
      </div>
    </section>
  );
}
