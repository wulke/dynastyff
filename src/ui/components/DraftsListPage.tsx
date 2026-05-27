// @spec DFF-UI-110
// @spec DFF-UI-112
// @spec DFF-UI-113
// @spec DFF-UI-114
// @spec DFF-UI-115
import * as Separator from '@radix-ui/react-separator';
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

  if (Number.isNaN(date.getTime())) {
    return isoString;
  }

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// @spec DFF-UI-112
function formatScoringFormat(format: string): string {
  if (format === 'ppr') {
    return 'PPR';
  }

  if (format === 'half_ppr') {
    return 'Half PPR';
  }

  if (format === 'standard') {
    return 'Standard';
  }

  return format;
}

// @spec DFF-UI-110
export function DraftsListPage({
  drafts,
  onNavigateToConfig,
  onNavigateToDrafting,
  onNavigateToHistory,
}: DraftsListPageProps) {
  const { loadDraft } = useDraftContext();

  // @spec DFF-UI-115
  function handleNewDraft() {
    onNavigateToConfig();
  }

  // @spec DFF-UI-113
  async function handleResume(draftId: string) {
    const loaded = await loadDraft(draftId);

    if (loaded) {
      onNavigateToDrafting();
    }
  }

  // @spec DFF-UI-114
  async function handleReview(draftId: string) {
    const loaded = await loadDraft(draftId);

    if (loaded) {
      onNavigateToHistory();
    }
  }

  return (
    <section className="w-full max-w-5xl rounded-[2rem] border border-stone-800 bg-stone-900/90 p-10 shadow-2xl shadow-black/20">
      <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">Drafts</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight text-stone-50">Drafts List</h1>
          <p className="mt-2 text-base text-stone-400">
            {drafts.length} draft{drafts.length !== 1 ? 's' : ''} found. Select a draft to resume or review.
          </p>
        </div>
        <button
          type="button"
          onClick={handleNewDraft}
          className="rounded-full bg-amber-300 px-5 py-2.5 text-sm font-semibold text-stone-950 transition hover:bg-amber-200"
        >
          New Draft
        </button>
      </div>

      <Separator.Root
        decorative
        orientation="horizontal"
        className="my-8 h-px w-full bg-gradient-to-r from-transparent via-stone-700 to-transparent"
      />

      <div className="overflow-x-auto">
        {/* @spec DFF-UI-112 */}
        <table className="w-full border-separate border-spacing-0" aria-label="Drafts list">
          <thead>
            <tr>
              <th className="border-b border-stone-700 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">
                Draft
              </th>
              <th className="border-b border-stone-700 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">
                Status
              </th>
              <th className="border-b border-stone-700 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">
                Date
              </th>
              <th className="border-b border-stone-700 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">
                Teams
              </th>
              <th className="border-b border-stone-700 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">
                Rounds
              </th>
              <th className="border-b border-stone-700 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">
                Scoring
              </th>
              <th className="border-b border-stone-700 px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((draft) => (
              <tr
                key={draft.id}
                data-testid={`draft-row-${draft.id}`}
                className="border-b border-stone-800 transition hover:bg-stone-800/30"
              >
                <td className="max-w-[10rem] truncate px-4 py-3 text-sm font-medium text-stone-200">
                  {draft.id.length > 12 ? `${draft.id.slice(0, 12)}...` : draft.id}
                </td>
                <td className="px-4 py-3">
                  {/* @spec DFF-UI-112 */}
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.2em] ${
                      draft.status === 'completed'
                        ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
                        : 'border-amber-400/30 bg-amber-400/10 text-amber-200'
                    }`}
                  >
                    {draft.status === 'completed' ? 'Completed' : 'In Progress'}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-stone-300">{formatDate(draft.created_at)}</td>
                <td className="px-4 py-3 text-sm text-stone-300">{draft.team_count}</td>
                <td className="px-4 py-3 text-sm text-stone-300">{draft.rounds}</td>
                <td className="px-4 py-3 text-sm text-stone-300">{formatScoringFormat(draft.scoring_format)}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {/* @spec DFF-UI-113 */}
                    {draft.status === 'in_progress' ? (
                      <button
                        type="button"
                        onClick={() => handleResume(draft.id)}
                        className="rounded-full bg-amber-300 px-4 py-1.5 text-xs font-semibold text-stone-950 transition hover:bg-amber-200"
                      >
                        Resume
                      </button>
                    ) : null}
                    {/* @spec DFF-UI-114 */}
                    <button
                      type="button"
                      onClick={() => handleReview(draft.id)}
                      className="rounded-full border border-stone-600 px-4 py-1.5 text-xs font-semibold text-stone-300 transition hover:border-stone-400 hover:text-stone-100"
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

      <Separator.Root
        decorative
        orientation="horizontal"
        className="my-8 h-px w-full bg-gradient-to-r from-transparent via-stone-700 to-transparent"
      />

      <span className="inline-block rounded-full border border-stone-700 px-4 py-2 text-xs uppercase tracking-[0.25em] text-stone-400">
        {drafts.length} draft{drafts.length !== 1 ? 's' : ''} saved
      </span>
    </section>
  );
}
