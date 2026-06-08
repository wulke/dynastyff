// @spec DFF-UI-060
// @spec DFF-UI-061
// @spec DFF-UI-062
// @spec DFF-UI-063
// @spec DFF-UI-064
// @spec DFF-UI-065
import { useState, useMemo } from 'react';
import type { DraftState, TradeRecord } from '../context/DraftContext.js';
import { TradeAssetDisplay } from './tradeAssetPresentation.js';

type HistoryViewProps = {
  draftState: DraftState;
  onNewDraft: () => void;
};

type TabId = 'pick-log' | 'roster-view' | 'trade-log';

type TabConfig = {
  id: TabId;
  label: string;
};

// @spec DFF-UI-060
const TABS: TabConfig[] = [
  { id: 'pick-log', label: 'Pick Log' },
  { id: 'roster-view', label: 'Roster View' },
  { id: 'trade-log', label: 'Trade Log' },
];

// @spec DFF-UI-062
const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE'] as const;
type Position = (typeof POSITION_ORDER)[number];

// @spec DFF-UI-061
// @spec DFF-UI-062
function formatDynastyValue(value: number): string {
  return value.toLocaleString('en-US');
}

// @spec DFF-UI-061
// @spec DFF-UI-062
function getDynastyValueForPlayer(
  draftState: DraftState,
  playerId: string,
): number {
  const player = draftState.playerCatalog[playerId];
  return player?.dynastyValue ?? 0;
}

// @spec DFF-UI-061
// @spec DFF-UI-062
function getPlayerName(draftState: DraftState, playerId: string): string {
  const player = draftState.playerCatalog[playerId];
  return player?.name ?? playerId;
}

// @spec DFF-UI-061
// @spec DFF-UI-062
function getPlayerPosition(draftState: DraftState, playerId: string): string {
  const player = draftState.playerCatalog[playerId];
  return player?.position ?? 'NA';
}

// @spec DFF-UI-061
function getPickRound(draftState: DraftState, pickNumber: number): number {
  const slot = draftState.draftOrder.find((s) => s.pickNumber === pickNumber);
  return slot?.round ?? 0;
}

// @spec DFF-UI-061
function getPickInRound(draftState: DraftState, pickNumber: number): number {
  const slot = draftState.draftOrder.find((s) => s.pickNumber === pickNumber);
  return slot?.pickInRound ?? 0;
}

// @spec DFF-UI-061
function getTeamName(draftState: DraftState, teamId: string): string {
  const team = draftState.teams.find((t) => t.id === teamId);
  return team?.name ?? teamId;
}

// @spec DFF-UI-062
function getPickNumberForPlayer(draftState: DraftState, playerId: string): number {
  const pick = draftState.picks.find((p) => p.playerId === playerId);
  return pick?.pickNumber ?? 0;
}

// @spec DFF-UI-062
function getPickRoundForPlayer(draftState: DraftState, playerId: string): number {
  const pick = draftState.picks.find((p) => p.playerId === playerId);
  return pick ? getPickRound(draftState, pick.pickNumber) : 0;
}

