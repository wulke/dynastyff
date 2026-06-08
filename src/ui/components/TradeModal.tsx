// @spec DFF-UI-050
// @spec DFF-UI-051
// @spec DFF-UI-052
// @spec DFF-UI-053
// @spec DFF-UI-054
// @spec DFF-UI-055
// @spec DFF-UI-056
// @spec DFF-UI-057
// @spec DFF-UI-058
// @spec DFF-UI-058f
// @spec DFF-UI-058g
// @spec DFF-UI-058h
// @spec DFF-UI-059
// @spec DFF-UI-059b
// @spec DFF-UI-059c
// @spec DFF-UI-059d
// @spec DFF-UI-059e
import * as Dialog from '@radix-ui/react-dialog';

import type { DraftState, TradeResponseStatus } from '../context/DraftContext.js';
import { TradeAssetDisplay, getTradeAssetPresentation } from './tradeAssetPresentation.js';

type PositionFilter = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE';

export type TradeComposerState = {
  targetTeamId: string;
  offeredAssets: unknown[];
  requestedAssets: unknown[];
  offeredFilter: PositionFilter;
  requestedFilter: PositionFilter;
  status: 'editing' | 'awaiting' | 'resolved';
  resultStatus: 'accepted' | 'declined' | null;
};

type TradeModalProps = {
  draftState: DraftState;
  isOpen: boolean;
  composer: TradeComposerState | null;
  onRespond: (status: TradeResponseStatus) => Promise<void>;
  onCounter: () => void;
  onComposerTargetChange: (teamId: string) => void;
  onComposerFilterChange: (side: 'offered' | 'requested', filter: PositionFilter) => void;
  onToggleComposerAsset: (side: 'offered' | 'requested', asset: unknown) => void;
  onSubmitComposer: () => Promise<void>;
  onCloseComposer: () => void;
};

type SelectableTradeAsset = {
  asset: unknown;
  label: string;
  position: string | null;
};

type TradeAsset = {
  type?: string;
  player_id?: string;
  playerId?: string;
};

const positionFilters: PositionFilter[] = ['ALL', 'QB', 'RB', 'WR', 'TE'];

// @spec DFF-UI-050
function getTeamName(draftState: DraftState, teamId: string): string {
  return draftState.teams.find((team) => team.id === teamId)?.name ?? teamId;
}

// @spec DFF-UI-051
// @spec DFF-UI-052
// @spec DFF-UI-058
// @spec DFF-UI-058h
// @spec DFF-SPKV-060
// @spec DFF-SPKV-061
function getTradeAssetLabel(asset: unknown, draftState: DraftState): string {
  return getTradeAssetPresentation(asset, draftState).label;
}

// @spec DFF-UI-058
function getTradeAssetPosition(asset: unknown, draftState: DraftState): string | null {
  if (!asset || typeof asset !== 'object') {
    return null;
  }

  const candidate = asset as TradeAsset;

  if (candidate.type !== 'player') {
    return null;
  }

  const playerId = candidate.player_id ?? candidate.playerId;
  return playerId ? draftState.playerCatalog[playerId]?.position ?? null : null;
}

// @spec DFF-UI-059
function areTradeAssetsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

// @spec DFF-UI-058
function buildSelectablePlayerAssets(draftState: DraftState, teamId: string): SelectableTradeAsset[] {
  return draftState.rosterPlayers
    .filter((entry) => entry.teamId === teamId)
    .map((entry) => ({
      asset: { type: 'player', player_id: entry.playerId },
      label: getTradeAssetLabel({ type: 'player', player_id: entry.playerId }, draftState),
      position: draftState.playerCatalog[entry.playerId]?.position ?? null,
    }));
}

