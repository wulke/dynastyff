import type { DraftState } from '../context/DraftContext.js';

type TradeAsset = {
  type?: string;
  player_id?: string;
  playerId?: string;
  draft_order_id?: string;
  draftOrderId?: string;
  pick_number?: number;
  pickNumber?: number;
  year?: number;
  round?: number;
  pick_in_round?: number;
  pickInRound?: number;
  dynasty_value?: number;
  dynastyValue?: number;
};

type TradeAssetPresentation = {
  badge: string | null;
  label: string;
  value: string | null;
};

type TradeAssetPresentationOptions = {
  futurePickLabelStyle?: 'round' | 'abbreviated';
  playerLabelStyle?: 'full' | 'name-only';
};

function formatDynastyValue(value: number): string {
  return value.toLocaleString('en-US');
}

function getDraftOrderSlotByPickNumber(draftState: DraftState, pickNumber: number) {
  return draftState.draftOrder.find((slot) => slot.pickNumber === pickNumber) ?? null;
}

function getStartupPickValueByPickNumber(draftState: DraftState, pickNumber: number): number | null {
  return draftState.startupPickValues.find((entry) => entry.globalPickNumber === pickNumber)?.dynastyValue ?? null;
}

// @spec DFF-UI-051
// @spec DFF-UI-052
// @spec DFF-UI-064
// @spec DFF-SPKV-060
// @spec DFF-SPKV-061
export function getTradeAssetPresentation(
  asset: unknown,
  draftState: DraftState,
  options: TradeAssetPresentationOptions = {},
): TradeAssetPresentation {
  const futurePickLabelStyle = options.futurePickLabelStyle ?? 'round';
  const playerLabelStyle = options.playerLabelStyle ?? 'full';

  if (!asset || typeof asset !== 'object') {
    return { badge: null, label: 'Unknown asset', value: null };
  }

  const candidate = asset as TradeAsset;

  if (candidate.type === 'player') {
    const playerId = candidate.player_id ?? candidate.playerId;

    if (!playerId) return { badge: null, label: 'Unknown player', value: null };

    const player = draftState.playerCatalog[playerId];

    return {
      badge: null,
      label: player
        ? playerLabelStyle === 'name-only'
          ? player.name
          : `${player.name} (${player.position})`
        : playerId,
      value: null,
    };
  }

  if (candidate.type === 'pick_slot') {
    const pickNumber = candidate.pick_number ?? candidate.pickNumber ?? null;
    const slot = pickNumber !== null ? getDraftOrderSlotByPickNumber(draftState, pickNumber) : null;
    const round = candidate.round ?? slot?.round ?? '?';
    const pickInRound = candidate.pick_in_round ?? candidate.pickInRound ?? slot?.pickInRound ?? '?';
    const dynastyValue =
      candidate.dynasty_value ??
      candidate.dynastyValue ??
      (pickNumber !== null ? getStartupPickValueByPickNumber(draftState, pickNumber) ?? undefined : undefined);

    return {
      badge: 'STARTUP',
      label: `Startup ${round}.${String(pickInRound).padStart(2, '0')}`,
      value: typeof dynastyValue === 'number' ? formatDynastyValue(dynastyValue) : null,
    };
  }

  if (candidate.type === 'future_pick') {
    if (typeof candidate.year === 'number' && typeof candidate.round === 'number') {
      return {
        badge: 'PICK',
        label:
          futurePickLabelStyle === 'abbreviated'
            ? `${candidate.year} Rd ${candidate.round}`
            : `${candidate.year} Round ${candidate.round}`,
        value: null,
      };
    }

    return { badge: 'PICK', label: 'Future pick', value: null };
  }

  return { badge: null, label: JSON.stringify(asset), value: null };
}

// @spec DFF-UI-051
// @spec DFF-UI-052
// @spec DFF-UI-064
// @spec DFF-SPKV-060
// @spec DFF-SPKV-061
export function TradeAssetDisplay({
  asset,
  draftState,
  futurePickLabelStyle = 'round',
  playerLabelStyle = 'full',
}: {
  asset: unknown;
  draftState: DraftState;
  futurePickLabelStyle?: 'round' | 'abbreviated';
  playerLabelStyle?: 'full' | 'name-only';
}) {
  const presentation = getTradeAssetPresentation(asset, draftState, { futurePickLabelStyle, playerLabelStyle });

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {presentation.badge ? (
        <span className="rounded border border-default bg-surface px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-muted">
          {presentation.badge}
        </span>
      ) : null}
      <span className="text-secondary">{presentation.label}</span>
      {presentation.value ? (
        <span className="font-condensed tabular-nums text-muted">{presentation.value}</span>
      ) : null}
    </span>
  );
}
