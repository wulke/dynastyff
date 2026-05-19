// @spec DFF-UI-001
// @spec DFF-UI-002
// @spec DFF-UI-003
// @spec DFF-UI-004
// @spec DFF-UI-010
// @spec DFF-UI-014
// @spec DFF-UI-015
import { useEffect, useReducer, useState } from 'react';
import * as Separator from '@radix-ui/react-separator';

export type ViewState = 'config' | 'drafting' | 'history';

type ViewAction =
  | { type: 'draft_created' }
  | { type: 'draft_complete' }
  | { type: 'new_draft' };

type ScoringFormat = 'ppr' | 'half_ppr' | 'standard';

type RosterConfig = {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  FLEX: number;
  SF: number;
  bench: number;
};

type ConfigFormState = {
  name: string;
  teamCount: number;
  rounds: number;
  scoringFormat: ScoringFormat;
  userPickPosition: number;
  futurePickYears: number;
  rosterConfig: RosterConfig;
};

type DraftCreateResponse = {
  draftId?: string;
};

type ToastProps = {
  message: string;
};

const configDefaults: ConfigFormState = {
  name: '',
  teamCount: 12,
  rounds: 20,
  scoringFormat: 'ppr',
  userPickPosition: 6,
  futurePickYears: 3,
  rosterConfig: {
    QB: 1,
    RB: 2,
    WR: 3,
    TE: 1,
    FLEX: 1,
    SF: 1,
    bench: 6,
  },
};

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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function parseNumberInput(input: string, fallback: number) {
  if (input.trim() === '') {
    return fallback;
  }

  const parsed = Number.parseInt(input, 10);

  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return parsed;
}

function getNumberValue(input: string, fallback: number, min: number, max: number) {
  return clamp(parseNumberInput(input, fallback), min, max);
}

function DraftToast({ message }: ToastProps) {
  return (
    <div
      role="alert"
      className="fixed right-6 top-6 z-10 max-w-sm rounded-2xl border border-red-400/40 bg-red-950/90 px-4 py-3 text-sm text-red-100 shadow-2xl shadow-black/30"
    >
      {message}
    </div>
  );
}

type NumberFieldProps = {
  id: string;
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (nextValue: number) => void;
};

function NumberField({ id, label, min, max, value, onChange }: NumberFieldProps) {
  const [draftValue, setDraftValue] = useState(() => String(value));

  useEffect(() => {
    setDraftValue(String(value));
  }, [value]);

  return (
    <label className="flex flex-col gap-2 text-sm text-stone-200" htmlFor={id}>
      <span className="font-medium">{label}</span>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        value={draftValue}
        onChange={(event) => {
          const nextValue = event.target.value;
          setDraftValue(nextValue);

          if (nextValue.trim() === '') {
            return;
          }

          onChange(parseNumberInput(nextValue, value));
        }}
        onBlur={() => {
          const committedValue = getNumberValue(draftValue, value, min, max);
          setDraftValue(String(committedValue));
          onChange(committedValue);
        }}
        className="rounded-2xl border border-stone-700 bg-stone-950/80 px-4 py-3 text-base text-stone-50 outline-none transition focus:border-amber-300"
      />
    </label>
  );
}

type DraftConfigScreenProps = {
  config: ConfigFormState;
  isSubmitting: boolean;
  onConfigChange: (nextConfig: ConfigFormState) => void;
  onStartDraft: () => Promise<void>;
};