// @spec DFF-UI-058
// @spec DFF-UI-058f
// @spec DFF-UI-058g
// @spec DFF-UI-058h
function buildSelectablePickAssets(draftState: DraftState, teamId: string): SelectableTradeAsset[] {
  const usedPickNumbers = new Set(draftState.picks.map((pick) => pick.pickNumber));

  const startupSlots = draftState.draftOrder
    .filter((slot) => slot.teamId === teamId && !usedPickNumbers.has(slot.pickNumber))
    .map((slot) => {
      const asset = {
        type: 'pick_slot',
        pick_number: slot.pickNumber,
        round: slot.round,
        pick_in_round: slot.pickInRound,
      };

      return {
        asset,
        label: getTradeAssetLabel(asset, draftState),
        position: null,
      };
    });

  const futurePicks = draftState.teamPickAssets
    .filter((entry) => entry.teamId === teamId)
    .map((entry) => ({
      asset: { type: 'future_pick', year: entry.year, round: entry.round },
      label: `${entry.year} Round ${entry.round}`,
      position: null,
    }));

  return [...startupSlots, ...futurePicks];
}

// @spec DFF-UI-058
function filterSelectableAssets(assets: SelectableTradeAsset[], filter: PositionFilter): SelectableTradeAsset[] {
  if (filter === 'ALL') {
    return assets;
  }

  return assets.filter((asset) => asset.position === filter);
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
              <TradeAssetDisplay asset={asset} draftState={draftState} />
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

// @spec DFF-UI-058
function PositionFilterPills({
  activeFilter,
  onChange,
}: {
  activeFilter: PositionFilter;
  onChange: (filter: PositionFilter) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {positionFilters.map((filter) => (
        <button
          key={filter}
          type="button"
          onClick={() => onChange(filter)}
          className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] ${
            filter === activeFilter
              ? 'border-amber-300 bg-amber-300 text-stone-950'
              : 'border-stone-700 text-stone-300'
          }`}
        >
          {filter}
        </button>
      ))}
    </div>
  );
}

// @spec DFF-UI-058
function SelectableAssetSection({
  title,
  playerAssets,
  pickAssets,
  selectedAssets,
  draftState,
  filter,
  onFilterChange,
  onToggleAsset,
}: {
  title: string;
  playerAssets: SelectableTradeAsset[];
  pickAssets: SelectableTradeAsset[];
  selectedAssets: unknown[];
  draftState: DraftState;
  filter: PositionFilter;
  onFilterChange: (filter: PositionFilter) => void;
  onToggleAsset: (asset: unknown) => void;
}) {
  const filteredPlayers = filterSelectableAssets(playerAssets, filter);

  return (
    <section>
      <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-stone-400">{title}</h3>
      <PositionFilterPills activeFilter={filter} onChange={onFilterChange} />

      <div className="mt-4 space-y-2">
        {filteredPlayers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-stone-700 px-3 py-3 text-sm text-stone-500">
            No players for this filter.
          </p>
        ) : (
          filteredPlayers.map((entry) => {
            const isSelected = selectedAssets.some((asset) => areTradeAssetsEqual(asset, entry.asset));

            return (
              <button
                key={entry.label}
                type="button"
                onClick={() => onToggleAsset(entry.asset)}
                className={`w-full rounded-xl border px-3 py-3 text-left text-sm ${
                  isSelected ? 'border-amber-300 bg-amber-300/10 text-stone-50' : 'border-stone-800 bg-stone-950/60 text-stone-200'
                }`}
              >
                <TradeAssetDisplay asset={entry.asset} draftState={draftState} />
              </button>
            );
          })
        )}
      </div>

      <div className="mt-4 space-y-2">
        {pickAssets.map((entry) => {
          const isSelected = selectedAssets.some((asset) => areTradeAssetsEqual(asset, entry.asset));

          return (
            <button
              key={entry.label}
              type="button"
              onClick={() => onToggleAsset(entry.asset)}
              className={`w-full rounded-xl border px-3 py-3 text-left text-sm ${
                isSelected ? 'border-amber-300 bg-amber-300/10 text-stone-50' : 'border-stone-800 bg-stone-950/60 text-stone-200'
              }`}
            >
              <TradeAssetDisplay asset={entry.asset} draftState={draftState} />
            </button>
          );
        })}
      </div>

      {selectedAssets.length > 0 ? (
        <div className="mt-4 space-y-2">
          {selectedAssets.map((asset, index) => (
            <div
              key={`${title}-selected-${index}`}
              className="rounded-xl border border-stone-800 bg-stone-950/60 px-3 py-3 text-sm text-stone-200"
            >
              <TradeAssetDisplay asset={asset} draftState={draftState} />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

// @spec DFF-UI-051
// @spec DFF-UI-052
// @spec DFF-UI-059d
function TradeModalActions({
  draftState,
  onRespond,
  onCounter,
}: {
  draftState: DraftState;
  onRespond: (status: TradeResponseStatus) => Promise<void>;
  onCounter: () => void;
}) {
  const pendingTrade = draftState.pendingTrade;

  if (!pendingTrade) {
    return null;
  }

  const userTeamId = draftState.teams.find((team) => team.isUser)?.id ?? null;
  const isUserInitiated = pendingTrade.initiatingTeamId === userTeamId;

  if (pendingTrade.isBotToBot) {
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

  if (isUserInitiated) {
    return (
      <div className="mt-8 rounded-2xl border border-stone-800 bg-stone-950/60 px-4 py-4 text-sm text-stone-200">
        Waiting for bot response.
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-wrap justify-end gap-3">
      <button
        type="button"
        onClick={onCounter}
        className="rounded-full border border-stone-700 px-4 py-2 text-sm font-semibold text-stone-100 transition hover:border-stone-500"
      >
        Counter
      </button>
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

// @spec DFF-UI-056
// @spec DFF-UI-057
// @spec DFF-UI-058
// @spec DFF-UI-059
// @spec DFF-UI-059b
// @spec DFF-UI-059c
// @spec DFF-UI-059f
function TradeComposerContent({
  draftState,
  composer,
  onComposerTargetChange,
  onComposerFilterChange,
  onToggleComposerAsset,
  onSubmitComposer,
  onCloseComposer,
}: {
  draftState: DraftState;
  composer: TradeComposerState;
  onComposerTargetChange: (teamId: string) => void;
  onComposerFilterChange: (side: 'offered' | 'requested', filter: PositionFilter) => void;
  onToggleComposerAsset: (side: 'offered' | 'requested', asset: unknown) => void;
  onSubmitComposer: () => Promise<void>;
  onCloseComposer: () => void;
}) {
  const userTeam = draftState.teams.find((team) => team.isUser) ?? null;
  const targetTeam = draftState.teams.find((team) => team.id === composer.targetTeamId) ?? null;
  const offeredPlayerAssets = userTeam ? buildSelectablePlayerAssets(draftState, userTeam.id) : [];
  const offeredPickAssets = userTeam ? buildSelectablePickAssets(draftState, userTeam.id) : [];
  const requestedPlayerAssets = targetTeam ? buildSelectablePlayerAssets(draftState, targetTeam.id) : [];
  const requestedPickAssets = targetTeam ? buildSelectablePickAssets(draftState, targetTeam.id) : [];

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">Trade Builder</p>
          <Dialog.Title className="mt-3 text-3xl font-semibold tracking-tight text-stone-50">
            Propose Trade
          </Dialog.Title>
          <Dialog.Description className="mt-3 text-sm leading-6 text-stone-300">
            Build a trade by selecting assets to offer and request, then wait for the bot to resolve the proposal.
          </Dialog.Description>
        </div>
        {composer.status === 'editing' ? (
          <button
            type="button"
            onClick={onCloseComposer}
            className="rounded-full border border-stone-700 px-4 py-2 text-sm font-semibold text-stone-100"
          >
            Cancel
          </button>
        ) : null}
        {composer.status === 'resolved' ? (
          <button
            type="button"
            onClick={onCloseComposer}
            className="rounded-full border border-stone-700 px-4 py-2 text-sm font-semibold text-stone-100"
          >
            Done
          </button>
        ) : null}
      </div>

      <label className="mt-6 flex flex-col gap-2 text-sm text-stone-300">
        Trade Partner
        <select
          aria-label="Trade Partner"
          value={composer.targetTeamId}
          disabled={composer.status !== 'editing'}
          onChange={(event) => onComposerTargetChange(event.target.value)}
          className="rounded-xl border border-stone-800 bg-stone-950/60 px-3 py-3 text-stone-100"
        >
          {draftState.teams
            .filter((team) => !team.isUser)
            .map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
        </select>
      </label>

      {composer.status === 'awaiting' ? (
        <div className="mt-6 rounded-2xl border border-stone-800 bg-stone-950/60 px-4 py-4 text-sm text-stone-200">
          Waiting for bot response.
        </div>
      ) : null}

      {composer.status === 'resolved' ? (
        <div className="mt-6 rounded-2xl border border-stone-800 bg-stone-950/60 px-4 py-4 text-sm text-stone-200">
          {composer.resultStatus === 'accepted' ? 'Trade accepted.' : 'Trade declined.'}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <SelectableAssetSection
          title={`${userTeam?.name ?? 'You'} offer`}
          playerAssets={offeredPlayerAssets}
          pickAssets={offeredPickAssets}
          selectedAssets={composer.offeredAssets}
          draftState={draftState}
          filter={composer.offeredFilter}
          onFilterChange={(filter) => onComposerFilterChange('offered', filter)}
          onToggleAsset={(asset) => onToggleComposerAsset('offered', asset)}
        />
        <SelectableAssetSection
          title={`${targetTeam?.name ?? 'Target'} offer`}
          playerAssets={requestedPlayerAssets}
          pickAssets={requestedPickAssets}
          selectedAssets={composer.requestedAssets}
          draftState={draftState}
          filter={composer.requestedFilter}
          onFilterChange={(filter) => onComposerFilterChange('requested', filter)}
          onToggleAsset={(asset) => onToggleComposerAsset('requested', asset)}
        />
      </div>

      {composer.status === 'editing' ? (
        <div className="mt-8 flex justify-end">
          <button
            type="button"
            onClick={() => void onSubmitComposer()}
            className="rounded-full bg-amber-300 px-4 py-2 text-sm font-semibold text-stone-950 transition hover:bg-amber-200"
          >
            Submit Proposal
          </button>
        </div>
      ) : null}
    </>
  );
}

// @spec DFF-UI-050
// @spec DFF-UI-051
// @spec DFF-UI-052
// @spec DFF-UI-053
// @spec DFF-UI-054
// @spec DFF-UI-055
// @spec DFF-UI-056
// @spec DFF-UI-057
// @spec DFF-UI-058
// @spec DFF-UI-059
// @spec DFF-UI-059b
// @spec DFF-UI-059c
// @spec DFF-UI-059d
// @spec DFF-UI-059e
// @spec DFF-UI-059f
export function TradeModal({
  draftState,
  isOpen,
  composer,
  onRespond,
  onCounter,
  onComposerTargetChange,
  onComposerFilterChange,
  onToggleComposerAsset,
  onSubmitComposer,
  onCloseComposer,
}: TradeModalProps) {
  const pendingTrade = draftState.pendingTrade;

  if (!composer && !pendingTrade) {
    return null;
  }

  const initiatingTeamName = pendingTrade ? getTeamName(draftState, pendingTrade.initiatingTeamId) : '';
  const receivingTeamName = pendingTrade ? getTeamName(draftState, pendingTrade.receivingTeamId) : '';

  return (
    <Dialog.Root open={isOpen}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="trade-modal-overlay"
          className="fixed inset-0 z-40 bg-stone-950/80 backdrop-blur-[2px]"
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(52rem,calc(100vw-2rem))] max-h-[90vh] overflow-y-auto -translate-x-1/2 -translate-y-1/2 rounded-[1.75rem] border border-stone-800 bg-stone-900 p-6 shadow-2xl shadow-black/50"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          {composer ? (
            <TradeComposerContent
              draftState={draftState}
              composer={composer}
              onComposerTargetChange={onComposerTargetChange}
              onComposerFilterChange={onComposerFilterChange}
              onToggleComposerAsset={onToggleComposerAsset}
              onSubmitComposer={onSubmitComposer}
              onCloseComposer={onCloseComposer}
            />
          ) : pendingTrade ? (
            <>
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

              <TradeModalActions draftState={draftState} onRespond={onRespond} onCounter={onCounter} />
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
