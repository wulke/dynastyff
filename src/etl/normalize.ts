// @spec DFF-ETL-030
// @spec DFF-ETL-032
import type { NormalizedPlayer, RawPlayer } from './types.js';

export function normalizePlayers(players: readonly RawPlayer[]): NormalizedPlayer[] {
  if (players.length === 0) {
    return [];
  }

  if (players.length === 1) {
    return players.map((player) => ({
      ...player,
      normalizedValue: 9999,
    }));
  }

  const rawValues = players.map((player) => player.rawValue);
  const minValue = Math.min(...rawValues);
  const maxValue = Math.max(...rawValues);

  if (minValue === maxValue) {
    return players.map((player) => ({
      ...player,
      normalizedValue: 9999,
    }));
  }

  return players.map((player) => ({
    ...player,
    normalizedValue: Math.round(((player.rawValue - minValue) / (maxValue - minValue)) * 9999),
  }));
}
