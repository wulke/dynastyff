import type { DraftState } from '../context/DraftContext.js';
import { getTradeAssetDynastyValue } from './tradeAssetPresentation.js';

type TradeBalanceSummaryProps = {
  assetsSent: unknown[];
  assetsReceived: unknown[];
  draftState: DraftState;
  derivedPickValues: Map<number, number>;
};

function formatDynastyValue(value: number): string {
  return value.toLocaleString('en-US');
}

// @spec DFF-UI-175
function sumTradeAssets(assets: unknown[], draftState: DraftState, derivedPickValues: Map<number, number>): number {
  return assets.reduce((total, asset) => total + (getTradeAssetDynastyValue(asset, draftState, { derivedPickValues }) ?? 0), 0);
}

// @spec DFF-UI-173
function getNetDeltaClassName(netDelta: number): string {
  if (netDelta > 0) {
    return 'text-positive';
  }

  if (netDelta < 0) {
    return 'text-negative';
  }

  return 'text-muted';
}

// @spec DFF-UI-172
// @spec DFF-UI-173
// @spec DFF-UI-174
// @spec DFF-UI-175
export function TradeBalanceSummary({
  assetsSent,
  assetsReceived,
  draftState,
  derivedPickValues,
}: TradeBalanceSummaryProps) {
  const sentTotal = sumTradeAssets(assetsSent, draftState, derivedPickValues);
  const receivedTotal = sumTradeAssets(assetsReceived, draftState, derivedPickValues);
  const netDelta = receivedTotal - sentTotal;

  return (
    <section
      aria-label="Trade balance summary"
      className="mt-4 rounded-md border border-default bg-app px-3 py-2"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">Sent</p>
          <p className="font-condensed text-lg font-bold tabular-nums text-primary">{formatDynastyValue(sentTotal)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">Received</p>
          <p className="font-condensed text-lg font-bold tabular-nums text-primary">{formatDynastyValue(receivedTotal)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">Net</p>
          <p className={`font-condensed text-lg font-bold tabular-nums ${getNetDeltaClassName(netDelta)}`}>
            {formatDynastyValue(netDelta)}
          </p>
        </div>
      </div>
    </section>
  );
}
