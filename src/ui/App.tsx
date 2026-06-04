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
import { useState, useEffect, useRef, type ReactNode } from 'react';
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
import { TradeModal, type TradeComposerState } from './components/TradeModal.js';

type DraftCompletionBannerProps = {
  teamName: string;
  onViewHistory: () => void;
};

type DraftStatusSummary = {
  currentPickLabel: string;
  turnLabel: string;
};

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
      className="rounded-full border border-stone-700 p-2.5 text-stone-400 transition hover:border-stone-500 hover:text-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
      className="flex h-full min-h-[20rem] w-full items-center justify-center rounded-[1.75rem] border border-stone-800 bg-stone-900/90 px-3 py-5 text-stone-300 shadow-2xl shadow-black/20 transition duration-200 hover:border-stone-700 hover:text-stone-100"
    >
      <span className="flex flex-col items-center gap-4">
        <span className="rounded-full border border-stone-700 p-2 text-stone-400">{column.renderIcon()}</span>
        <span className="[writing-mode:vertical-rl] rotate-180 text-xs font-semibold uppercase tracking-[0.3em]">
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
  const view = showDraftsList ? 'drafts-list' : !draftState ? 'config' : showHistory ? 'history' : 'drafting';
  const completionBannerTeamName = draftState?.teams.find((team) => team.isUser)?.name ?? 'Your team';
  const showCompletionBanner = draftState?.status === 'completed' && !showHistory;
  const showTradeModal =
    Boolean(draftState?.pendingTrade) &&
    draftState?.pendingTrade?.tradeId !== dismissedTradeId &&
    tradeComposer === null &&
    !showHistory &&
    draftState?.status !== 'completed';
  const showComposerModal = Boolean(tradeComposer) && !showHistory && draftState?.status !== 'completed';
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
                            onViewHistory={() => {
                              setShowHistory(true);
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
  );
}
