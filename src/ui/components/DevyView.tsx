// @spec DFF-DEVY-042
// @spec DFF-DEVY-043
// @spec DFF-DEVY-044
// @spec DFF-DEVY-045
// @spec DFF-DVR-004
// @spec DFF-DVR-005
// @spec DFF-DVR-006
// @spec DFF-DVR-007
// @spec DFF-DVR-008
// @spec DFF-DVR-009
// @spec DFF-DVR-010
// @spec DFF-DVR-011
// @spec DFF-DVR-014
import { useMemo, useState } from 'react';

import { getPositionBadgeClass } from './positionBadge.js';
import type { Snapshot } from '../types.js';

type DevyPlayer = NonNullable<Snapshot['devyPlayers']>[number];
type ValueFormat = 'superflex' | 'oneQb';
type PositionFilter = 'ALL' | DevyPlayer['position'];

export type DevyViewProps = {
  players: readonly DevyPlayer[];
  /** devy player id -> owning Sleeper team name. `null`/undefined = unknown (no league or load failure). */
  ownership?: Record<string, string> | null;
  /** devy player id -> saved note. */
  notes?: Record<string, string>;
  /** Persist a note (empty string deletes). Absent = notes feature off (snapshot-fed views). */
  onSaveNote?: (playerId: string, note: string) => Promise<void>;
};

// @spec DFF-DEVY-042
function getPillClass(active: boolean): string {
  return active ? 'rounded border border-accent bg-accent px-2 py-1 text-xs font-semibold text-accent-fg' : 'rounded border border-default px-2 py-1 text-xs font-semibold text-muted hover:border-strong hover:text-secondary';
}

// @spec DFF-DVR-010
function NotesIcon() {
  return <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5"><path d="M11.3 1.7a1.7 1.7 0 0 1 2.4 2.4L6 11.8l-3.3.9.9-3.3 7.7-7.7Z" strokeLinejoin="round" /></svg>;
}

// @spec DFF-DVR-008 — per DESIGN.md: surface-raised panel, rounded-lg, blurred backdrop.
// @spec DFF-DVR-009 — Save persists via onSaveNote.
// @spec DFF-DVR-011 — Delete saves an empty note; Cancel discards the draft.
function NotesModal({ player, savedNote, saving, onClose, onSave }: {
  player: DevyPlayer;
  savedNote: string | undefined;
  saving: boolean;
  onClose: () => void;
  onSave: (note: string) => void;
}) {
  const [draft, setDraft] = useState(savedNote ?? '');

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-label={`Notes: ${player.name}`} className="w-full max-w-md rounded-lg border border-strong bg-surface-raised p-4 shadow-lg" onClick={(event) => event.stopPropagation()}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-condensed text-lg font-semibold text-primary">
          {player.name} <span className="ml-1 rounded border border-accent px-1 py-0.5 text-[0.65rem] font-semibold tracking-wide text-accent">DEVY</span>
        </h3>
        <button type="button" aria-label="Close notes" onClick={onClose} className="rounded px-1 text-xl leading-none text-muted hover:text-primary">×</button>
      </div>
      <label className="block text-xs text-muted">Note
        <textarea aria-label="Note" value={draft} onChange={(event) => setDraft(event.target.value)} rows={5} className="mt-1 w-full rounded border border-default bg-app p-2 text-sm text-primary outline-none focus:border-accent" />
      </label>
      <div className="mt-3 flex justify-end gap-2">
        {savedNote ? <button type="button" disabled={saving} onClick={() => onSave('')} className="rounded border border-negative px-3 py-2 text-sm font-semibold text-negative hover:bg-surface-hover disabled:opacity-50">Delete</button> : null}
        <button type="button" onClick={onClose} className="rounded border border-default px-3 py-2 text-sm font-semibold text-secondary hover:border-strong">Cancel</button>
        <button type="button" disabled={saving} onClick={() => onSave(draft)} className="rounded border border-accent bg-accent px-3 py-2 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50">Save</button>
      </div>
    </div>
  </div>;
}

