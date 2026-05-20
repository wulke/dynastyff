// @spec DFF-ETL-030
// @spec DFF-ETL-032
import type { NormalizedPickValue, NormalizedPlayer, RawPickValue, RawPlayer } from './types.js';

export type NormalizationContext = {
  minRawValue: number;
  maxRawValue: number;
  useFallbackValue: boolean;
};

type NormalizeOptions = {
  source?: string;
  valueType?: 'player' | 'pick value';
  warn?: (message: string) => void;
};

function maybeWarnOnDegenerateInput<T extends { rawValue: number }>(
  entries: readonly T[],
  options?: NormalizeOptions,
): void {
  if (!options?.warn || !options.source || !options.valueType || entries.length === 0) {
    return;
  }

  if (entries.length === 1) {
    options.warn(
      `[ETL] WARN: ${options.source} returned exactly one ${options.valueType}; assigning normalized value 9999.`,
    );
    return;
  }

  const rawValues = entries.map((entry) => entry.rawValue);
  const minValue = Math.min(...rawValues);
  const maxValue = Math.max(...rawValues);

  if (minValue === maxValue) {
    options.warn(
      `[ETL] WARN: ${options.source} returned ${entries.length} ${options.valueType} rows with the same raw value; assigning normalized value 9999.`,
    );
  }
}

// @spec DFF-ETL-030
// @spec DFF-ETL-031
// @spec DFF-ETL-032
export function createNormalizationContext<T extends { rawValue: number }>(
  entries: readonly T[],
): NormalizationContext | undefined {
  if (entries.length === 0) {
    return undefined;
  }

  if (entries.length === 1) {
    return {
      minRawValue: entries[0].rawValue,
      maxRawValue: entries[0].rawValue,
      useFallbackValue: true,
    };
  }

  const rawValues = entries.map((entry) => entry.rawValue);
  const minValue = Math.min(...rawValues);
  const maxValue = Math.max(...rawValues);

  if (minValue === maxValue) {
    return {
      minRawValue: minValue,
      maxRawValue: maxValue,
      useFallbackValue: true,
    };
  }

  return {
    minRawValue: minValue,
    maxRawValue: maxValue,
    useFallbackValue: false,
  };
}

// @spec DFF-ETL-030
// @spec DFF-ETL-031
// @spec DFF-ETL-032
export function normalizeRawValue(rawValue: number, context: NormalizationContext): number {
  if (context.useFallbackValue) {
    return 9999;
  }

  return Math.round(
    ((rawValue - context.minRawValue) / (context.maxRawValue - context.minRawValue)) * 9999,
  );
}

function normalizeValues<T extends { rawValue: number }>(
  entries: readonly T[],
  options?: NormalizeOptions,
): Array<T & { normalizedValue: number }> {
  const context = createNormalizationContext(entries);

  if (!context) {
    return [];
  }

  maybeWarnOnDegenerateInput(entries, options);

  return entries.map((entry) => ({
    ...entry,
    normalizedValue: normalizeRawValue(entry.rawValue, context),
  }));
}

// @spec DFF-ETL-030
// @spec DFF-ETL-032
export function normalizePlayers(
  players: readonly RawPlayer[],
  options?: NormalizeOptions,
): NormalizedPlayer[] {
  return normalizeValues(players, options);
}

// @spec DFF-ETL-031
// @spec DFF-ETL-032
export function normalizePickValues(
  pickValues: readonly RawPickValue[],
  options?: NormalizeOptions,
): NormalizedPickValue[] {
  return normalizeValues(pickValues, options);
}
