// @spec DFF-UI-001
// @spec DFF-UI-002
// @spec DFF-UI-003
// @spec DFF-UI-004
import { useReducer } from 'react';
import * as Separator from '@radix-ui/react-separator';

export type ViewState = 'config' | 'drafting' | 'history';

type ViewAction =
  | { type: 'draft_created' }
  | { type: 'draft_complete' }
  | { type: 'new_draft' };

export function viewStateReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case 'draft_created':
      return 'drafting';
    case 'draft_complete':
      return 'history';
    case 'new_draft':
      return 'config';
    default:
      return state;
  }
}

type ShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
};

function ViewShell({ eyebrow, title, description, actionLabel, onAction }: ShellProps) {
  return (
    <section className="w-full max-w-4xl rounded-[2rem] border border-stone-800 bg-stone-900/90 p-10 shadow-2xl shadow-black/20">
      <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">{eyebrow}</p>
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

export function App() {
  const [view, dispatch] = useReducer(viewStateReducer, 'config');

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.16),_transparent_35%),linear-gradient(180deg,_#1c1917_0%,_#0c0a09_100%)] px-6 py-12 text-stone-100">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-6xl items-center justify-center">
        {view === 'config' ? (
          <ViewShell
            eyebrow="View State"
            title="Config Screen"
            description="This shell is the default entry view. The real league configuration form will be added on the next UI slice."
            actionLabel="Start Draft"
            onAction={() => dispatch({ type: 'draft_created' })}
          />
        ) : null}

        {view === 'drafting' ? (
          <ViewShell
            eyebrow="Drafting"
            title="Draft Shell"
            description="This shell reserves the drafting surface for the board, player list, advisor panel, and trade modal."
            actionLabel="Complete Draft"
            onAction={() => dispatch({ type: 'draft_complete' })}
          />
        ) : null}

        {view === 'history' ? (
          <ViewShell
            eyebrow="History"
            title="History Shell"
            description="This shell reserves the post-draft review experience for pick logs, roster snapshots, and trade history."
            actionLabel="New Draft"
            onAction={() => dispatch({ type: 'new_draft' })}
          />
        ) : null}
      </div>
    </main>
  );
}
