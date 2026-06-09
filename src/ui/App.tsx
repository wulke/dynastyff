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
// @spec DFF-UI-011
// @spec DFF-UI-012
// @spec DFF-UI-013
// @spec DFF-UI-116
// @spec DFF-UI-115
// @spec DFF-UI-130
// @spec DFF-UI-131
// @spec DFF-UI-132
// @spec DFF-UI-133
// @spec DFF-UI-134
// @spec DFF-UI-135
// @spec DFF-UI-136
// @spec DFF-UI-137
// @spec DFF-UI-138
// @spec DFF-UI-139
// @spec DFF-UI-056
// @spec DFF-UI-057
// @spec DFF-UI-058
// @spec DFF-UI-059
// @spec DFF-UI-059b
// @spec DFF-UI-059c
// @spec DFF-UI-059d
// @spec DFF-UI-059e
// @spec DFF-UI-145
// @spec DFF-UI-146
// @spec DFF-UI-149
import { useState, useEffect, useRef, type ReactNode } from 'react';
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
import { DraftGradeSummaryView } from './components/DraftGradeSummaryView.js';
import { HistoryView } from './components/HistoryView.js';
import { TradeModal, type TradeComposerState } from './components/TradeModal.js';

type DraftCompletionBannerProps = {
  teamName: string;
  onViewGrade: () => void;
};

type DraftStatusSummary = {
  currentPickLabel: string;
  turnLabel: string;
};

type Theme = 'ember' | 'volt' | 'pitch';

const THEMES: { id: Theme; label: string }[] = [
  { id: 'ember', label: 'Ember' },
  { id: 'volt', label: 'Volt' },
  { id: 'pitch', label: 'Pitch' },
];

