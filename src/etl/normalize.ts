// @spec DFF-ETL-030
// @spec DFF-ETL-032
import type { NormalizedPickValue, NormalizedPlayer, RawPickValue, RawPlayer } from './types.js';

function normalizeValues<T extends { rawValue: number }>(entries: readonly T[]): Array<T & { normalizedValue: number }> {
  if (entries.length === 0) {
    return [];
  }

  if (entries.length === 1) {
    return entries.map((entry) => ({
      ...entry,
      normalizedValue: 9999,
    }));
  }

  const rawValues = entries.map((entry) => entry.rawValue);
  const minValue = Math.min(...rawValues);
  const maxValue = Math.max(...rawValues);

  if (minValue === maxValue) {
    return entries.map((entry) => ({
      ...entry,
      normalizedValue: 9999,
    }));
  }

  return entries.map((entry) => ({
    ...entry,
    normalizedValue: Math.round(((entry.rawValue - minValue) / (maxValue - minValue)) * 9999),
  }));
}

// @spec DFF-ETL-030
// @spec DFF-ETL-032
export function normalizePlayers(players: readonly RawPlayer[]): NormalizedPlayer[] {
  return normalizeValues(players);
}

// @spec DFF-ETL-030
// @spec DFF-ETL-032
export function normalizePickValues(pickValues: readonly RawPickValue[]): NormalizedPickValue[] {
  return normalizeValues(pickValues);
}