function DraftConfigScreen({
  config,
  isSubmitting,
  onConfigChange,
  onStartDraft,
}: DraftConfigScreenProps) {
  const rosterFields: Array<{ key: keyof RosterConfig; label: string; min: number; max: number }> = [
    { key: 'QB', label: 'QB', min: 0, max: 4 },
    { key: 'RB', label: 'RB', min: 0, max: 8 },
    { key: 'WR', label: 'WR', min: 0, max: 8 },
    { key: 'TE', label: 'TE', min: 0, max: 4 },
    { key: 'FLEX', label: 'FLEX', min: 0, max: 5 },
    { key: 'SF', label: 'SF', min: 0, max: 3 },
    { key: 'bench', label: 'BN', min: 0, max: 20 },
  ];

  return (
    <section className="w-full max-w-5xl rounded-[2rem] border border-stone-800 bg-stone-900/90 p-10 shadow-2xl shadow-black/20">
      <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">League Setup</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-50">Config Screen</h1>
      <p className="mt-3 max-w-3xl text-base leading-7 text-stone-300">
        Set the league structure, roster shape, and your draft slot before starting a mock.
      </p>
      <Separator.Root
        decorative
        orientation="horizontal"
        className="my-8 h-px w-full bg-gradient-to-r from-transparent via-stone-700 to-transparent"
      />
      <form
        className="space-y-8"
        onSubmit={async (event) => {
          event.preventDefault();
          await onStartDraft();
        }}
      >
        <div className="grid gap-6 md:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm text-stone-200" htmlFor="config-name">
            <span className="font-medium">Config Name</span>
            <input
              id="config-name"
              type="text"
              value={config.name}
              onChange={(event) => onConfigChange({ ...config, name: event.target.value })}
              className="rounded-2xl border border-stone-700 bg-stone-950/80 px-4 py-3 text-base text-stone-50 outline-none transition focus:border-amber-300"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm text-stone-200" htmlFor="scoring-format">
            <span className="font-medium">Scoring Format</span>
            <select
              id="scoring-format"
              value={config.scoringFormat}
              onChange={(event) =>
                onConfigChange({
                  ...config,
                  scoringFormat: event.target.value as ScoringFormat,
                })
              }
              className="rounded-2xl border border-stone-700 bg-stone-950/80 px-4 py-3 text-base text-stone-50 outline-none transition focus:border-amber-300"
            >
              <option value="ppr">PPR</option>
              <option value="half_ppr">Half PPR</option>
              <option value="standard">Standard</option>
            </select>
          </label>

          <NumberField
            id="team-count"
            label="Team Count"
            min={8}
            max={16}
            value={config.teamCount}
            onChange={(teamCount) =>
              onConfigChange({
                ...config,
                teamCount,
                userPickPosition: clamp(config.userPickPosition, 1, teamCount),
              })
            }
          />

          <NumberField
            id="rounds"
            label="Rounds"
            min={10}
            max={30}
            value={config.rounds}
            onChange={(rounds) => onConfigChange({ ...config, rounds })}
          />

          <NumberField
            id="pick-position"
            label="Pick Position"
            min={1}
            max={config.teamCount}
            value={config.userPickPosition}
            onChange={(userPickPosition) => onConfigChange({ ...config, userPickPosition })}
          />

          <NumberField
            id="future-pick-years"
            label="Future Pick Years"
            min={1}
            max={5}
            value={config.futurePickYears}
            onChange={(futurePickYears) => onConfigChange({ ...config, futurePickYears })}
          />
        </div>

        <div className="rounded-[1.5rem] border border-stone-800 bg-stone-950/70 p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-50">Roster Slots</h2>
              <p className="mt-1 text-sm text-stone-400">Adjust the starting lineup and bench counts.</p>
            </div>
            <span className="rounded-full border border-stone-700 px-4 py-2 text-xs uppercase tracking-[0.25em] text-stone-400">
              Total {Object.values(config.rosterConfig).reduce((total, slotCount) => total + slotCount, 0)}
            </span>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {rosterFields.map((field) => (
              <NumberField
                key={field.key}
                id={`roster-${field.key}`}
                label={field.label}
                min={field.min}
                max={field.max}
                value={config.rosterConfig[field.key]}
                onChange={(slotCount) =>
                  onConfigChange({
                    ...config,
                    rosterConfig: {
                      ...config.rosterConfig,
                      [field.key]: slotCount,
                    },
                  })
                }
              />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-full bg-amber-300 px-5 py-2.5 text-sm font-semibold text-stone-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-stone-600 disabled:text-stone-300"
          >
            {isSubmitting ? 'Starting Draft…' : 'Start Draft'}
          </button>
          <span className="rounded-full border border-stone-700 px-4 py-2 text-xs uppercase tracking-[0.25em] text-stone-400">
            Local-first mock setup
          </span>
        </div>
      </form>
    </section>
  );
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
  const [draftConfig, setDraftConfig] = useState<ConfigFormState>(configDefaults);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [isSubmittingDraft, setIsSubmittingDraft] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!toastMessage) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setToastMessage(null);
    }, 6000);

    return () => window.clearTimeout(timeoutId);
  }, [toastMessage]);

  async function handleStartDraft() {
    if (isSubmittingDraft) {
      return;
    }

    setIsSubmittingDraft(true);
    setToastMessage(null);

    try {
      const response = await fetch('/drafts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(draftConfig),
      });

      if (!response.ok) {
        throw new Error(`Draft creation failed with status ${response.status}`);
      }

      const responseData = (await response.json()) as DraftCreateResponse;
      setDraftId(responseData.draftId ?? null);
      dispatch({ type: 'draft_created' });
    } catch {
      setToastMessage('Draft creation failed. Check your config and try again.');
    } finally {
      setIsSubmittingDraft(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.16),_transparent_35%),linear-gradient(180deg,_#1c1917_0%,_#0c0a09_100%)] px-6 py-12 text-stone-100">
      {toastMessage ? <DraftToast message={toastMessage} /> : null}
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-6xl items-center justify-center">
        {view === 'config' ? (
          <DraftConfigScreen
            config={draftConfig}
            isSubmitting={isSubmittingDraft}
            onConfigChange={setDraftConfig}
            onStartDraft={handleStartDraft}
          />
        ) : null}

        {view === 'drafting' ? (
          <ViewShell
            eyebrow={draftId ? `Draft ${draftId}` : 'Drafting'}
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
            onAction={() => {
              setDraftId(null);
              setToastMessage(null);
              setDraftConfig(configDefaults);
              dispatch({ type: 'new_draft' });
            }}
          />
        ) : null}
      </div>
    </main>
  );
}
