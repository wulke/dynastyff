// @spec DFF-UI-001
// @spec DFF-UI-002
// @spec DFF-UI-003
// @spec DFF-UI-004
// @spec DFF-UI-010
// @spec DFF-UI-014
// @spec DFF-UI-015
// @spec DFF-STATIC-060
// @spec DFF-STATIC-061
// @spec DFF-STATIC-062
// @spec DFF-UI-082
import { useState } from 'react';
import * as Separator from '@radix-ui/react-separator';
import {
  HttpDraftContextProvider,
  useDraftContext,
} from './context/DraftContext.js';
import { DraftConfigScreen, configDefaults, sanitizeDraftConfig, type ConfigFormState } from './components/DraftConfigScreen.js';
import { DraftBoard } from './components/DraftBoard.js';
import { PickFeedPanel } from './components/PickFeedPanel.js';
import { HistoryView } from './components/HistoryView.js';

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

// @spec DFF-UI-001
// @spec DFF-UI-002
// @spec DFF-UI-003
// @spec DFF-UI-004
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

function DraftApp() {
  // @spec DFF-STATIC-061
  // @spec DFF-STATIC-062
  const { draftState, newDraft, startDraft } = useDraftContext();
  const [draftConfig, setDraftConfig] = useState<ConfigFormState>(configDefaults);
  const [isSubmittingDraft, setIsSubmittingDraft] = useState(false);
  const view = !draftState ? 'config' : draftState.status === 'completed' ? 'history' : 'drafting';

  // @spec DFF-UI-014
  // @spec DFF-UI-015
  async function handleStartDraft() {
    if (isSubmittingDraft) {
      return;
    }

    const safeConfig = sanitizeDraftConfig(draftConfig);
    setDraftConfig(safeConfig);
    setIsSubmittingDraft(true);

    try {
      await startDraft(safeConfig);
    } finally {
      setIsSubmittingDraft(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.16),_transparent_35%),linear-gradient(180deg,_#1c1917_0%,_#0c0a09_100%)] px-6 py-12 text-stone-100">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-7xl items-start justify-center">
        {view === 'config' ? (
          <DraftConfigScreen
            config={draftConfig}
            isSubmitting={isSubmittingDraft}
            onConfigChange={setDraftConfig}
            onStartDraft={handleStartDraft}
          />
        ) : null}

        {view === 'drafting' && draftState ? (
          <div className="flex w-full flex-col gap-6 lg:flex-row">
            <div className="min-w-0 flex-1">
              <DraftBoard draftState={draftState} />
            </div>
            <div className="w-full shrink-0 lg:w-80">
              <PickFeedPanel draftState={draftState} />
            </div>
          </div>
        ) : null}

        {/* @spec DFF-UI-060 */}
        {/* @spec DFF-UI-065 */}
        {view === 'history' && draftState ? (
          <HistoryView
            draftState={draftState}
            onNewDraft={() => {
              setDraftConfig(configDefaults);
              newDraft();
            }}
          />
        ) : null}
      </div>
    </main>
  );
}
