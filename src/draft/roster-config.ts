export type DraftRosterConfig = {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  FLEX: number;
  SF: number;
  bench: number;
};

export function parseDraftRosterConfig(value: string): DraftRosterConfig {
  const parsed = JSON.parse(value) as Partial<DraftRosterConfig>;

  if (
    typeof parsed.QB !== 'number' ||
    typeof parsed.RB !== 'number' ||
    typeof parsed.WR !== 'number' ||
    typeof parsed.TE !== 'number' ||
    typeof parsed.FLEX !== 'number' ||
    typeof parsed.SF !== 'number' ||
    typeof parsed.bench !== 'number'
  ) {
    throw new Error('Invalid draft roster_config JSON.');
  }

  return {
    QB: parsed.QB,
    RB: parsed.RB,
    WR: parsed.WR,
    TE: parsed.TE,
    FLEX: parsed.FLEX,
    SF: parsed.SF,
    bench: parsed.bench,
  };
}
