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
import { computeDerivedPickValues } from '../utils/draftUtils.js';
import { TradeBalanceSummary } from './TradeBalanceSummary.js';
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
  if (!asset || typeof asset !== 'object') return null;

  const candidate = asset as TradeAsset;

  if (candidate.type !== 'player') return null;

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
      const asset = { type: 'pick_slot', pick_number: slot.pickNumber, round: slot.round, pick_in_round: slot.pickInRound };
      return { asset, label: getTradeAssetLabel(asset, draftState), position: null };
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
  if (filter === 'ALL') return assets;
  return assets.filter((asset) => asset.position === filter);
}

// @spec DFF-UI-051
// @spec DFF-UI-052
// @spec DFF-UI-171
function TradeAssetList({
  title,
  assets,
  draftState,
  derivedPickValues,
}: {
  title: string;
  assets: unknown[];
  draftState: DraftState;
  derivedPickValues: Map<number, number>;
}) {
  return (
    <section>
      <h3 className="font-condensed text-xs font-semibold uppercase tracking-widest text-muted">{title}</h3>
      <ul className="mt-2 space-y-1">
        {assets.length === 0 ? (
          <li className="rounded border border-dashed border-default px-2 py-2 text-xs text-muted">No assets</li>
        ) : (
          assets.map((asset, index) => (
            <li
              key={`${title}-${index}`}
              className="rounded border border-default bg-app px-2 py-2 text-xs text-secondary"
            >
              <TradeAssetDisplay asset={asset} draftState={draftState} derivedPickValues={derivedPickValues} />
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

// @spec DFF-UI-058
function PositionFilterPills({ activeFilter, onChange }: { activeFilter: PositionFilter; onChange: (filter: PositionFilter) => void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {positionFilters.map((filter) => (
        <button
          key={filter}
          type="button"
          onClick={() => onChange(filter)}
          className={`rounded border px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide transition ${
            filter === activeFilter
              ? 'border-accent bg-accent text-accent-fg'
              : 'border-default text-muted hover:border-strong hover:text-secondary'
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
  const derivedPickValues = computeDerivedPickValues(draftState);

  return (
    <section>
      <h3 className="font-condensed text-xs font-semibold uppercase tracking-widest text-muted">{title}</h3>
      <PositionFilterPills activeFilter={filter} onChange={onFilterChange} />

      <div className="mt-3 space-y-1">
        {filteredPlayers.length === 0 ? (
          <p className="rounded border border-dashed border-default px-2 py-2 text-xs text-muted">
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
                className={`w-full rounded border px-2 py-2 text-left text-xs transition ${
                  isSelected
                    ? 'border-accent/30 bg-accent/10 text-primary'
                    : 'border-default bg-app text-secondary hover:border-strong hover:bg-surface-hover'
                }`}
              >
                <TradeAssetDisplay asset={entry.asset} draftState={draftState} derivedPickValues={derivedPickValues} />
              </button>
            );
          })
        )}
      </div>

      <div className="mt-1 space-y-1">
        {pickAssets.map((entry) => {
          const isSelected = selectedAssets.some((asset) => areTradeAssetsEqual(asset, entry.asset));
          return (
            <button
              key={entry.label}
              type="button"
              onClick={() => onToggleAsset(entry.asset)}
              className={`w-full rounded border px-2 py-2 text-left text-xs transition ${
                isSelected
                  ? 'border-accent/30 bg-accent/10 text-primary'
                  : 'border-default bg-app text-secondary hover:border-strong hover:bg-surface-hover'
              }`}
            >
              <TradeAssetDisplay asset={entry.asset} draftState={draftState} derivedPickValues={derivedPickValues} />
            </button>
          );
        })}
      </div>

      {selectedAssets.length > 0 ? (
        <div className="mt-1 space-y-1">
          {selectedAssets.map((asset, index) => (
            <div
              key={`${title}-selected-${index}`}
              className="rounded border border-default bg-app px-2 py-2 text-xs text-secondary"
            >
              <TradeAssetDisplay asset={asset} draftState={draftState} derivedPickValues={derivedPickValues} />
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
function TradeModalActions({ draftState, onRespond, onCounter }: { draftState: DraftState; onRespond: (status: TradeResponseStatus) => Promise<void>; onCounter: () => void }) {
  const pendingTrade = draftState.pendingTrade;

  if (!pendingTrade) return null;

  const userTeamId = draftState.teams.find((team) => team.isUser)?.id ?? null;
  const isUserInitiated = pendingTrade.initiatingTeamId === userTeamId;

  if (pendingTrade.isBotToBot) {
    return (
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => void onRespond('force_declined')}
          className="rounded border border-default px-3 py-1.5 text-xs font-semibold text-secondary transition hover:border-strong hover:text-primary"
        >
          Force Decline
        </button>
        <button
          type="button"
          onClick={() => void onRespond('accepted')}
          className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition hover:bg-accent-hover"
        >
          OK
        </button>
      </div>
    );
  }

  if (isUserInitiated) {
    return (
      <div className="mt-4 rounded border border-default bg-app px-3 py-3 text-xs text-muted">
        Waiting for bot response.
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-wrap justify-end gap-2">
      <button
        type="button"
        onClick={onCounter}
        className="rounded border border-default px-3 py-1.5 text-xs font-semibold text-secondary transition hover:border-strong hover:text-primary"
      >
        Counter
      </button>
      <button
        type="button"
        onClick={() => void onRespond('declined')}
        className="rounded border border-default px-3 py-1.5 text-xs font-semibold text-secondary transition hover:border-strong hover:text-primary"
      >
        Decline
      </button>
      <button
        type="button"
        onClick={() => void onRespond('accepted')}
        className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition hover:bg-accent-hover"
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
      <div className="flex items-start justify-between gap-3 border-b border-default px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">Trade Builder</p>
          <Dialog.Title className="font-condensed text-xl font-bold text-primary">Propose Trade</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-muted">
            Select assets to offer and request, then submit for bot review.
          </Dialog.Description>
        </div>
        {(composer.status === 'editing' || composer.status === 'resolved') ? (
          <button
            type="button"
            onClick={onCloseComposer}
            className="rounded border border-default px-3 py-1.5 text-xs font-semibold text-secondary transition hover:border-strong hover:text-primary"
          >
            {composer.status === 'resolved' ? 'Done' : 'Cancel'}
          </button>
        ) : null}
      </div>

      <div className="p-4">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Trade Partner
          <select
            aria-label="Trade Partner"
            value={composer.targetTeamId}
            disabled={composer.status !== 'editing'}
            onChange={(event) => onComposerTargetChange(event.target.value)}
            className="rounded border border-strong bg-app px-2 py-1.5 text-xs text-primary outline-none"
          >
            {draftState.teams
              .filter((team) => !team.isUser)
              .map((team) => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
          </select>
        </label>

        {composer.status === 'awaiting' ? (
          <div className="mt-3 rounded border border-default bg-app px-3 py-3 text-xs text-muted">
            Waiting for bot response.
          </div>
        ) : null}

        {composer.status === 'resolved' ? (
          <div className={`mt-3 rounded border px-3 py-3 text-xs font-semibold ${
            composer.resultStatus === 'accepted'
              ? 'border-positive/30 bg-positive/10 text-positive'
              : 'border-negative/30 bg-negative/10 text-negative'
          }`}>
            {composer.resultStatus === 'accepted' ? 'Trade accepted.' : 'Trade declined.'}
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
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

        <TradeBalanceSummary
          assetsSent={composer.offeredAssets}
          assetsReceived={composer.requestedAssets}
          draftState={draftState}
        />

        {composer.status === 'editing' ? (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => void onSubmitComposer()}
              className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition hover:bg-accent-hover"
            >
              Submit Proposal
            </button>
          </div>
        ) : null}
      </div>
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
  const derivedPickValues = computeDerivedPickValues(draftState);

  if (!composer && !pendingTrade) return null;

  const initiatingTeamName = pendingTrade ? getTeamName(draftState, pendingTrade.initiatingTeamId) : '';
  const receivingTeamName = pendingTrade ? getTeamName(draftState, pendingTrade.receivingTeamId) : '';

  return (
    <Dialog.Root open={isOpen}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="trade-modal-overlay"
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(52rem,calc(100vw-2rem))] max-h-[90vh] overflow-y-auto -translate-x-1/2 -translate-y-1/2 rounded-lg border border-strong bg-surface-raised shadow-lg"
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
              <div className="flex items-start justify-between gap-3 border-b border-default px-4 py-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-accent">Trade Pending</p>
                  <Dialog.Title className="font-condensed text-xl font-bold text-primary">
                    {pendingTrade.isBotToBot ? 'Bot Trade Review' : 'Trade Offer'}
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-xs text-muted">
                    {initiatingTeamName} and {receivingTeamName} have a pending trade. Review before the draft continues.
                  </Dialog.Description>
                </div>
                <span className="rounded border border-default px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-muted">
                  {pendingTrade.isBotToBot ? 'Bot to Bot' : 'Your Response Required'}
                </span>
              </div>

              <div className="p-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <TradeAssetList
                    title={`${initiatingTeamName} sends`}
                    assets={pendingTrade.assetsSent}
                    draftState={draftState}
                    derivedPickValues={derivedPickValues}
                  />
                  <TradeAssetList
                    title={`${receivingTeamName} sends`}
                    assets={pendingTrade.assetsReceived}
                    draftState={draftState}
                    derivedPickValues={derivedPickValues}
                  />
                </div>
                <TradeBalanceSummary
                  assetsSent={pendingTrade.assetsSent}
                  assetsReceived={pendingTrade.assetsReceived}
                  draftState={draftState}
                />
                <TradeModalActions draftState={draftState} onRespond={onRespond} onCounter={onCounter} />
              </div>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
