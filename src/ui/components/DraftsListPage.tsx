// @spec DFF-UI-110
// @spec DFF-UI-112
// @spec DFF-UI-113
// @spec DFF-UI-114
// @spec DFF-UI-115
import { useDraftContext } from '../context/DraftContext.js';

// @spec DFF-UI-112
export type DraftListEntry = {
  id: string;
  created_at: string;
  completed_at: string | null;
  status: 'in_progress' | 'completed';
  scoring_format: string;
  team_count: number;
  rounds: number;
};

type DraftsListPageProps = {
  drafts: DraftListEntry[];
  onNavigateToConfig: () => void;
  onNavigateToDrafting: () => void;
  onNavigateToHistory: () => void;
};

// @spec DFF-UI-112
function formatDate(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// @spec DFF-UI-112
function formatScoringFormat(format: string): string {
  if (format === 'ppr') return 'PPR';
  if (format === 'half_ppr') return 'Half PPR';
  if (format === 'standard') return 'Standard';
  return format;
}

// @spec DFF-UI-110
export function DraftsListPage({ drafts, onNavigateToConfig, onNavigateToDrafting, onNavigateToHistory }: DraftsListPageProps) {
  const { loadDraft } = useDraftContext();

  // @spec DFF-UI-115
  function handleNewDraft() {
    onNavigateToConfig();
  }

  // @spec DFF-UI-113
  async function handleResume(draftId: string) {
    const loaded = await loadDraft(draftId);
    if (loaded) onNavigateToDrafting();
  }

  // @spec DFF-UI-114
  async function handleReview(draftId: string) {
    const loaded = await loadDraft(draftId);
    if (loaded) onNavigateToHistory();
  }

  return (
    <section className="w-full max-w-5xl rounded-md border border-default bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-default px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">Drafts</p>
          <h1 className="font-condensed text-2xl font-bold tracking-tight text-primary">Drafts List</h1>
          <p className="text-xs text-muted">
            {drafts.length} draft{drafts.length !== 1 ? 's' : ''} found. Select a draft to resume or review.
          </p>
        </div>
        <button
          type="button"
          onClick={handleNewDraft}
          className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition hover:bg-accent-hover"
        >
          New Draft
        </button>
      </div>

      <div className="overflow-x-auto">
        {/* @spec DFF-UI-112 */}
        <table className="w-full border-separate border-spacing-0" aria-label="Drafts list">
          <thead>
            <tr>
              {['Draft', 'Status', 'Date', 'Teams', 'Rounds', 'Scoring', 'Actions'].map((col, i) => (
                <th
                  key={col}
                  className={`border-b border-default px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-widest text-muted ${i === 6 ? 'text-right' : 'text-left'}`}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {drafts.map((draft) => (
              <tr
                key={draft.id}
                data-testid={`draft-row-${draft.id}`}
                className="border-b border-default transition hover:bg-surface-hover"
              >
                <td className="max-w-[10rem] truncate px-3 py-2 text-xs font-medium text-secondary">
                  {draft.id.length > 12 ? `${draft.id.slice(0, 12)}…` : draft.id}
                </td>
                <td className="px-3 py-2">
                  {/* @spec DFF-UI-112 */}
                  <span
                    className={`inline-block rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${
                      draft.status === 'completed'
                        ? 'border-positive/30 bg-positive/10 text-positive'
                        : 'border-accent/30 bg-accent/10 text-accent'
                    }`}
                  >
                    {draft.status === 'completed' ? 'Completed' : 'In Progress'}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-muted">{formatDate(draft.created_at)}</td>
                <td className="px-3 py-2 text-xs tabular-nums text-secondary">{draft.team_count}</td>
                <td className="px-3 py-2 text-xs tabular-nums text-secondary">{draft.rounds}</td>
                <td className="px-3 py-2 text-xs text-secondary">{formatScoringFormat(draft.scoring_format)}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {/* @spec DFF-UI-113 */}
                    {draft.status === 'in_progress' ? (
                      <button
                        type="button"
                        onClick={() => handleResume(draft.id)}
                        className="rounded bg-accent px-2.5 py-1 text-[0.65rem] font-semibold text-accent-fg transition hover:bg-accent-hover"
                      >
                        Resume
                      </button>
                    ) : null}
                    {/* @spec DFF-UI-114 */}
                    <button
                      type="button"
                      onClick={() => handleReview(draft.id)}
                      className="rounded border border-default px-2.5 py-1 text-[0.65rem] font-semibold text-muted transition hover:border-strong hover:text-secondary"
                    >
                      Review
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-default px-4 py-3">
        <span className="rounded border border-default px-2 py-1 text-[0.65rem] uppercase tracking-wide text-muted tabular-nums">
          {drafts.length} draft{drafts.length !== 1 ? 's' : ''} saved
        </span>
      </div>
    </section>
  );
}
