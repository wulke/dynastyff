// @spec DFF-UI-001
// @spec DFF-UI-002
// @spec DFF-UI-003
// @spec DFF-UI-004
// @spec DFF-UI-005
// @spec DFF-UI-006
// @spec DFF-UI-007
// @spec DFF-UI-010
// @spec DFF-UI-014
// @spec DFF-UI-015
// @spec DFF-STATIC-060
// @spec DFF-STATIC-061
// @spec DFF-STATIC-062
// @spec DFF-UI-082
// @spec DFF-UI-110
// @spec DFF-UI-111
// @spec DFF-UI-116
// @spec DFF-UI-115
// @spec DFF-UI-130
// @spec DFF-UI-131
// @spec DFF-UI-138
// @spec DFF-UI-139
import { useState, useEffect, useRef } from 'react';
import * as Separator from '@radix-ui/react-separator';
import {
  HttpDraftContextProvider,
  useDraftContext,
  type DraftState,
} from './context/DraftContext.js';
import { DraftConfigScreen, configDefaults, sanitizeDraftConfig, type ConfigFormState } from './components/DraftConfigScreen.js';
import { DraftsListPage } from './components/DraftsListPage.js';
import { DraftBoard } from './components/DraftBoard.js';
import { PickFeedPanel } from './components/PickFeedPanel.js';
import { AvailablePlayersPanel } from './components/AvailablePlayersPanel.js';
import { HistoryView } from './components/HistoryView.js';

type DraftCompletionBannerProps = {
  teamName: string;
  onViewHistory: () => void;
};

type DraftStatusSummary = {
  currentPickLabel: string;
  turnLabel: string;
};

// @spec DFF-UI-116
function DraftsListLoadingState() {
  return (
    <section
      className="w-full max-w-5xl rounded-[2rem] border border-stone-800 bg-stone-900/90 p-10 shadow-2xl shadow-black/20"
      aria-label="Loading drafts"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">Drafts</p>
      <div className="mt-4">
        <h1 className="text-4xl font-semibold tracking-tight text-stone-50">Loading drafts</h1>
        <p className="mt-2 text-base text-stone-400">Checking saved drafts before choosing the next view.</p>
      </div>
      <Separator.Root
        decorative
        orientation="horizontal"
        className="my-8 h-px w-full bg-gradient-to-r from-transparent via-stone-700 to-transparent"
      />
      <div aria-hidden="true" className="overflow-hidden rounded-[1.5rem] border border-stone-800">
        <div className="grid grid-cols-[1.4fr_0.9fr_1.2fr_0.7fr_0.7fr_0.9fr_1fr] gap-0 border-b border-stone-800 bg-stone-950/50 px-4 py-3">
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={`drafts-loading-header-${index}`} className="h-3 w-16 animate-pulse rounded bg-stone-800" />
          ))}
        </div>
        {Array.from({ length: 4 }).map((_, rowIndex) => (
          <div
            key={`drafts-loading-row-${rowIndex}`}
            className="grid grid-cols-[1.4fr_0.9fr_1.2fr_0.7fr_0.7fr_0.9fr_1fr] items-center gap-4 border-b border-stone-800/80 px-4 py-4 last:border-b-0"
          >
            <div className="h-4 w-24 animate-pulse rounded bg-stone-800" />
            <div className="h-6 w-24 animate-pulse rounded-full bg-stone-800" />
            <div className="h-4 w-28 animate-pulse rounded bg-stone-800" />
            <div className="h-4 w-10 animate-pulse rounded bg-stone-800" />
            <div className="h-4 w-10 animate-pulse rounded bg-stone-800" />
            <div className="h-4 w-16 animate-pulse rounded bg-stone-800" />
            <div className="ml-auto h-8 w-28 animate-pulse rounded-full bg-stone-800" />
          </div>
        ))}
      </div>
    </section>
  );
}

// @spec DFF-UI-002
// @spec DFF-UI-003
// @spec DFF-UI-004
type ShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  statusBadge?: string | null;
  actionLabel?: string;
  onAction?: () => void;
};

// @spec DFF-UI-002
// @spec DFF-UI-003
// @spec DFF-UI-004
// @spec DFF-UI-082
function ViewShell({ eyebrow, title, description, statusBadge, actionLabel, onAction }: ShellProps) {
  return (
    <section className="w-full max-w-4xl rounded-[2rem] border border-stone-800 bg-stone-900/90 p-10 shadow-2xl shadow-black/20">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">{eyebrow}</p>
        {statusBadge ? (
          <span className="rounded-full border border-stone-700 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-stone-300">
            {statusBadge}
          </span>
        ) : null}
      </div>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-50">{title}</h1>
      <p className="mt-3 max-w-2xl text-base leading-7 text-stone-300">{description}</p>
      <Separator.Root
        decorative
        orientation="horizontal"
        className="my-8 h-px w-full bg-gradient-to-r from-transparent via-stone-700 to-transparent"
      />
      <div className="flex flex-wrap items-center gap-4">
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="rounded-full bg-amber-300 px-5 py-2.5 text-sm font-semibold text-stone-950 transition hover:bg-amber-200"
          >
            {actionLabel}
          </button>
        ) : null}
        <span className="rounded-full border border-stone-700 px-4 py-2 text-xs uppercase tracking-[0.25em] text-stone-400">
          Tailwind + Radix scaffold
        </span>
      </div>
    </section>
  );
}

