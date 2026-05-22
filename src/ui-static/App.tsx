// @spec DFF-STATIC-013
// @spec DFF-STATIC-014
// @spec DFF-STATIC-015
// @spec DFF-STATIC-016
import { useEffect, useState } from 'react';

import { DraftBoard } from '../ui/components/DraftBoard.js';
import { DraftConfigScreen, configDefaults, type ConfigFormState } from '../ui/components/DraftConfigScreen.js';
import { HistoryView } from '../ui/components/HistoryView.js';
import { useDraftContext } from '../ui/context/DraftContext.js';
import type { Snapshot } from '../ui/types.js';
import { InMemoryDraftContextProvider } from './InMemoryDraftContext.js';

type SnapshotLoadState =
  | { status: 'loading' }
  | { status: 'ready'; snapshot: Snapshot }
  | { status: 'error' };

const STALE_SNAPSHOT_MS = 30 * 24 * 60 * 60 * 1000;

// @spec DFF-STATIC-016
function isSnapshotStale(exportedAt: string) {
  const exportedAtTime = Date.parse(exportedAt);

  if (Number.isNaN(exportedAtTime)) {
    return false;
  }

  return Date.now() - exportedAtTime > STALE_SNAPSHOT_MS;
}

// @spec DFF-STATIC-014
// @spec DFF-STATIC-015
function FullScreenMessage({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-950 px-6 py-10 text-stone-50">
      <section className="w-full max-w-2xl rounded-[2rem] border border-stone-800 bg-stone-900/90 p-10 text-center shadow-2xl shadow-black/20">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">dynastyff static</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-4 text-base leading-7 text-stone-300">{detail}</p>
      </section>
    </main>
  );
}

