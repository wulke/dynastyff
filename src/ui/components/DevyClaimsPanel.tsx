// @spec DFF-DVC-009
// @spec DFF-DVC-010 — rendered only when the league has at least one devy claim.
import { useMemo, useState } from 'react';

export type DevyMatchView = {
  matched: boolean;
  position: string | null;
  school: string | null;
  draftYear: number | null;
  dynastyValue: number | null;
};

export type DevyClaimRow = {
  rosterId: number;
  teamName: string;
  devyName: string;
  devyMatch: DevyMatchView;
};

export type DevyAvailableRow = {
  name: string;
  position: string;
  school: string | null;
  draftYear: number;
  dynastyValue: number;
};

export type DevyClaimsView = {
  season: string;
  claims: DevyClaimRow[];
  available: DevyAvailableRow[];
  lastSyncedAt: string | null;
};

type YearFilter = 'all' | number;

const positionTextTokens: Record<string, string> = {
  QB: 'text-pos-qb',
  RB: 'text-pos-rb',
  WR: 'text-pos-wr',
  TE: 'text-pos-te',
};

function PositionTag({ position }: { position: string | null }) {
  return (
    <span
      className={`w-8 shrink-0 font-condensed text-sm font-bold ${positionTextTokens[position ?? ''] ?? 'text-primary'}`}
    >
      {position ?? '—'}
    </span>
  );
}

function SchoolDraftYear({ school, draftYear }: { school: string | null; draftYear: number | null }) {
  if (school === null && draftYear === null) {
    return <span className="text-muted">—</span>;
  }

  return (
    <span className="min-w-0 truncate text-xs text-muted">
      {[school, draftYear !== null ? `DY ${draftYear}` : null].filter(Boolean).join(' · ')}
    </span>
  );
}

// @spec DFF-DVC-009
export function DevyClaimsPanel({ data }: { data: DevyClaimsView }) {
  const nextDraftYear = Number(data.season) + 1;
  const years = useMemo(
    () => [...new Set(data.available.map((row) => row.draftYear))].sort((left, right) => right - left),
    [data.available],
  );
  const [yearFilter, setYearFilter] = useState<YearFilter>(
    years.includes(nextDraftYear) ? nextDraftYear : 'all',
  );

  const available =
    yearFilter === 'all' ? data.available : data.available.filter((row) => row.draftYear === yearFilter);

  return (
    <section className="mb-3 rounded-md border border-default bg-surface" aria-label="Devy claims">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-default px-3 py-2">
        <h2 className="font-condensed text-lg font-semibold text-primary">Devy Claims</h2>
        <div className="flex items-center gap-1" role="group" aria-label="Draft year filter">
          <button
            type="button"
            onClick={() => setYearFilter('all')}
            aria-pressed={yearFilter === 'all'}
            className={`rounded px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide transition ${
              yearFilter === 'all'
                ? 'border border-accent text-accent'
                : 'border border-default text-muted hover:border-strong hover:text-primary'
            }`}
          >
            All
          </button>
          {years.map((year) => (
            <button
              key={year}
              type="button"
              onClick={() => setYearFilter(year)}
              aria-pressed={yearFilter === year}
              className={`rounded px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide transition ${
                yearFilter === year
                  ? 'border border-accent text-accent'
                  : 'border border-default text-muted hover:border-strong hover:text-primary'
              }`}
            >
              {year}
            </button>
          ))}
        </div>
      </div>

      <div className="border-b border-default px-3 py-1.5">
        <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-secondary">
          Claimed ({data.claims.length})
        </p>
      </div>
      {data.claims.map((claim) => (
        <div
          key={`${claim.rosterId}-${claim.devyName}`}
          className="flex items-center gap-3 border-b border-default px-3 py-1 text-sm last:border-b-0 hover:bg-surface-hover"
        >
          <span className="w-24 shrink-0 truncate text-xs font-semibold text-secondary">{claim.teamName}</span>
          <PositionTag position={claim.devyMatch.position} />
          <span className="min-w-0 flex-1 truncate font-medium text-primary">{claim.devyName}</span>
          <SchoolDraftYear school={claim.devyMatch.school} draftYear={claim.devyMatch.draftYear} />
          <span className="w-12 shrink-0 text-right font-condensed text-xs tabular-nums text-secondary">
            {claim.devyMatch.dynastyValue ?? '—'}
          </span>
        </div>
      ))}

      <div className="border-b border-default px-3 py-1.5">
        <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-secondary">
          Available ({available.length})
        </p>
      </div>
      {available.map((row) => (
        <div
          key={`${row.position}-${row.name}`}
          className="flex items-center gap-3 border-b border-default px-3 py-1 text-sm last:border-b-0 hover:bg-surface-hover"
        >
          <PositionTag position={row.position} />
          <span className="min-w-0 flex-1 truncate font-medium text-primary">{row.name}</span>
          <SchoolDraftYear school={row.school} draftYear={row.draftYear} />
          <span className="w-12 shrink-0 text-right font-condensed text-xs tabular-nums text-secondary">
            {row.dynastyValue}
          </span>
        </div>
      ))}
    </section>
  );
}
