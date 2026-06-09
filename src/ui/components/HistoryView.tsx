// @spec DFF-UI-060
// @spec DFF-UI-061
// @spec DFF-UI-062
// @spec DFF-UI-063
// @spec DFF-UI-064
// @spec DFF-UI-065
import { useState, useMemo } from 'react';
import type { DraftState, TradeRecord } from '../context/DraftContext.js';
import { TradeAssetDisplay } from './tradeAssetPresentation.js';
import { getPositionBadgeClass } from './positionBadge.js';

type HistoryViewProps = {
  draftState: DraftState;
  onNewDraft: () => void;
};

type TabId = 'pick-log' | 'roster-view' | 'trade-log';
type TabConfig = { id: TabId; label: string };

// @spec DFF-UI-060
const TABS: TabConfig[] = [
  { id: 'pick-log', label: 'Pick Log' },
  { id: 'roster-view', label: 'Roster View' },
  { id: 'trade-log', label: 'Trade Log' },
];

// @spec DFF-UI-062
const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE'] as const;
type Position = (typeof POSITION_ORDER)[number];

function formatDynastyValue(value: number): string {
  return value.toLocaleString('en-US');
}

function getDynastyValueForPlayer(draftState: DraftState, playerId: string): number {
  return draftState.playerCatalog[playerId]?.dynastyValue ?? 0;
}

function getPlayerName(draftState: DraftState, playerId: string): string {
  return draftState.playerCatalog[playerId]?.name ?? playerId;
}

function getPlayerPosition(draftState: DraftState, playerId: string): string {
  return draftState.playerCatalog[playerId]?.position ?? 'NA';
}

function getPickRound(draftState: DraftState, pickNumber: number): number {
  return draftState.draftOrder.find((s) => s.pickNumber === pickNumber)?.round ?? 0;
}

function getPickInRound(draftState: DraftState, pickNumber: number): number {
  return draftState.draftOrder.find((s) => s.pickNumber === pickNumber)?.pickInRound ?? 0;
}

function getTeamName(draftState: DraftState, teamId: string): string {
  return draftState.teams.find((t) => t.id === teamId)?.name ?? teamId;
}

function getPickRoundForPlayer(draftState: DraftState, playerId: string): number {
  const pick = draftState.picks.find((p) => p.playerId === playerId);
  return pick ? getPickRound(draftState, pick.pickNumber) : 0;
}

const thClass = 'border-b border-default px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-widest text-muted';
const tdClass = 'px-3 py-2 text-xs text-secondary';
const trClass = 'border-b border-default transition hover:bg-surface-hover';

