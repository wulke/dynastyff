// @spec DFF-STATIC-013
// @spec DFF-UI-010
// @spec DFF-UI-014
import { useEffect, useState, type ReactNode } from 'react';
import * as Separator from '@radix-ui/react-separator';

import type { DraftConfig, ScoringFormat } from '../types.js';

export type ConfigFormState = DraftConfig;

// @spec DFF-UI-010
export const configDefaults: ConfigFormState = {
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

// @spec DFF-UI-010
const ROSTER_FIELDS: Array<{
  key: 'QB' | 'RB' | 'WR' | 'TE' | 'FLEX' | 'SF' | 'bench';
  label: string;
  min: number;
  max: number;
}> = [
  { key: 'QB', label: 'QB', min: 0, max: 4 },
  { key: 'RB', label: 'RB', min: 0, max: 8 },
  { key: 'WR', label: 'WR', min: 0, max: 8 },
  { key: 'TE', label: 'TE', min: 0, max: 4 },
  { key: 'FLEX', label: 'FLEX', min: 0, max: 5 },
  { key: 'SF', label: 'SF', min: 0, max: 3 },
  { key: 'bench', label: 'BN', min: 0, max: 20 },
];

// @spec DFF-UI-014
function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// @spec DFF-UI-010
// @spec DFF-UI-014
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

// @spec DFF-UI-010
// @spec DFF-UI-014
function getNumberValue(input: string, fallback: number, min: number, max: number) {
  return clamp(parseNumberInput(input, fallback), min, max);
}

// @spec DFF-UI-010
// @spec DFF-UI-014
export function sanitizeDraftConfig(config: ConfigFormState): ConfigFormState {
  const safeTeamCount = clamp(config.teamCount, 8, 16);

  return {
    ...config,
    teamCount: safeTeamCount,
    rounds: clamp(config.rounds, 10, 30),
    userPickPosition: clamp(config.userPickPosition, 1, safeTeamCount),
    futurePickYears: clamp(config.futurePickYears, 1, 5),
    rosterConfig: {
      QB: clamp(config.rosterConfig.QB, 0, 4),
      RB: clamp(config.rosterConfig.RB, 0, 8),
      WR: clamp(config.rosterConfig.WR, 0, 8),
      TE: clamp(config.rosterConfig.TE, 0, 4),
      FLEX: clamp(config.rosterConfig.FLEX, 0, 5),
      SF: clamp(config.rosterConfig.SF, 0, 3),
      bench: clamp(config.rosterConfig.bench, 0, 20),
    },
  };
}

// @spec DFF-UI-010
type NumberFieldProps = {
  id: string;
  label: string;
  min: number;
  max: number;
  value: number;
  disabled?: boolean;
  onChange: (nextValue: number) => void;
};

// @spec DFF-UI-010
// @spec DFF-UI-014
function NumberField({ id, label, min, max, value, disabled = false, onChange }: NumberFieldProps) {
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
        disabled={disabled}
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
        className="rounded-2xl border border-stone-700 bg-stone-950/80 px-4 py-3 text-base text-stone-50 outline-none transition focus:border-amber-300 disabled:cursor-not-allowed disabled:border-stone-800 disabled:text-stone-500"
      />
    </label>
  );
}

// @spec DFF-STATIC-013
// @spec DFF-UI-010
// @spec DFF-UI-014
type DraftConfigScreenProps = {
  config: ConfigFormState;
  isSubmitting: boolean;
  onConfigChange: (nextConfig: ConfigFormState) => void;
  onStartDraft: () => Promise<void>;
  description?: string;
  footerBadgeLabel?: string;
  startButtonLabel?: string;
  isSubmitDisabled?: boolean;
  supportingContent?: ReactNode;
};

// @spec DFF-STATIC-013
// @spec DFF-UI-010
// @spec DFF-UI-014
export function DraftConfigScreen({
  config,
  isSubmitting,
  onConfigChange,
  onStartDraft,
  description = 'Set the league structure, roster shape, and your draft slot before starting a mock.',
  footerBadgeLabel = 'Local-first mock setup',
  startButtonLabel,
  isSubmitDisabled = false,
  supportingContent,
}: DraftConfigScreenProps) {
  const submitDisabled = isSubmitting || isSubmitDisabled;

  return (
    <section className="w-full max-w-5xl rounded-[2rem] border border-stone-800 bg-stone-900/90 p-10 shadow-2xl shadow-black/20">
      <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">League Setup</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-50">Config Screen</h1>
      <p className="mt-3 max-w-3xl text-base leading-7 text-stone-300">{description}</p>
      {supportingContent ? <div className="mt-8">{supportingContent}</div> : null}
      <Separator.Root
        decorative
        orientation="horizontal"
        className="my-8 h-px w-full bg-gradient-to-r from-transparent via-stone-700 to-transparent"
      />
      <form
        className="space-y-8"
        onSubmit={async (event) => {
          event.preventDefault();

          if (submitDisabled) {
            return;
          }

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
            {ROSTER_FIELDS.map((field) => (
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
            disabled={submitDisabled}
            className="rounded-full bg-amber-300 px-5 py-2.5 text-sm font-semibold text-stone-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-stone-600 disabled:text-stone-300"
          >
            {startButtonLabel ?? (isSubmitting ? 'Starting Draft…' : 'Start Draft')}
          </button>
          <span className="rounded-full border border-stone-700 px-4 py-2 text-xs uppercase tracking-[0.25em] text-stone-400">
            {footerBadgeLabel}
          </span>
        </div>
      </form>
    </section>
  );
}