// @spec DFF-UI-061
function PickLogTab({ draftState }: { draftState: DraftState }) {
  if (draftState.picks.length === 0) {
    return (
      <div className="py-12 text-center text-stone-500">
        <p>No picks recorded for this draft.</p>
      </div>
    );
  }

  return (
    <div data-testid="history-pick-log" className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0" aria-label="Pick Log">
        <thead>
          <tr>
            <th className="border-b border-stone-700 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">
              Rd
            </th>
            <th className="border-b border-stone-700 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">
              Pick
            </th>
            <th className="border-b border-stone-700 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">
              Team
            </th>
            <th className="border-b border-stone-700 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">
              Player
            </th>
            <th className="border-b border-stone-700 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">
              Pos
            </th>
            <th className="border-b border-stone-700 px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">
              Value
            </th>
          </tr>
        </thead>
        <tbody>
          {draftState.picks.map((pick) => {
            const round = getPickRound(draftState, pick.pickNumber);
            const pickInRound = getPickInRound(draftState, pick.pickNumber);
            const teamName = getTeamName(draftState, pick.teamId);
            const playerName = getPlayerName(draftState, pick.playerId);
            const position = getPlayerPosition(draftState, pick.playerId);
            const value = getDynastyValueForPlayer(draftState, pick.playerId);

            return (
              <tr
                key={pick.pickNumber}
                data-testid={`history-pick-${pick.pickNumber}`}
                className="border-b border-stone-800 transition hover:bg-stone-800/30"
              >
                <td className="px-4 py-3 text-sm text-stone-300">{round}</td>
                <td className="px-4 py-3 text-sm text-stone-300">{pickInRound}</td>
                <td className="px-4 py-3 text-sm font-medium text-stone-200">{teamName}</td>
                <td className="px-4 py-3 text-sm text-stone-50">{playerName}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-full border px-2.5 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.2em] ${
                      position === 'QB'
                        ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
                        : position === 'RB'
                          ? 'border-blue-400/30 bg-blue-400/10 text-blue-200'
                          : position === 'WR'
                            ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
                            : position === 'TE'
                              ? 'border-purple-400/30 bg-purple-400/10 text-purple-200'
                              : 'border-stone-400/30 bg-stone-400/10 text-stone-400'
                    }`}
                  >
                    {position}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-sm text-stone-200">{formatDynastyValue(value)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// @spec DFF-UI-062
// @spec DFF-UI-063
function RosterViewTab({ draftState }: { draftState: DraftState }) {
  if (draftState.teams.length === 0) {
    return (
      <div className="py-12 text-center text-stone-500">
        <p>No teams in this draft.</p>
      </div>
    );
  }

  // Group roster players by team and then by position
  const teamPlayerMap = useMemo(() => {
    const map = new Map<string, Map<string, Array<{ playerId: string; name: string; position: string; round: number; value: number }>>>();

    for (const team of draftState.teams) {
      const positionMap = new Map<string, Array<{ playerId: string; name: string; position: string; round: number; value: number }>>();
      for (const pos of POSITION_ORDER) {
        positionMap.set(pos, []);
      }

      const teamPlayers = draftState.rosterPlayers.filter((rp) => rp.teamId === team.id);

      for (const rp of teamPlayers) {
        const position = getPlayerPosition(draftState, rp.playerId);
        const name = getPlayerName(draftState, rp.playerId);
        const round = getPickRoundForPlayer(draftState, rp.playerId);
        const value = getDynastyValueForPlayer(draftState, rp.playerId);

        const posEntry = positionMap.get(position);
        if (posEntry) {
          posEntry.push({ playerId: rp.playerId, name, position, round, value });
        }
        // Non-standard positions (FLEX, K, DEF, etc.) are silently skipped
        // to avoid rendering groups not defined in POSITION_ORDER
      }

      // Sort players within each position by value descending
      for (const [, players] of positionMap) {
        players.sort((a, b) => b.value - a.value);
      }

      map.set(team.id, positionMap);
    }

    return map;
  }, [draftState]);

  return (
    <div data-testid="history-roster-view" className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
      {draftState.teams.map((team) => {
        const positionMap = teamPlayerMap.get(team.id);

        return (
          <div
            key={team.id}
            data-testid={`history-team-card-${team.id}`}
            data-user-team={team.isUser ? 'true' : 'false'}
            className={`rounded-2xl border ${
              team.isUser
                ? 'border-amber-400/30 bg-amber-400/5'
                : 'border-stone-700 bg-stone-800/40'
            } p-5 shadow-md`}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-stone-100">{team.name}</h3>
                <p className="text-xs uppercase tracking-[0.2em] text-stone-500">
                  {team.isUser ? 'Your Team' : team.archetype?.replaceAll('_', ' ') ?? 'Bot'}
                </p>
              </div>
              {team.isUser ? (
                <span className="rounded-full bg-amber-400/20 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-amber-300">
                  You
                </span>
              ) : null}
            </div>

            <div className="space-y-4">
              {POSITION_ORDER.map((position) => {
                const players = positionMap?.get(position) ?? [];

                if (players.length === 0) {
                  return (
                    <div key={position} className="border-t border-stone-700/50 pt-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-stone-500">
                        {position}
                      </p>
                      <p className="text-xs text-stone-600 italic">—</p>
                    </div>
                  );
                }

                return (
                  <div key={position} className="border-t border-stone-700/50 pt-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-stone-500">
                      {position}
                    </p>
                    <div className="space-y-1.5">
                      {players.map((player) => (
                        <div
                          key={player.playerId}
                          className="flex items-center justify-between"
                        >
                          <span className="text-sm text-stone-200">{player.name}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-stone-500">Rd {player.round}</span>
                            <span className="text-sm text-stone-300">{formatDynastyValue(player.value)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// @spec DFF-UI-064
// @spec DFF-SPKV-060
// @spec DFF-SPKV-061
function renderAssets(assets: unknown[], draftState: DraftState) {
  if (!assets || assets.length === 0) {
    return '—';
  }

  return (
    <div className="flex flex-wrap gap-2">
      {assets.map((asset, index) => (
        <span key={`trade-asset-${index}`} className="inline-flex">
          <TradeAssetDisplay
            asset={asset}
            draftState={draftState}
            futurePickLabelStyle="abbreviated"
            playerLabelStyle="name-only"
          />
        </span>
      ))}
    </div>
  );
}

// @spec DFF-UI-064
function TradeLogTab({ draftState }: { draftState: DraftState }) {
  if (draftState.trades.length === 0) {
    return (
      <div className="py-12 text-center text-stone-500">
        <p>No trades occurred during this draft.</p>
      </div>
    );
  }

  return (
    <div data-testid="history-trade-log" className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0" aria-label="Trade Log">
        <thead>
          <tr>
            <th className="border-b border-stone-700 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">
              Rd
            </th>
            <th className="border-b border-stone-700 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">
              From
            </th>
            <th className="border-b border-stone-700 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">
              To
            </th>
            <th className="border-b border-stone-700 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">
              Assets Sent
            </th>
            <th className="border-b border-stone-700 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">
              Assets Received
            </th>
            <th className="border-b border-stone-700 px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">
              Outcome
            </th>
          </tr>
        </thead>
        <tbody>
          {draftState.trades.map((trade) => (
            <tr
              key={trade.id}
              data-testid={`history-trade-${trade.id}`}
              className="border-b border-stone-800 transition hover:bg-stone-800/30"
            >
              <td className="px-4 py-3 text-sm text-stone-300">{trade.round || '—'}</td>
              <td className="px-4 py-3 text-sm font-medium text-stone-200">
                {getTeamName(draftState, trade.initiatingTeamId)}
              </td>
              <td className="px-4 py-3 text-sm font-medium text-stone-200">
                {getTeamName(draftState, trade.receivingTeamId)}
              </td>
              <td className="px-4 py-3 text-sm text-stone-300">{renderAssets(trade.assetsSent, draftState)}</td>
              <td className="px-4 py-3 text-sm text-stone-300">{renderAssets(trade.assetsReceived, draftState)}</td>
              <td className="px-4 py-3 text-right">
                <span
                  className={`inline-block rounded-full px-2.5 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.2em] ${
                    trade.status === 'accepted'
                      ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
                      : trade.status === 'declined'
                        ? 'border-red-400/30 bg-red-400/10 text-red-200'
                        : 'border-stone-400/30 bg-stone-400/10 text-stone-400'
                  }`}
                >
                  {trade.status === 'force_declined' ? 'Force Declined' : trade.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// @spec DFF-UI-060
// @spec DFF-UI-065
export function HistoryView({ draftState, onNewDraft }: HistoryViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>('pick-log');

  return (
    <section className="w-full max-w-6xl rounded-[2rem] border border-stone-800 bg-stone-900/90 p-8 shadow-2xl shadow-black/20">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">History</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-stone-50">Draft Summary</h1>
          <p className="mt-1 text-sm text-stone-400">
            {draftState.teams.length} teams · {draftState.picks.length} picks ·{' '}
            {draftState.trades.length} trade{draftState.trades.length !== 1 ? 's' : ''}
          </p>
        </div>

        <button
          type="button"
          onClick={onNewDraft}
          className="rounded-full bg-amber-300 px-5 py-2.5 text-sm font-semibold text-stone-950 transition hover:bg-amber-200"
        >
          New Draft
        </button>
      </div>

      {/* Tab pills */}
      <div className="mt-8 flex gap-2" role="tablist" aria-label="Draft history tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`history-tabpanel-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-full px-5 py-2 text-sm font-semibold transition ${
              activeTab === tab.id
                ? 'bg-amber-300 text-stone-950'
                : 'border border-stone-700 text-stone-300 hover:border-stone-500 hover:text-stone-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div className="mt-6">
        {activeTab === 'pick-log' && (
          <div
            id="history-tabpanel-pick-log"
            role="tabpanel"
            aria-label="Pick Log"
          >
            <PickLogTab draftState={draftState} />
          </div>
        )}
        {activeTab === 'roster-view' && (
          <div
            id="history-tabpanel-roster-view"
            role="tabpanel"
            aria-label="Roster View"
          >
            <RosterViewTab draftState={draftState} />
          </div>
        )}
        {activeTab === 'trade-log' && (
          <div
            id="history-tabpanel-trade-log"
            role="tabpanel"
            aria-label="Trade Log"
          >
            <TradeLogTab draftState={draftState} />
          </div>
        )}
      </div>
    </section>
  );
}