// @spec DFF-STATIC-063
// @spec DFF-STATIC-036
// @spec DFF-STATIC-034
// @spec DFF-STATIC-035
function DraftRoom({ snapshot }: { snapshot: Snapshot }) {
  const { draftState, submitPick } = useDraftContext();

  if (!draftState) {
    return null;
  }

  // @spec DFF-STATIC-036
  // Completed static drafts expose `currentPickNumber = null`, so the turn indicator
  // must derive the active slot only when an open draft-order entry still exists.
  const currentPickSlot =
    draftState.currentPickNumber === null
      ? null
      : draftState.draftOrder[draftState.currentPickNumber - 1] ?? null;
  const currentTeam = currentPickSlot
    ? draftState.teams.find((team) => team.id === currentPickSlot.teamId) ?? null
    : null;
  const isUserTurn = Boolean(currentTeam?.isUser);

  return (
    <section className="w-full rounded-[2rem] border border-stone-800 bg-stone-900/90 p-8 shadow-2xl shadow-black/20">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">In-Browser Draft</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-stone-50">Draft Room</h1>
          <p className="mt-3 text-sm text-stone-300">
            Draft {draftState.draftId} · Pick {draftState.currentPickNumber ?? draftState.picks.length} of{' '}
            {draftState.draftOrder.length}
          </p>
        </div>
        <div className="rounded-full border border-stone-700 px-4 py-2 text-sm text-stone-200">
          {isUserTurn ? 'Your turn' : 'Bot is picking…'}
        </div>
      </div>

      <div className="mt-8">
        <DraftBoard draftState={draftState} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-[1.5rem] border border-stone-800 bg-stone-950/60 p-5">
          <h2 className="text-lg font-semibold text-stone-50">Available Players</h2>
          <ul className="mt-4 space-y-3">
            {draftState.availablePlayers.slice(0, 12).map((player) => (
              <li key={player.id}>
                <button
                  type="button"
                  onClick={() => submitPick(player.id)}
                  disabled={!isUserTurn}
                  className="flex w-full items-center justify-between rounded-2xl border border-stone-800 bg-stone-950/80 px-4 py-3 text-left transition hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="font-medium text-stone-100">{player.name}</span>
                  <span className="text-sm text-stone-400">
                    {player.position} · {player.dynastyValue}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-[1.5rem] border border-stone-800 bg-stone-950/60 p-5">
          <h2 className="text-lg font-semibold text-stone-50">Recent Picks</h2>
          <ul className="mt-4 space-y-3">
            {draftState.picks.slice(-10).reverse().map((pick) => {
              const draftedPlayer = snapshot.players.find((entry) => entry.id === pick.playerId) ?? null;
              const team = draftState.teams.find((entry) => entry.id === pick.teamId);

              return (
                <li key={pick.pickNumber} className="rounded-2xl border border-stone-800 px-4 py-3">
                  <p className="text-sm font-medium text-stone-100">
                    #{pick.pickNumber} · {team?.name ?? pick.teamId}
                  </p>
                  <p className="mt-1 text-sm text-stone-400">{draftedPlayer?.name ?? pick.playerId}</p>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </section>
  );
}

// @spec DFF-STATIC-070
// @spec DFF-STATIC-071
// @spec DFF-STATIC-072
// @spec DFF-UI-060
// @spec DFF-UI-065
function StaticHistoryView({ onNewDraft }: { onNewDraft: () => void }) {
  const { draftState } = useDraftContext();

  if (!draftState) {
    return null;
  }

  return <HistoryView draftState={draftState} onNewDraft={onNewDraft} />;
}

// @spec DFF-STATIC-063
function StaticDraftApp({ snapshot }: { snapshot: Snapshot }) {
  const { draftState, newDraft, startDraft } = useDraftContext();
  const [draftConfig, setDraftConfig] = useState<ConfigFormState>(configDefaults);
  const [isSubmittingDraft, setIsSubmittingDraft] = useState(false);
  const view = !draftState ? 'config' : draftState.status === 'completed' ? 'history' : 'drafting';

  async function handleStartDraft() {
    if (isSubmittingDraft) {
      return;
    }

    setIsSubmittingDraft(true);

    try {
      startDraft(draftConfig);
    } finally {
      setIsSubmittingDraft(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-950 px-6 py-10 text-stone-50">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        {view === 'config' ? (
          <DraftConfigScreen
            config={draftConfig}
            isSubmitting={isSubmittingDraft}
            onConfigChange={setDraftConfig}
            onStartDraft={handleStartDraft}
            supportingContent={
              <dl className="grid gap-4 text-sm text-stone-300 md:grid-cols-3">
                <div className="rounded-2xl border border-stone-800 bg-stone-950/60 p-4">
                  <dt className="text-xs uppercase tracking-[0.25em] text-stone-500">Players</dt>
                  <dd className="mt-2 text-2xl font-semibold text-stone-50">{snapshot.players.length}</dd>
                </div>
                <div className="rounded-2xl border border-stone-800 bg-stone-950/60 p-4">
                  <dt className="text-xs uppercase tracking-[0.25em] text-stone-500">Pick Values</dt>
                  <dd className="mt-2 text-2xl font-semibold text-stone-50">{snapshot.pickValues.length}</dd>
                </div>
                <div className="rounded-2xl border border-stone-800 bg-stone-950/60 p-4">
                  <dt className="text-xs uppercase tracking-[0.25em] text-stone-500">Exported</dt>
                  <dd className="mt-2 text-lg font-semibold text-stone-50">
                    {new Date(snapshot.exportedAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </dd>
                </div>
              </dl>
            }
          />
        ) : null}
        {view === 'drafting' ? <DraftRoom snapshot={snapshot} /> : null}
        {view === 'history' ? <StaticHistoryView onNewDraft={() => newDraft()} /> : null}
      </div>
    </main>
  );
}

// @spec DFF-STATIC-013
// @spec DFF-STATIC-014
// @spec DFF-STATIC-015
// @spec DFF-STATIC-016
export function App() {
  const [snapshotState, setSnapshotState] = useState<SnapshotLoadState>({ status: 'loading' });
  const [isStaleBannerDismissed, setIsStaleBannerDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadSnapshot() {
      try {
        const response = await fetch('./data/snapshot.json');

        if (!response.ok) {
          throw new Error(`Snapshot fetch failed with status ${response.status}`);
        }

        const snapshot = (await response.json()) as Snapshot;

        if (!Array.isArray(snapshot.players) || snapshot.players.length === 0) {
          throw new Error('Snapshot contains zero players');
        }

        if (!cancelled) {
          setSnapshotState({ status: 'ready', snapshot });
        }
      } catch {
        if (!cancelled) {
          setSnapshotState({ status: 'error' });
        }
      }
    }

    void loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, []);

  if (snapshotState.status === 'loading') {
    return (
      <FullScreenMessage
        title="Loading player data"
        detail="Downloading the latest static snapshot before the draft config becomes available."
      />
    );
  }

  if (snapshotState.status === 'error') {
    return (
      <FullScreenMessage
        title="Player data unavailable. Try refreshing."
        detail="The static app cannot start a draft until snapshot data loads successfully."
      />
    );
  }

  const staleSnapshot = isSnapshotStale(snapshotState.snapshot.exportedAt);

  return (
    <>
      {staleSnapshot && !isStaleBannerDismissed ? (
        <section
          className="mx-auto mt-6 flex w-[calc(100%-3rem)] max-w-6xl flex-col gap-4 rounded-[1.5rem] border border-amber-500/40 bg-amber-500/10 px-5 py-4 text-sm text-amber-50 md:flex-row md:items-center md:justify-between"
          role="status"
        >
          <p>Player data is over 30 days old</p>
          <button
            type="button"
            aria-label="Dismiss stale data warning"
            onClick={() => setIsStaleBannerDismissed(true)}
            className="rounded-full border border-amber-300/50 px-4 py-2 text-sm font-medium text-amber-50 transition hover:bg-amber-200/10"
          >
            Dismiss
          </button>
        </section>
      ) : null}
      <InMemoryDraftContextProvider snapshot={snapshotState.snapshot}>
        <StaticDraftApp snapshot={snapshotState.snapshot} />
      </InMemoryDraftContextProvider>
    </>
  );
}
