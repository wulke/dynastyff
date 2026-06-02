// @spec DFF-UI-050
// @spec DFF-UI-051
// @spec DFF-UI-052
// @spec DFF-UI-053
// @spec DFF-UI-054
// @spec DFF-UI-055
import * as Dialog from '@radix-ui/react-dialog';

import type { DraftState, TradeResponseStatus } from '../context/DraftContext.js';

type TradeModalProps = {
  draftState: DraftState;
  isOpen: boolean;
  onRespond: (status: TradeResponseStatus) => Promise<void>;
};

type TradeAsset = {
  type?: string;
  player_id?: string;
  playerId?: string;
  year?: number;
  round?: number;
  pick_in_round?: number;
  pickInRound?: number;
  dynasty_value?: number;
  dynastyValue?: number;
};

// @spec DFF-UI-050
function getTeamName(draftState: DraftState, teamId: string): string {
  return draftState.teams.find((team) => team.id === teamId)?.name ?? teamId;
}

// @spec DFF-UI-051
// @spec DFF-UI-052
function getTradeAssetLabel(asset: unknown, draftState: DraftState): string {
  if (!asset || typeof asset !== 'object') {
    return 'Unknown asset';
  }

  const candidate = asset as TradeAsset;

  if (candidate.type === 'player') {
    const playerId = candidate.player_id ?? candidate.playerId;

    if (!playerId) {
      return 'Unknown player';
    }

    const player = draftState.playerCatalog[playerId];
    return player ? `${player.name} (${player.position})` : playerId;
  }

  if (candidate.type === 'pick_slot') {
    const round = candidate.round ?? 0;
    const pickInRound = candidate.pick_in_round ?? candidate.pickInRound ?? 0;
    const value = candidate.dynasty_value ?? candidate.dynastyValue;
    const baseLabel = `Startup ${round}.${String(pickInRound).padStart(2, '0')}`;
    return typeof value === 'number' ? `${baseLabel} (${value})` : baseLabel;
  }

  if (candidate.type === 'future_pick') {
    if (typeof candidate.year === 'number' && typeof candidate.round === 'number') {
      return `${candidate.year} Round ${candidate.round}`;
    }

    return 'Future pick';
  }

  return JSON.stringify(asset);
}

// @spec DFF-UI-051
// @spec DFF-UI-052
function TradeAssetList({
  title,
  assets,
  draftState,
}: {
  title: string;
  assets: unknown[];
  draftState: DraftState;
}) {
  return (
    <section>
      <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-stone-400">{title}</h3>
      <ul className="mt-3 space-y-2">
        {assets.length === 0 ? (
          <li className="rounded-xl border border-dashed border-stone-700 px-3 py-3 text-sm text-stone-500">No assets</li>
        ) : (
          assets.map((asset, index) => (
            <li
              key={`${title}-${index}`}
              className="rounded-xl border border-stone-800 bg-stone-950/60 px-3 py-3 text-sm text-stone-200"
            >
              {getTradeAssetLabel(asset, draftState)}
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

// @spec DFF-UI-051
// @spec DFF-UI-052
function TradeModalActions({
  isBotToBot,
  onRespond,
}: {
  isBotToBot: boolean;
  onRespond: (status: TradeResponseStatus) => Promise<void>;
}) {
  if (isBotToBot) {
    return (
      <div className="mt-8 flex flex-wrap justify-end gap-3">
        <button
          type="button"
          onClick={() => void onRespond('force_declined')}
          className="rounded-full border border-stone-700 px-4 py-2 text-sm font-semibold text-stone-100 transition hover:border-stone-500"
        >
          Force Decline
        </button>
        <button
          type="button"
          onClick={() => void onRespond('accepted')}
          className="rounded-full bg-amber-300 px-4 py-2 text-sm font-semibold text-stone-950 transition hover:bg-amber-200"
        >
          OK
        </button>
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-wrap justify-end gap-3">
      <button
        type="button"
        onClick={() => void onRespond('declined')}
        className="rounded-full border border-stone-700 px-4 py-2 text-sm font-semibold text-stone-100 transition hover:border-stone-500"
      >
        Decline
      </button>
      <button
        type="button"
        onClick={() => void onRespond('accepted')}
        className="rounded-full bg-amber-300 px-4 py-2 text-sm font-semibold text-stone-950 transition hover:bg-amber-200"
      >
        Accept
      </button>
    </div>
  );
}

// @spec DFF-UI-050
// @spec DFF-UI-051
// @spec DFF-UI-052
// @spec DFF-UI-053
// @spec DFF-UI-054
// @spec DFF-UI-055
export function TradeModal({ draftState, isOpen, onRespond }: TradeModalProps) {
  const pendingTrade = draftState.pendingTrade;

  if (!pendingTrade) {
    return null;
  }

  const initiatingTeamName = getTeamName(draftState, pendingTrade.initiatingTeamId);
  const receivingTeamName = getTeamName(draftState, pendingTrade.receivingTeamId);

  return (
    <Dialog.Root open={isOpen}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="trade-modal-overlay"
          className="fixed inset-0 z-40 bg-stone-950/80 backdrop-blur-[2px]"
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[1.75rem] border border-stone-800 bg-stone-900 p-6 shadow-2xl shadow-black/50"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">Trade Pending</p>
              <Dialog.Title className="mt-3 text-3xl font-semibold tracking-tight text-stone-50">
                {pendingTrade.isBotToBot ? 'Bot Trade Review' : 'Trade Offer'}
              </Dialog.Title>
              <Dialog.Description className="mt-3 text-sm leading-6 text-stone-300">
                {initiatingTeamName} and {receivingTeamName} have a pending trade. Review the assets below before the
                draft continues.
              </Dialog.Description>
            </div>
            <div className="rounded-full border border-stone-700 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.25em] text-stone-300">
              {pendingTrade.isBotToBot ? 'Bot to Bot' : 'Your Response Required'}
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <TradeAssetList title={`${initiatingTeamName} sends`} assets={pendingTrade.assetsSent} draftState={draftState} />
            <TradeAssetList
              title={`${receivingTeamName} sends`}
              assets={pendingTrade.assetsReceived}
              draftState={draftState}
            />
          </div>

          <TradeModalActions isBotToBot={pendingTrade.isBotToBot} onRespond={onRespond} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
