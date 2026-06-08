// @spec DFF-STATIC-013
// @spec DFF-UI-010
// @spec DFF-UI-011
// @spec DFF-UI-012
// @spec DFF-UI-013
// @spec DFF-UI-014
import { useEffect, useState, type ReactNode } from 'react';

import type { DraftConfig, ScoringFormat } from '../types.js';

export type ConfigFormState = DraftConfig;

type SavedConfigOption = {
  id: string;
  name: string;
};

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
  if (input.trim() === '') return fallback;
  const parsed = Number.parseInt(input, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
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
    <label className="flex flex-col gap-1 text-xs text-secondary" htmlFor={id}>
      <span className="font-medium uppercase tracking-wide text-muted">{label}</span>
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
          if (nextValue.trim() === '') return;
          onChange(parseNumberInput(nextValue, value));
        }}
        onBlur={() => {
          const committedValue = getNumberValue(draftValue, value, min, max);
          setDraftValue(String(committedValue));
          onChange(committedValue);
        }}
        className="rounded border border-strong bg-app px-3 py-2 text-sm tabular-nums text-primary outline-none transition focus:border-accent disabled:cursor-not-allowed disabled:border-default disabled:text-muted"
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
  isSavingConfig?: boolean;
  savedConfigs?: SavedConfigOption[];
  selectedSavedConfigId?: string;
  onConfigChange: (nextConfig: ConfigFormState) => void;
  onSavedConfigSelect?: (savedConfigId: string) => void;
  onSaveConfig?: () => Promise<void>;
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
  isSavingConfig = false,
  savedConfigs = [],
  selectedSavedConfigId = '',
  onConfigChange,
  onSavedConfigSelect,
  onSaveConfig,
  onStartDraft,
  description = 'Set the league structure, roster shape, and your draft slot before starting a mock.',
  footerBadgeLabel = 'Local-first mock setup',
  startButtonLabel,
  isSubmitDisabled = false,
  supportingContent,
}: DraftConfigScreenProps) {
  const submitDisabled = isSubmitting || isSubmitDisabled;
  const canSaveConfig = !isSavingConfig && typeof onSaveConfig === 'function';

  return (
    <section className="w-full max-w-5xl rounded-md border border-default bg-surface">
      <div className="border-b border-default px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">League Setup</p>
        <h1 className="font-condensed text-2xl font-bold tracking-tight text-primary">Config Screen</h1>
        <p className="mt-1 max-w-3xl text-xs text-muted">{description}</p>
        {supportingContent ? <div className="mt-3">{supportingContent}</div> : null}
      </div>

      <form
        className="p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (submitDisabled) return;
          await onStartDraft();
        }}
      >
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-secondary" htmlFor="saved-configs">
              <span className="font-medium uppercase tracking-wide text-muted">Saved Configs</span>
              <select
                id="saved-configs"
                value={selectedSavedConfigId}
                onChange={(event) => onSavedConfigSelect?.(event.target.value)}
                className="rounded border border-strong bg-app px-3 py-2 text-sm text-primary outline-none transition focus:border-accent"
              >
                <option value="">Select a saved config</option>
                {savedConfigs.map((savedConfig) => (
                  <option key={savedConfig.id} value={savedConfig.id}>{savedConfig.name}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-secondary" htmlFor="config-name">
              <span className="font-medium uppercase tracking-wide text-muted">Config Name</span>
              <input
                id="config-name"
                type="text"
                value={config.name}
                onChange={(event) => onConfigChange({ ...config, name: event.target.value })}
                className="rounded border border-strong bg-app px-3 py-2 text-sm text-primary outline-none transition focus:border-accent"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-secondary" htmlFor="scoring-format">
              <span className="font-medium uppercase tracking-wide text-muted">Scoring Format</span>
              <select
                id="scoring-format"
                value={config.scoringFormat}
                onChange={(event) =>
                  onConfigChange({ ...config, scoringFormat: event.target.value as ScoringFormat })
                }
                className="rounded border border-strong bg-app px-3 py-2 text-sm text-primary outline-none transition focus:border-accent"
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
                onConfigChange({ ...config, teamCount, userPickPosition: clamp(config.userPickPosition, 1, teamCount) })
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

          <div className="rounded-md border border-default bg-app p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-condensed text-sm font-semibold text-primary">Roster Slots</h2>
                <p className="text-xs text-muted">Adjust the starting lineup and bench counts.</p>
              </div>
              <span className="rounded border border-default px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-muted tabular-nums">
                Total {Object.values(config.rosterConfig).reduce((total, slotCount) => total + slotCount, 0)}
              </span>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {ROSTER_FIELDS.map((field) => (
                <NumberField
                  key={field.key}
                  id={`roster-${field.key}`}
                  label={field.label}
                  min={field.min}
                  max={field.max}
                  value={config.rosterConfig[field.key]}
                  onChange={(slotCount) =>
                    onConfigChange({ ...config, rosterConfig: { ...config.rosterConfig, [field.key]: slotCount } })
                  }
                />
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-default pt-4">
            <button
              type="button"
              disabled={!canSaveConfig}
              onClick={() => {
                if (!canSaveConfig) return;
                void onSaveConfig();
              }}
              className="rounded border border-default px-3 py-1.5 text-xs font-semibold text-secondary transition hover:border-strong hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSavingConfig ? 'Saving…' : 'Save'}
            </button>
            <button
              type="submit"
              disabled={submitDisabled}
              className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {startButtonLabel ?? (isSubmitting ? 'Starting Draft…' : 'Start Draft')}
            </button>
            <span className="rounded border border-default px-2 py-1 text-[0.65rem] uppercase tracking-wide text-muted">
              {footerBadgeLabel}
            </span>
          </div>
        </div>
      </form>
    </section>
  );
}
