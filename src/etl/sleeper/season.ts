// @spec DFF-SLS-070
// @spec DFF-SLS-071
// Derives the current NFL season year: the current calendar year once
// September begins, otherwise the previous calendar year.
export function deriveSeasonYear(now: Date): number {
  const month = now.getUTCMonth() + 1;

  return month >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}