// @spec DFF-UI-003
// @spec DFF-UI-005
// @spec DFF-UI-006
// @spec DFF-UI-007
function DraftCompletionBanner({ teamName, onViewHistory }: DraftCompletionBannerProps) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center rounded-[2rem] bg-stone-950/70 p-6 backdrop-blur-[2px]"
      aria-label="Draft completion banner"
      data-testid="draft-completion-banner"
    >
      <section className="w-full max-w-xl rounded-[1.75rem] border border-amber-300/20 bg-stone-900/95 p-8 text-center shadow-2xl shadow-black/40">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">Congratulations</p>
        <h2 className="mt-4 text-4xl font-semibold tracking-tight text-stone-50">You finished the draft</h2>
        <p className="mt-4 text-base leading-7 text-stone-300">
          Congratulations, {teamName}. Review every pick, roster decision, and trade from the full draft history.
        </p>
        <button
          type="button"
          onClick={onViewHistory}
          className="mt-8 rounded-full bg-amber-300 px-6 py-3 text-sm font-semibold text-stone-950 transition hover:bg-amber-200"
        >
          View Full History
        </button>
      </section>
    </div>
  );
}

// @spec DFF-UI-138
function getDraftStatusSummary(draftState: DraftState): DraftStatusSummary {
  const currentPick = draftState.currentPickNumber ?? draftState.picks.length;
  const totalPicks = draftState.draftOrder.length;

  if (draftState.status === 'completed') {
    return {
      currentPickLabel: `Pick ${currentPick} of ${totalPicks}`,
      turnLabel: 'Draft complete',
    };
  }

  const currentSlot = draftState.currentPickNumber
    ? draftState.draftOrder.find((slot) => slot.pickNumber === draftState.currentPickNumber) ?? null
    : null;
  const currentTeam = currentSlot
    ? draftState.teams.find((team) => team.id === currentSlot.teamId) ?? null
    : null;

  return {
    currentPickLabel: `Pick ${currentPick} of ${totalPicks}`,
    turnLabel: currentTeam?.isUser ? 'Your turn' : currentTeam?.name ?? 'Draft room active',
  };
}

// @spec DFF-UI-138
function DraftStatusBar({ draftState }: { draftState: DraftState }) {
  const status = getDraftStatusSummary(draftState);

  return (
    <section
      data-testid="draft-status-bar"
      className="w-full rounded-[1.75rem] border border-stone-800 bg-stone-900/90 px-5 py-4 shadow-2xl shadow-black/20"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">Draft Status</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-stone-50">{status.currentPickLabel}</p>
        </div>
        <div
          data-testid="draft-status-turn"
          className="rounded-full border border-stone-700 px-4 py-2 text-sm font-semibold text-stone-200"
        >
          {status.turnLabel}
        </div>
      </div>
    </section>
  );
}

// @spec DFF-UI-001
// @spec DFF-UI-002
// @spec DFF-UI-003
// @spec DFF-UI-004
// @spec DFF-UI-005
// @spec DFF-UI-006
// @spec DFF-UI-007
// @spec DFF-UI-010
// @spec DFF-UI-014
// @spec DFF-UI-015
// @spec DFF-UI-086
// @spec DFF-UI-087
export function App() {
  return (
    <HttpDraftContextProvider>
      <DraftApp />
    </HttpDraftContextProvider>
  );
}

type DraftListEntry = {
  id: string;
  created_at: string;
  completed_at: string | null;
  status: 'in_progress' | 'completed';
  scoring_format: string;
  team_count: number;
  rounds: number;
};

