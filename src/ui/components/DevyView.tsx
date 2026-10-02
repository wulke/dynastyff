// @spec DFF-DEVY-042
// @spec DFF-DEVY-043
// @spec DFF-DEVY-044
// @spec DFF-DEVY-045
import { useMemo, useState } from 'react';

import { getPositionBadgeClass } from './positionBadge.js';
import type { Snapshot } from '../types.js';

type DevyPlayer = NonNullable<Snapshot['devyPlayers']>[number];
type ValueFormat = 'superflex' | 'oneQb';
type PositionFilter = 'ALL' | DevyPlayer['position'];

// @spec DFF-DEVY-042
function getPillClass(active: boolean): string {
  return active ? 'rounded border border-accent bg-accent px-2 py-1 text-xs font-semibold text-accent-fg' : 'rounded border border-default px-2 py-1 text-xs font-semibold text-muted hover:border-strong hover:text-secondary';
}

// @spec DFF-DEVY-042
// @spec DFF-DEVY-043
// @spec DFF-DEVY-044
// @spec DFF-DEVY-045
export function DevyView({ players }: { players: readonly DevyPlayer[] }) {
  const [position, setPosition] = useState<PositionFilter>('ALL');
  const [draftYear, setDraftYear] = useState<number | null>(null);
  const [schoolSearch, setSchoolSearch] = useState('');
  const [valueFormat, setValueFormat] = useState<ValueFormat>('superflex');
  const draftYears = useMemo(() => [...new Set(players.map((player) => player.draftYear))].sort((a, b) => a - b), [players]);
  const filteredPlayers = useMemo(() => players.filter((player) =>
    (position === 'ALL' || player.position === position) &&
    (draftYear === null || player.draftYear === draftYear) &&
    (!schoolSearch.trim() || (player.school ?? '').toLowerCase().includes(schoolSearch.trim().toLowerCase()))
  ).sort((left, right) => {
    const leftValue = valueFormat === 'superflex' ? left.valueSuperflex : left.valueOneQb ?? -1;
    const rightValue = valueFormat === 'superflex' ? right.valueSuperflex : right.valueOneQb ?? -1;
    return rightValue - leftValue || left.name.localeCompare(right.name);
  }), [players, position, draftYear, schoolSearch, valueFormat]);

  return <section className="w-full max-w-7xl" aria-labelledby="devy-title">
    <div className="mb-3 rounded-md border border-accent bg-surface px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">Devy</p>
      <h1 id="devy-title" className="font-condensed text-2xl font-bold text-primary">College Devy Values</h1>
      <p className="text-sm text-secondary">College-player market values, separate from NFL dynasty rankings.</p>
    </div>
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-default bg-surface px-3 py-2">
      {(['ALL', 'QB', 'RB', 'WR', 'TE'] as const).map((entry) => <button key={entry} type="button" aria-pressed={position === entry} onClick={() => setPosition(entry)} className={getPillClass(position === entry)}>{entry}</button>)}
      <span className="h-5 border-l border-default" />
      <button type="button" aria-pressed={draftYear === null} onClick={() => setDraftYear(null)} className={getPillClass(draftYear === null)}>All years</button>
      {draftYears.map((year) => <button key={year} type="button" aria-pressed={draftYear === year} onClick={() => setDraftYear(year)} className={getPillClass(draftYear === year)}>{year}</button>)}
      <label className="ml-auto text-xs text-muted">School <input type="search" aria-label="School search" value={schoolSearch} onChange={(event) => setSchoolSearch(event.target.value)} className="ml-1 rounded border border-default bg-app px-2 py-1 text-sm text-primary outline-none focus:border-accent" /></label>
    </div>
    <div className="rounded-md border border-default bg-surface">
      <div className="flex items-center justify-between border-b border-default px-3 py-2">
        <h2 className="font-condensed text-lg font-semibold text-primary">Rankings</h2>
        <div className="flex gap-1"><button type="button" onClick={() => setValueFormat('superflex')} aria-pressed={valueFormat === 'superflex'} className={getPillClass(valueFormat === 'superflex')}>Superflex</button><button type="button" onClick={() => setValueFormat('oneQb')} aria-pressed={valueFormat === 'oneQb'} className={getPillClass(valueFormat === 'oneQb')}>1QB</button></div>
      </div>
      {filteredPlayers.length === 0 ? <p className="px-3 py-2 text-sm text-muted">No devy players are available for these filters.</p> : <div role="table">
        <div role="row" className="grid grid-cols-[2rem_minmax(0,1fr)_3.5rem_5rem_5rem_5rem] gap-2 border-b border-default px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted"><span>#</span><span>Player</span><span>Pos</span><span>School</span><span>Draft</span><span className="text-right">Value</span></div>
        {filteredPlayers.map((player, index) => <div key={player.id} role="row" className="grid grid-cols-[2rem_minmax(0,1fr)_3.5rem_5rem_5rem_5rem] items-center gap-2 border-b border-default px-2 py-1 text-sm last:border-b-0 hover:bg-surface-hover"><span className="font-condensed tabular-nums text-right text-muted">{index + 1}</span><span className="min-w-0 truncate font-medium text-primary">{player.name} <span className="rounded border border-accent px-1 py-0.5 text-[0.65rem] font-semibold tracking-wide text-accent">DEVY</span></span><span className={getPositionBadgeClass(player.position)}>{player.position}</span><span className="truncate text-secondary">{player.school ?? '—'}</span><span className="font-condensed tabular-nums text-secondary">{player.draftYear}</span><span className="font-condensed tabular-nums text-right font-bold text-primary">{valueFormat === 'superflex' ? player.valueSuperflex : player.valueOneQb ?? '—'}</span></div>)}
      </div>}
    </div>
  </section>;
}