// @spec DFF-UI-061
function PickLogTab({ draftState }: { draftState: DraftState }) {
  if (draftState.picks.length === 0) {
    return <div className="py-8 text-center text-xs text-muted"><p>No picks recorded for this draft.</p></div>;
  }

  return (
    <div data-testid="history-pick-log" className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0" aria-label="Pick Log">
        <thead>
          <tr>
            <th className={`${thClass} text-left`}>Rd</th>
            <th className={`${thClass} text-left`}>Pick</th>
            <th className={`${thClass} text-left`}>Team</th>
            <th className={`${thClass} text-left`}>Player</th>
            <th className={`${thClass} text-left`}>Pos</th>
            <th className={`${thClass} text-right`}>Value</th>
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
              <tr key={pick.pickNumber} data-testid={`history-pick-${pick.pickNumber}`} className={trClass}>
                <td className={`${tdClass} tabular-nums`}>{round}</td>
                <td className={`${tdClass} tabular-nums`}>{pickInRound}</td>
                <td className={`${tdClass} font-medium text-secondary`}>{teamName}</td>
                <td className={`${tdClass} text-primary`}>{playerName}</td>
                <td className="px-3 py-2">
                  <span className={getPositionBadgeClass(position)}>{position}</span>
                </td>
                <td className={`${tdClass} text-right tabular-nums`}>{formatDynastyValue(value)}</td>
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
    return <div className="py-8 text-center text-xs text-muted"><p>No teams in this draft.</p></div>;
  }

  const teamPlayerMap = useMemo(() => {
    const map = new Map<string, Map<string, Array<{ playerId: string; name: string; position: string; round: number; value: number }>>>();

    for (const team of draftState.teams) {
      const positionMap = new Map<string, Array<{ playerId: string; name: string; position: string; round: number; value: number }>>();
      for (const pos of POSITION_ORDER) positionMap.set(pos, []);

      for (const rp of draftState.rosterPlayers.filter((rp) => rp.teamId === team.id)) {
        const position = getPlayerPosition(draftState, rp.playerId);
        const posEntry = positionMap.get(position);
        if (posEntry) {
          posEntry.push({
            playerId: rp.playerId,
            name: getPlayerName(draftState, rp.playerId),
            position,
            round: getPickRoundForPlayer(draftState, rp.playerId),
            value: getDynastyValueForPlayer(draftState, rp.playerId),
          });
        }
      }

      for (const [, players] of positionMap) players.sort((a, b) => b.value - a.value);
      map.set(team.id, positionMap);
    }

    return map;
  }, [draftState]);

  return (
    <div data-testid="history-roster-view" className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
      {draftState.teams.map((team) => {
        const positionMap = teamPlayerMap.get(team.id);

        return (
          <div
            key={team.id}
            data-testid={`history-team-card-${team.id}`}
            data-user-team={team.isUser ? 'true' : 'false'}
            className={`rounded-md border p-3 ${team.isUser ? 'border-accent/30 bg-accent/10' : 'border-default bg-app'}`}
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="font-condensed text-sm font-semibold text-primary">{team.name}</h3>
                <p className="text-[0.6rem] uppercase tracking-wide text-muted">
                  {team.isUser ? 'Your Team' : (team.archetype?.replaceAll('_', ' ') ?? 'Bot')}
                </p>
              </div>
              {team.isUser ? (
                <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-accent">
                  You
                </span>
              ) : null}
            </div>

            <div className="space-y-2">
              {POSITION_ORDER.map((position) => {
                const players = positionMap?.get(position) ?? [];

                return (
                  <div key={position} className="border-t border-default pt-2">
                    <p className="mb-1.5 text-[0.6rem] font-semibold uppercase tracking-widest text-muted">{position}</p>
                    {players.length === 0 ? (
                      <p className="text-[0.6rem] italic text-muted">—</p>
                    ) : (
                      <div className="space-y-1">
                        {players.map((player) => (
                          <div key={player.playerId} className="flex items-center justify-between">
                            <span className="text-xs text-secondary">{player.name}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-[0.6rem] tabular-nums text-muted">Rd {player.round}</span>
                              <span className="font-condensed text-xs tabular-nums text-muted">{formatDynastyValue(player.value)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
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
  if (!assets || assets.length === 0) return '—';

  return (
    <div className="flex flex-wrap gap-1.5">
      {assets.map((asset, index) => (
        <span key={`trade-asset-${index}`} className="inline-flex">
          <TradeAssetDisplay asset={asset} draftState={draftState} futurePickLabelStyle="abbreviated" playerLabelStyle="name-only" />
        </span>
      ))}
    </div>
  );
}

// @spec DFF-UI-064
function TradeLogTab({ draftState }: { draftState: DraftState }) {
  if (draftState.trades.length === 0) {
    return <div className="py-8 text-center text-xs text-muted"><p>No trades occurred during this draft.</p></div>;
  }

  return (
    <div data-testid="history-trade-log" className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0" aria-label="Trade Log">
        <thead>
          <tr>
            <th className={`${thClass} text-left`}>Rd</th>
            <th className={`${thClass} text-left`}>From</th>
            <th className={`${thClass} text-left`}>To</th>
            <th className={`${thClass} text-left`}>Assets Sent</th>
            <th className={`${thClass} text-left`}>Assets Received</th>
            <th className={`${thClass} text-right`}>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {draftState.trades.map((trade) => (
            <tr key={trade.id} data-testid={`history-trade-${trade.id}`} className={trClass}>
              <td className={`${tdClass} tabular-nums`}>{trade.round || '—'}</td>
              <td className={`${tdClass} font-medium`}>{getTeamName(draftState, trade.initiatingTeamId)}</td>
              <td className={`${tdClass} font-medium`}>{getTeamName(draftState, trade.receivingTeamId)}</td>
              <td className={tdClass}>{renderAssets(trade.assetsSent, draftState)}</td>
              <td className={tdClass}>{renderAssets(trade.assetsReceived, draftState)}</td>
              <td className="px-3 py-2 text-right">
                <span
                  className={`inline-block rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${
                    trade.status === 'accepted'
                      ? 'border-positive/30 bg-positive/10 text-positive'
                      : trade.status === 'declined'
                        ? 'border-negative/30 bg-negative/10 text-negative'
                        : 'border-default bg-surface text-muted'
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
    <section className="w-full max-w-6xl rounded-md border border-default bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-default px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">History</p>
          <h1 className="font-condensed text-2xl font-bold tracking-tight text-primary">Draft Summary</h1>
          <p className="text-xs text-muted tabular-nums">
            {draftState.teams.length} teams · {draftState.picks.length} picks · {draftState.trades.length} trade{draftState.trades.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onNewDraft}
          className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition hover:bg-accent-hover"
        >
          New Draft
        </button>
      </div>
      <div className="border-b border-default px-4 py-2">
        <div className="flex gap-1" role="tablist" aria-label="Draft history tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`history-tabpanel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded px-3 py-1 text-xs font-semibold transition ${
                activeTab === tab.id
                  ? 'bg-accent text-accent-fg'
                  : 'text-muted hover:text-secondary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {activeTab === 'pick-log' && (
          <div id="history-tabpanel-pick-log" role="tabpanel" aria-label="Pick Log">
            <PickLogTab draftState={draftState} />
          </div>
        )}
        {activeTab === 'roster-view' && (
          <div id="history-tabpanel-roster-view" role="tabpanel" aria-label="Roster View">
            <RosterViewTab draftState={draftState} />
          </div>
        )}
        {activeTab === 'trade-log' && (
          <div id="history-tabpanel-trade-log" role="tabpanel" aria-label="Trade Log">
            <TradeLogTab draftState={draftState} />
          </div>
        )}
      </div>
    </section>
  );
}