function DraftApp() {
  // @spec DFF-STATIC-061
  // @spec DFF-STATIC-062
  const { draftState, newDraft, showError, startDraft } = useDraftContext();
  const [draftConfig, setDraftConfig] = useState<ConfigFormState>(configDefaults);
  const [isSubmittingDraft, setIsSubmittingDraft] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showDraftsList, setShowDraftsList] = useState(false);
  const [draftsList, setDraftsList] = useState<DraftListEntry[]>([]);
  const [showDraftsListLoading, setShowDraftsListLoading] = useState(true);
  const showErrorRef = useRef(showError);

  useEffect(() => {
    showErrorRef.current = showError;
  }, [showError]);

  // @spec DFF-UI-110
  // @spec DFF-UI-111
  // @spec DFF-UI-117
  // @spec DFF-UI-118
  // On mount, check if any drafts exist. If so, show the drafts list page.
  // Uses response.clone() so the original Response body is not consumed,
  // which allows the same mock Response to be re-read by subsequent calls
  // (e.g. POST /drafts) when using mockResolvedValue in tests.
  useEffect(() => {
    Promise.resolve(fetch('/drafts'))
      .then(async (response) => {
        if (!response || typeof response.ok !== 'boolean' || !response.ok) {
          showErrorRef.current('Failed to load drafts.');
          setShowDraftsListLoading(false);
          return;
        }

        // Clone to avoid consuming the original response body
        const data = await response.clone().json().catch(() => []);

        if (Array.isArray(data) && data.length > 0) {
          setDraftsList(data as DraftListEntry[]);
          setShowDraftsList(true);
        }

        setShowDraftsListLoading(false);
      })
      .catch(() => {
        showErrorRef.current('Failed to load drafts.');
        setShowDraftsListLoading(false);
      });
  }, []);
  const view = showDraftsList ? 'drafts-list' : !draftState ? 'config' : showHistory ? 'history' : 'drafting';
  const completionBannerTeamName = draftState?.teams.find((team) => team.isUser)?.name ?? 'Your team';
  const showCompletionBanner = draftState?.status === 'completed' && !showHistory;

  // @spec DFF-UI-014
  // @spec DFF-UI-015
  async function handleStartDraft() {
    if (isSubmittingDraft) {
      return;
    }

    const safeConfig = sanitizeDraftConfig(draftConfig);
    setDraftConfig(safeConfig);
    setIsSubmittingDraft(true);
    setShowHistory(false);
    setShowDraftsList(false);

    try {
      await startDraft(safeConfig);
    } finally {
      setIsSubmittingDraft(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.16),_transparent_35%),linear-gradient(180deg,_#1c1917_0%,_#0c0a09_100%)] px-6 py-12 text-stone-100">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-7xl items-start justify-center">
        {/* @spec DFF-UI-116 */}
        {showDraftsListLoading ? <DraftsListLoadingState /> : null}

        {/* @spec DFF-UI-110 */}
        {!showDraftsListLoading && view === 'drafts-list' ? (
          <DraftsListPage
            drafts={draftsList}
            onNavigateToConfig={() => {
              setShowDraftsList(false);
            }}
            onNavigateToDrafting={() => {
              setShowDraftsList(false);
              setShowHistory(false);
            }}
            onNavigateToHistory={() => {
              setShowDraftsList(false);
              setShowHistory(true);
            }}
          />
        ) : null}

        {!showDraftsListLoading && view === 'config' ? (
          <DraftConfigScreen
            config={draftConfig}
            isSubmitting={isSubmittingDraft}
            onConfigChange={setDraftConfig}
            onStartDraft={handleStartDraft}
          />
        ) : null}

        {/* @spec DFF-UI-100 */}
        {/* @spec DFF-UI-130 */}
        {/* @spec DFF-UI-131 */}
        {/* @spec DFF-UI-138 */}
        {/* @spec DFF-UI-139 */}
        {!showDraftsListLoading && view === 'drafting' && draftState ? (
          <div className="flex w-full flex-col gap-6">
            <DraftStatusBar draftState={draftState} />
            <div
              data-testid="drafting-layout"
              className="grid w-full gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)]"
            >
              <div data-testid="draft-board-column" className="relative min-w-0">
                <DraftBoard draftState={draftState} isInteractionBlocked={showCompletionBanner} />
                {showCompletionBanner ? (
                  <DraftCompletionBanner
                    teamName={completionBannerTeamName}
                    onViewHistory={() => {
                      setShowHistory(true);
                    }}
                  />
                ) : null}
              </div>
              <div data-testid="available-players-column" className="min-w-0">
                <AvailablePlayersPanel draftState={draftState} />
              </div>
              <div data-testid="pick-feed-column" className="flex min-w-0">
                <PickFeedPanel draftState={draftState} />
              </div>
            </div>
          </div>
        ) : null}

        {/* @spec DFF-UI-060 */}
        {/* @spec DFF-UI-065 */}
        {!showDraftsListLoading && view === 'history' && draftState ? (
          <HistoryView
            draftState={draftState}
            onNewDraft={() => {
              setShowHistory(false);
              setShowDraftsList(false);
              setDraftConfig(configDefaults);
              newDraft();
            }}
          />
        ) : null}
      </div>
    </main>
  );
}