// @spec DFF-DEVY-042
// @spec DFF-DEVY-043
// @spec DFF-DEVY-044
// @spec DFF-DEVY-045
// @spec DFF-DVR-004
// @spec DFF-DVR-005
// @spec DFF-DVR-006
// @spec DFF-DVR-007
// @spec DFF-DVR-008
// @spec DFF-DVR-010
// @spec DFF-DVR-014
export function DevyView({ players, ownership, notes, onSaveNote }: DevyViewProps) {
  const [position, setPosition] = useState<PositionFilter>('ALL');
  const [draftYear, setDraftYear] = useState<number | null>(null);
  const [schoolSearch, setSchoolSearch] = useState('');
  const [valueFormat, setValueFormat] = useState<ValueFormat>('superflex');
  const [notesPlayer, setNotesPlayer] = useState<DevyPlayer | null>(null);
  const [saving, setSaving] = useState(false);
  const showOwnership = ownership !== undefined;
  const showNotes = onSaveNote !== undefined;
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

  // @spec DFF-DVR-009
  const handleSave = async (note: string) => {
    if (!notesPlayer || !onSaveNote) {
      return;
    }

    setSaving(true);

    try {
      await onSaveNote(notesPlayer.id, note);
      setNotesPlayer(null);
    } finally {
      setSaving(false);
    }
  };

  const gridClass = showOwnership && showNotes
    ? 'grid grid-cols-[2rem_minmax(0,1fr)_3.5rem_5rem_5rem_5rem_6rem_1.75rem]'
    : showOwnership
      ? 'grid grid-cols-[2rem_minmax(0,1fr)_3.5rem_5rem_5rem_5rem_6rem]'
      : 'grid grid-cols-[2rem_minmax(0,1fr)_3.5rem_5rem_5rem_5rem]';

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
        <div role="row" className={`${gridClass} gap-2 border-b border-default px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted`}>
          <span>#</span><span>Player</span><span>Pos</span><span>School</span><span>Draft</span><span className="text-right">Value</span>
          {showOwnership ? <span>Owner</span> : null}
          {showNotes ? <span /> : null}
        </div>
        {filteredPlayers.map((player, index) => {
          const owner = ownership?.[player.id];
          const hasNote = notes !== undefined && notes[player.id] !== undefined;

          return <div key={player.id} role="row" className={`${gridClass} items-center gap-2 border-b border-default px-2 py-1 text-sm last:border-b-0 hover:bg-surface-hover`}>
            <span className="font-condensed tabular-nums text-right text-muted">{index + 1}</span>
            <span className="min-w-0 truncate font-medium text-primary">{player.name} <span className="rounded border border-accent px-1 py-0.5 text-[0.65rem] font-semibold tracking-wide text-accent">DEVY</span></span>
            <span className={getPositionBadgeClass(player.position)}>{player.position}</span>
            <span className="truncate text-secondary">{player.school ?? '—'}</span>
            <span className="font-condensed tabular-nums text-secondary">{player.draftYear}</span>
            <span className="font-condensed tabular-nums text-right font-bold text-primary">{valueFormat === 'superflex' ? player.valueSuperflex : player.valueOneQb ?? '—'}</span>
            {showOwnership ? <span className="min-w-0 truncate text-xs">{owner
              ? <span className="rounded border border-default bg-surface-hover px-1 py-0.5 font-medium text-secondary">{owner}</span>
              : ownership === null
                ? <span className="text-muted" title="No Sleeper league connected">—</span>
                : <span className="text-muted">Unowned</span>}</span> : null}
            {showNotes ? <span className="text-right">
              <button type="button" aria-label={`Notes: ${player.name}`} title={hasNote ? notes?.[player.id] : 'Add a note'} onClick={() => setNotesPlayer(player)} className={`rounded p-0.5 align-middle hover:text-secondary ${hasNote ? 'text-accent' : 'text-muted'}`}><NotesIcon /></button>
            </span> : null}
          </div>;
        })}
      </div>}
    </div>
    {notesPlayer && onSaveNote ? <NotesModal player={notesPlayer} savedNote={notes?.[notesPlayer.id]} saving={saving} onClose={() => setNotesPlayer(null)} onSave={handleSave} /> : null}
  </section>;
}