function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('dff-theme') as Theme) ?? 'ember',
  );

  function handleThemeChange(next: Theme) {
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('dff-theme', next);
  }

  return (
    <div className="flex items-center gap-0.5 rounded border border-default p-0.5">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={theme === t.id}
          onClick={() => handleThemeChange(t.id)}
          className={`rounded px-2.5 py-1 text-xs font-medium transition ${
            theme === t.id ? 'bg-accent text-accent-fg' : 'text-muted hover:text-secondary'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function AppHeader() {
  return (
    <header className="sticky top-0 z-50 flex h-10 items-center justify-between border-b border-default bg-surface px-4">
      <span className="font-condensed text-sm font-bold tracking-wide text-primary">DFF</span>
      <ThemeSwitcher />
    </header>
  );
}

type DraftColumnId = 'draft-board' | 'available-players' | 'pick-feed';

type DraftColumnDefinition = {
  id: DraftColumnId;
  label: string;
  testId: string;
  renderIcon: () => ReactNode;
};

type SavedLeagueConfigApiRecord = {
  id: string;
  name: string;
  team_count: number;
  rounds: number;
  scoring_format: 'ppr' | 'half_ppr' | 'standard';
  roster_slots: {
    QB: number;
    RB: number;
    WR: number;
    TE: number;
    FLEX: number;
    SF: number;
    BN: number;
  };
  pick_position: number;
  future_pick_years: number;
  created_at: string;
};

type SavedLeagueConfig = {
  id: string;
  name: string;
  createdAt: string;
  config: ConfigFormState;
};

const DRAFT_COLUMNS: DraftColumnDefinition[] = [
  {
    id: 'draft-board',
    label: 'Draft Board',
    testId: 'draft-board-column',
    renderIcon: () => (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M3 9h18M9 21V9" />
      </svg>
    ),
  },
  {
    id: 'available-players',
    label: 'Available Players',
    testId: 'available-players-column',
    renderIcon: () => (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M19 8v6M22 11h-6" />
      </svg>
    ),
  },
  {
    id: 'pick-feed',
    label: 'Pick Feed',
    testId: 'pick-feed-column',
    renderIcon: () => (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 20V10" />
        <path d="m18 20-6-6-6 6" />
        <path d="M6 4h12" />
      </svg>
    ),
  },
];

// @spec DFF-UI-131
// @spec DFF-UI-133
// @spec DFF-UI-137
function getDraftingLayoutClass(expandedColumn: DraftColumnId | null): string {
  if (expandedColumn === 'draft-board') {
    return 'grid w-full gap-6 transition-[grid-template-columns] duration-200 ease-out xl:grid-cols-[minmax(0,4fr)_minmax(4.5rem,0.45fr)_minmax(4.5rem,0.45fr)]';
  }

  if (expandedColumn === 'available-players') {
    return 'grid w-full gap-6 transition-[grid-template-columns] duration-200 ease-out xl:grid-cols-[minmax(4.5rem,0.45fr)_minmax(0,4fr)_minmax(4.5rem,0.45fr)]';
  }

  if (expandedColumn === 'pick-feed') {
    return 'grid w-full gap-6 transition-[grid-template-columns] duration-200 ease-out xl:grid-cols-[minmax(4.5rem,0.45fr)_minmax(4.5rem,0.45fr)_minmax(0,4fr)]';
  }

  return 'grid w-full gap-6 transition-[grid-template-columns] duration-200 ease-out xl:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)]';
}

// @spec DFF-UI-132
function getExpandButtonLabel(columnLabel: string): string {
  return `Expand ${columnLabel}`;
}

// @spec DFF-UI-011
function isSavedLeagueConfigApiRecord(value: unknown): value is SavedLeagueConfigApiRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<SavedLeagueConfigApiRecord>;
  const rosterSlots = candidate.roster_slots as Partial<SavedLeagueConfigApiRecord['roster_slots']> | undefined;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.team_count === 'number' &&
    typeof candidate.rounds === 'number' &&
    (candidate.scoring_format === 'ppr' ||
      candidate.scoring_format === 'half_ppr' ||
      candidate.scoring_format === 'standard') &&
    typeof candidate.pick_position === 'number' &&
    typeof candidate.future_pick_years === 'number' &&
    typeof candidate.created_at === 'string' &&
    Boolean(rosterSlots) &&
    typeof rosterSlots?.QB === 'number' &&
    typeof rosterSlots?.RB === 'number' &&
    typeof rosterSlots?.WR === 'number' &&
    typeof rosterSlots?.TE === 'number' &&
    typeof rosterSlots?.FLEX === 'number' &&
    typeof rosterSlots?.SF === 'number' &&
    typeof rosterSlots?.BN === 'number'
  );
}

// @spec DFF-UI-011
// @spec DFF-UI-012
// @spec DFF-UI-013
function toSavedLeagueConfig(record: SavedLeagueConfigApiRecord): SavedLeagueConfig {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.created_at,
    config: sanitizeDraftConfig({
      name: record.name,
      teamCount: record.team_count,
      rounds: record.rounds,
      scoringFormat: record.scoring_format,
      userPickPosition: record.pick_position,
      futurePickYears: record.future_pick_years,
      rosterConfig: {
        QB: record.roster_slots.QB,
        RB: record.roster_slots.RB,
        WR: record.roster_slots.WR,
        TE: record.roster_slots.TE,
        FLEX: record.roster_slots.FLEX,
        SF: record.roster_slots.SF,
        bench: record.roster_slots.BN,
      },
    }),
  };
}

// @spec DFF-UI-132
function ExpandColumnButton({
  label,
  disabled = false,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={getExpandButtonLabel(label)}
      disabled={disabled}
      onClick={onClick}
      className="rounded border border-default p-1.5 text-muted transition hover:border-strong hover:text-secondary disabled:cursor-not-allowed disabled:opacity-40"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 3h6v6" />
        <path d="M9 21H3v-6" />
        <path d="m21 3-7 7" />
        <path d="m3 21 7-7" />
      </svg>
    </button>
  );
}

// @spec DFF-UI-134
// @spec DFF-UI-135
function CollapsedColumnStrip({
  column,
  onExpand,
}: {
  column: DraftColumnDefinition;
  onExpand: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`${column.id}-collapsed-strip`}
      aria-label={getExpandButtonLabel(column.label)}
      onClick={onExpand}
      className="flex h-full min-h-[20rem] w-full items-center justify-center rounded-md border border-default bg-surface px-2 py-4 text-muted transition duration-200 hover:border-strong hover:text-secondary"
    >
      <span className="flex flex-col items-center gap-3">
        <span className="rounded border border-default p-1.5 text-muted">{column.renderIcon()}</span>
        <span className="[writing-mode:vertical-rl] rotate-180 text-[0.6rem] font-semibold uppercase tracking-widest">
          {column.label}
        </span>
      </span>
    </button>
  );
}

// @spec DFF-UI-116
function DraftsListLoadingState() {
  return (
    <section
      className="w-full max-w-5xl rounded-md border border-default bg-surface"
      aria-label="Loading drafts"
    >
      <div className="border-b border-default px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Drafts</p>
        <h1 className="font-condensed text-2xl font-bold tracking-tight text-primary">Loading drafts</h1>
        <p className="text-xs text-muted">Checking saved drafts before choosing the next view.</p>
      </div>
      <div aria-hidden="true" className="overflow-hidden">
        <div className="grid grid-cols-[1.4fr_0.9fr_1.2fr_0.7fr_0.7fr_0.9fr_1fr] gap-0 border-b border-default bg-app px-3 py-2">
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={`drafts-loading-header-${index}`} className="h-2.5 w-14 animate-pulse rounded bg-surface-raised" />
          ))}
        </div>
        {Array.from({ length: 4 }).map((_, rowIndex) => (
          <div
            key={`drafts-loading-row-${rowIndex}`}
            className="grid grid-cols-[1.4fr_0.9fr_1.2fr_0.7fr_0.7fr_0.9fr_1fr] items-center gap-3 border-b border-default px-3 py-2.5 last:border-b-0"
          >
            <div className="h-3 w-20 animate-pulse rounded bg-surface-raised" />
            <div className="h-4 w-20 animate-pulse rounded bg-surface-raised" />
            <div className="h-3 w-24 animate-pulse rounded bg-surface-raised" />
            <div className="h-3 w-8 animate-pulse rounded bg-surface-raised" />
            <div className="h-3 w-8 animate-pulse rounded bg-surface-raised" />
            <div className="h-3 w-14 animate-pulse rounded bg-surface-raised" />
            <div className="ml-auto h-6 w-20 animate-pulse rounded bg-surface-raised" />
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
    <section className="w-full max-w-4xl rounded-md border border-default bg-surface">
      <div className="border-b border-default px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">{eyebrow}</p>
          {statusBadge ? (
            <span className="rounded border border-default px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-muted">
              {statusBadge}
            </span>
          ) : null}
        </div>
        <h1 className="font-condensed text-2xl font-bold tracking-tight text-primary">{title}</h1>
        <p className="mt-1 max-w-2xl text-xs text-muted">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition hover:bg-accent-hover"
          >
            {actionLabel}
          </button>
        ) : null}
        <span className="rounded border border-default px-2 py-1 text-[0.65rem] uppercase tracking-wide text-muted">
          Tailwind + Radix scaffold
        </span>
      </div>
    </section>
  );
}

// @spec DFF-UI-003
// @spec DFF-UI-005
// @spec DFF-UI-007
// @spec DFF-UI-145
function DraftCompletionBanner({ teamName, onViewGrade }: DraftCompletionBannerProps) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      aria-label="Draft completion banner"
      data-testid="draft-completion-banner"
    >
      <section className="w-full max-w-md rounded-lg border border-accent/30 bg-surface-raised p-6 text-center shadow-lg">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Congratulations</p>
        <h2 className="font-condensed mt-2 text-2xl font-bold tracking-tight text-primary">You finished the draft</h2>
        <p className="mt-2 text-xs text-muted">
          {teamName} — review your post-draft grade, roster construction, and the room-wide results.
        </p>
        <button
          type="button"
          onClick={onViewGrade}
          className="mt-5 rounded bg-accent px-4 py-2 text-xs font-semibold text-accent-fg transition hover:bg-accent-hover"
        >
          View Draft Grade
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
      className="w-full rounded-md border border-default bg-surface px-3 py-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">Draft Status</p>
          <p className="font-condensed text-xl font-bold tracking-tight text-primary tabular-nums">{status.currentPickLabel}</p>
        </div>
        <div
          data-testid="draft-status-turn"
          className="rounded border border-default px-3 py-1 text-xs font-semibold text-secondary"
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

type ComposerSide = 'offered' | 'requested';

type PositionFilter = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE';

function areTradeAssetsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createTradeComposerState(targetTeamId: string, offeredAssets: unknown[] = [], requestedAssets: unknown[] = []): TradeComposerState {
  return {
    targetTeamId,
    offeredAssets,
    requestedAssets,
    offeredFilter: 'ALL',
    requestedFilter: 'ALL',
    status: 'editing',
    resultStatus: null,
  };
}

function DraftApp() {
  // @spec DFF-STATIC-061
  // @spec DFF-STATIC-062
  const { draftState, newDraft, showError, startDraft, respondToTrade, submitTradeOffer } = useDraftContext();
  const [draftConfig, setDraftConfig] = useState<ConfigFormState>(configDefaults);
  const [isSubmittingDraft, setIsSubmittingDraft] = useState(false);
  const [showGradeSummary, setShowGradeSummary] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showDraftsList, setShowDraftsList] = useState(false);
  const [draftsList, setDraftsList] = useState<DraftListEntry[]>([]);
  const [showDraftsListLoading, setShowDraftsListLoading] = useState(true);
  const [savedConfigs, setSavedConfigs] = useState<SavedLeagueConfig[]>([]);
  const [selectedSavedConfigId, setSelectedSavedConfigId] = useState('');
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [expandedColumn, setExpandedColumn] = useState<DraftColumnId | null>(null);
  const [dismissedTradeId, setDismissedTradeId] = useState<string | null>(null);
  const [tradeComposer, setTradeComposer] = useState<TradeComposerState | null>(null);
  const [composerTradeId, setComposerTradeId] = useState<string | null>(null);
  const showErrorRef = useRef(showError);

  useEffect(() => {
    showErrorRef.current = showError;
  }, [showError]);

  useEffect(() => {
    if (!draftState?.pendingTrade) {
      setDismissedTradeId(null);
    }
  }, [draftState?.pendingTrade]);

  // @spec DFF-UI-059c
  useEffect(() => {
    if (!composerTradeId || !draftState) {
      return;
    }

    const resolvedTrade = draftState.trades.find((trade) => trade.id === composerTradeId);

    if (!resolvedTrade) {
      return;
    }

    setTradeComposer((current) =>
      current
        ? {
            ...current,
            status: 'resolved',
            resultStatus: resolvedTrade.status === 'accepted' ? 'accepted' : 'declined',
          }
        : current,
    );
  }, [composerTradeId, draftState]);

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

  // @spec DFF-UI-011
  // @spec DFF-UI-011b
  useEffect(() => {
    Promise.resolve()
      .then(() => fetch('/configs'))
      .then(async (response) => {
        if (!response || typeof response.ok !== 'boolean' || !response.ok) {
          return;
        }

        const payload = await response.json().catch(() => []);

        if (!Array.isArray(payload)) {
          return;
        }

        setSavedConfigs(
          payload
            .filter(isSavedLeagueConfigApiRecord)
            .map((record) => toSavedLeagueConfig(record)),
        );
      })
      .catch(() => undefined);
  }, []);
  const view = showDraftsList
    ? 'drafts-list'
    : !draftState
      ? 'config'
      : showHistory
        ? 'history'
        : showGradeSummary
          ? 'grade-summary'
          : 'drafting';
  const completionBannerTeamName = draftState?.teams.find((team) => team.isUser)?.name ?? 'Your team';
  const showCompletionBanner = draftState?.status === 'completed' && !showHistory && !showGradeSummary;
  const showTradeModal =
    Boolean(draftState?.pendingTrade) &&
    draftState?.pendingTrade?.tradeId !== dismissedTradeId &&
    tradeComposer === null &&
    !showHistory &&
    !showGradeSummary &&
    draftState?.status !== 'completed';
  const showComposerModal =
    Boolean(tradeComposer) &&
    !showHistory &&
    !showGradeSummary &&
    draftState?.status !== 'completed';
  const isDraftInteractionBlocked = showCompletionBanner || showTradeModal || showComposerModal;

  // @spec DFF-UI-014
  // @spec DFF-UI-015
  async function handleStartDraft() {
    if (isSubmittingDraft) {
      return;
    }

    const safeConfig = sanitizeDraftConfig(draftConfig);
    setDraftConfig(safeConfig);
    setIsSubmittingDraft(true);
    setShowGradeSummary(false);
    setShowHistory(false);
    setShowDraftsList(false);
    setDismissedTradeId(null);
    setTradeComposer(null);
    setComposerTradeId(null);
    // @spec DFF-UI-136
    setExpandedColumn(null);

    try {
      await startDraft(safeConfig);
    } finally {
      setIsSubmittingDraft(false);
    }
  }

  // @spec DFF-UI-012
  function handleSavedConfigSelect(savedConfigId: string) {
    setSelectedSavedConfigId(savedConfigId);

    if (!savedConfigId) {
      return;
    }

    const selectedConfig = savedConfigs.find((savedConfig) => savedConfig.id === savedConfigId);

    if (!selectedConfig) {
      return;
    }

    setDraftConfig(selectedConfig.config);
  }

  // @spec DFF-UI-013
  // @spec DFF-UI-013b
  async function handleSaveConfig() {
    if (isSavingConfig) {
      return;
    }

    const safeConfig = sanitizeDraftConfig(draftConfig);
    setDraftConfig(safeConfig);
    setIsSavingConfig(true);

    try {
      const response = await fetch('/configs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          configName: safeConfig.name,
          teamCount: safeConfig.teamCount,
          rounds: safeConfig.rounds,
          scoringFormat: safeConfig.scoringFormat,
          pickPosition: safeConfig.userPickPosition,
          futurePickYears: safeConfig.futurePickYears,
          rosterSlots: {
            QB: safeConfig.rosterConfig.QB,
            RB: safeConfig.rosterConfig.RB,
            WR: safeConfig.rosterConfig.WR,
            TE: safeConfig.rosterConfig.TE,
            FLEX: safeConfig.rosterConfig.FLEX,
            SF: safeConfig.rosterConfig.SF,
            BN: safeConfig.rosterConfig.bench,
          },
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save config.');
      }

      const payload = await response.json().catch(() => null);

      if (!isSavedLeagueConfigApiRecord(payload)) {
        throw new Error('Failed to save config.');
      }

      const savedConfig = toSavedLeagueConfig(payload);

      setSavedConfigs((current) => {
        const filtered = current.filter((entry) => entry.id !== savedConfig.id);
        return [savedConfig, ...filtered];
      });
      setSelectedSavedConfigId(savedConfig.id);
      setDraftConfig(savedConfig.config);
    } catch {
      showErrorRef.current('Failed to save config.');
    } finally {
      setIsSavingConfig(false);
    }
  }

  // @spec DFF-UI-053
  // @spec DFF-UI-054
  // @spec DFF-UI-055
  async function handleTradeResponse(status: 'accepted' | 'declined' | 'force_declined') {
    const tradeId = draftState?.pendingTrade?.tradeId;

    if (!tradeId) {
      return;
    }

    const didRespond = await respondToTrade(status);

    if (didRespond) {
      setDismissedTradeId(tradeId);
    }
  }

  // @spec DFF-UI-056
  function handleOpenTradeComposer(targetTeamId: string) {
    setTradeComposer(createTradeComposerState(targetTeamId));
    setComposerTradeId(null);
  }

  // @spec DFF-UI-057
  function handleComposerTargetChange(targetTeamId: string) {
    setTradeComposer((current) =>
      current
        ? {
            ...current,
            targetTeamId,
            requestedAssets: [],
            requestedFilter: 'ALL',
          }
        : current,
    );
  }

  // @spec DFF-UI-058
  function handleComposerFilterChange(side: ComposerSide, filter: PositionFilter) {
    setTradeComposer((current) => {
      if (!current) {
        return current;
      }

      if (side === 'offered') {
        return {
          ...current,
          offeredFilter: filter,
        };
      }

      return {
        ...current,
        requestedFilter: filter,
      };
    });
  }

  // @spec DFF-UI-058
  function handleToggleComposerAsset(side: ComposerSide, asset: unknown) {
    setTradeComposer((current) => {
      if (!current || current.status !== 'editing') {
        return current;
      }

      const existingAssets = side === 'offered' ? current.offeredAssets : current.requestedAssets;
      const nextAssets = existingAssets.some((entry) => areTradeAssetsEqual(entry, asset))
        ? existingAssets.filter((entry) => !areTradeAssetsEqual(entry, asset))
        : [...existingAssets, asset];

      if (side === 'offered') {
        return {
          ...current,
          offeredAssets: nextAssets,
        };
      }

      return {
        ...current,
        requestedAssets: nextAssets,
      };
    });
  }

  // @spec DFF-UI-059
  // @spec DFF-UI-059b
  async function handleSubmitTradeComposer() {
    if (!tradeComposer || tradeComposer.status !== 'editing') {
      return;
    }

    const result = await submitTradeOffer(
      tradeComposer.targetTeamId,
      tradeComposer.offeredAssets,
      tradeComposer.requestedAssets,
    );

    if (!result.ok) {
      return;
    }

    setComposerTradeId(result.tradeId);
    setTradeComposer((current) =>
      current
        ? {
            ...current,
            status: 'awaiting',
          }
        : current,
    );
  }

  function handleCloseTradeComposer() {
    setTradeComposer(null);
    setComposerTradeId(null);
  }

  // @spec DFF-UI-059e
  function handleCounterTrade() {
    const pendingTrade = draftState?.pendingTrade;

    if (!pendingTrade || pendingTrade.isBotToBot) {
      return;
    }

    setDismissedTradeId(pendingTrade.tradeId);
    setTradeComposer(
      createTradeComposerState(
        pendingTrade.initiatingTeamId,
        pendingTrade.assetsReceived,
        pendingTrade.assetsSent,
      ),
    );
    setComposerTradeId(null);
  }

  return (
    <>
      <AppHeader />
      <main className="bg-app-gradient px-4 py-6 text-primary" style={{ minHeight: 'calc(100vh - 2.5rem)' }}>
      <div className="mx-auto flex max-w-7xl items-start justify-center" style={{ minHeight: 'calc(100vh - 2.5rem - 3rem)' }}>
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
              setShowGradeSummary(false);
              setShowHistory(false);
            }}
            onNavigateToReview={(draftStatus) => {
              setShowDraftsList(false);
              setShowGradeSummary(draftStatus === 'completed');
              setShowHistory(draftStatus !== 'completed');
            }}
          />
        ) : null}

        {!showDraftsListLoading && view === 'config' ? (
          <DraftConfigScreen
            config={draftConfig}
            isSubmitting={isSubmittingDraft}
            isSavingConfig={isSavingConfig}
            savedConfigs={savedConfigs.map((savedConfig) => ({
              id: savedConfig.id,
              name: savedConfig.name,
            }))}
            selectedSavedConfigId={selectedSavedConfigId}
            onConfigChange={setDraftConfig}
            onSavedConfigSelect={handleSavedConfigSelect}
            onSaveConfig={handleSaveConfig}
            onStartDraft={handleStartDraft}
          />
        ) : null}

        {/* @spec DFF-UI-100 */}
        {/* @spec DFF-UI-130 */}
        {/* @spec DFF-UI-131 */}
        {/* @spec DFF-UI-132 */}
        {/* @spec DFF-UI-133 */}
        {/* @spec DFF-UI-134 */}
        {/* @spec DFF-UI-135 */}
        {/* @spec DFF-UI-136 */}
        {/* @spec DFF-UI-137 */}
        {/* @spec DFF-UI-138 */}
        {/* @spec DFF-UI-139 */}
        {!showDraftsListLoading && view === 'drafting' && draftState ? (
          <div className="flex w-full flex-col gap-6">
            <DraftStatusBar draftState={draftState} />
            <div
              data-testid="drafting-layout"
              data-expanded-column={expandedColumn ?? 'none'}
              className={getDraftingLayoutClass(expandedColumn)}
            >
              {DRAFT_COLUMNS.map((column) => {
                const isCollapsed = expandedColumn !== null && expandedColumn !== column.id;

                return (
                  <div
                    key={column.id}
                    data-testid={column.testId}
                    className={`min-w-0 transition-all duration-200 ${column.id === 'draft-board' ? 'relative' : ''} ${
                      column.id === 'pick-feed' && !isCollapsed ? 'flex' : ''
                    }`}
                  >
                    {isCollapsed ? (
                      <CollapsedColumnStrip column={column} onExpand={() => setExpandedColumn(column.id)} />
                    ) : column.id === 'draft-board' ? (
                      <>
                        <DraftBoard
                          draftState={draftState}
                          isInteractionBlocked={isDraftInteractionBlocked}
                          onTeamHeaderClick={handleOpenTradeComposer}
                          headerAction={
                            <ExpandColumnButton
                              label={column.label}
                              disabled={showTradeModal || showComposerModal}
                              onClick={() => setExpandedColumn(column.id)}
                            />
                          }
                        />
                        {showCompletionBanner ? (
                          <DraftCompletionBanner
                            teamName={completionBannerTeamName}
                            onViewGrade={() => {
                              setShowGradeSummary(true);
                            }}
                          />
                        ) : null}
                      </>
                    ) : column.id === 'available-players' ? (
                        <AvailablePlayersPanel
                          draftState={draftState}
                          isInteractionBlocked={showTradeModal || showComposerModal}
                          headerAction={
                            <ExpandColumnButton
                              label={column.label}
                              disabled={showTradeModal || showComposerModal}
                              onClick={() => setExpandedColumn(column.id)}
                            />
                          }
                        />
                    ) : (
                      <PickFeedPanel
                        draftState={draftState}
                        headerAction={
                          <ExpandColumnButton
                            label={column.label}
                            disabled={showTradeModal || showComposerModal}
                            onClick={() => setExpandedColumn(column.id)}
                          />
                        }
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <TradeModal
              draftState={draftState}
              isOpen={showTradeModal || showComposerModal}
              composer={tradeComposer}
              onRespond={handleTradeResponse}
              onCounter={handleCounterTrade}
              onComposerTargetChange={handleComposerTargetChange}
              onComposerFilterChange={handleComposerFilterChange}
              onToggleComposerAsset={handleToggleComposerAsset}
              onSubmitComposer={handleSubmitTradeComposer}
              onCloseComposer={handleCloseTradeComposer}
            />
          </div>
        ) : null}

        {/* @spec DFF-UI-060 */}
        {/* @spec DFF-UI-065 */}
        {!showDraftsListLoading && view === 'history' && draftState ? (
          <HistoryView
            draftState={draftState}
            onNewDraft={() => {
              setShowGradeSummary(false);
              setShowHistory(false);
              setShowDraftsList(false);
              setSelectedSavedConfigId('');
              setDraftConfig(configDefaults);
              setDismissedTradeId(null);
              setTradeComposer(null);
              setComposerTradeId(null);
              newDraft();
            }}
          />
        ) : null}

        {!showDraftsListLoading && view === 'grade-summary' && draftState ? (
          <DraftGradeSummaryView
            draftState={draftState}
            onViewHistory={() => {
              setShowGradeSummary(false);
              setShowHistory(true);
            }}
            onNewDraft={() => {
              setShowGradeSummary(false);
              setShowHistory(false);
              setShowDraftsList(false);
              setSelectedSavedConfigId('');
              setDraftConfig(configDefaults);
              setDismissedTradeId(null);
              setTradeComposer(null);
              setComposerTradeId(null);
              newDraft();
            }}
          />
        ) : null}
      </div>
    </main>
    </>
  );
}
