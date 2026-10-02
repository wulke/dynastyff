// @spec DFF-STATIC-013
// @spec DFF-STATIC-014
// @spec DFF-STATIC-015
// @spec DFF-STATIC-016
// @spec DFF-UI-152
// @spec DFF-UI-153
// @spec DFF-UI-157
import { useEffect, useState } from 'react';

import { DraftApp } from '../ui/App.js';
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

// @spec DFF-STATIC-013
// @spec DFF-STATIC-014
// @spec DFF-STATIC-015
// @spec DFF-STATIC-016
// @spec DFF-UI-152
// @spec DFF-UI-153
// @spec DFF-UI-157
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
        <DraftApp />
      </InMemoryDraftContextProvider>
    </>
  );
}
