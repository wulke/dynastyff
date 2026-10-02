// @spec DFF-BOT-064
export type RealisticFixturePlayer = {
  id: string;
  name: string;
  position: 'QB' | 'RB' | 'WR' | 'TE';
  nflTeam: string;
  age: number;
  isRookie: boolean;
  dynastyValue: number;
};

const nflTeams = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SF', 'SEA', 'TB', 'TEN', 'WAS',
] as const;

const positionCounts = { QB: 60, RB: 100, WR: 110, TE: 30 } as const;

// @spec DFF-BOT-064
function playerValue(position: RealisticFixturePlayer['position'], index: number): number {
  const baseValue = { QB: 9800, RB: 9000, WR: 9300, TE: 7800 }[position];
  const decay = { QB: 105, RB: 78, WR: 68, TE: 125 }[position];

  return Math.max(450, baseValue - index * decay);
}

// @spec DFF-BOT-064
function playerAge(position: RealisticFixturePlayer['position'], index: number): number {
  const baseAge = { QB: 22, RB: 21, WR: 21, TE: 22 }[position];

  return baseAge + (index % 10);
}

// @spec DFF-BOT-064
export function buildRealisticPlayerPool(): RealisticFixturePlayer[] {
  return (Object.keys(positionCounts) as RealisticFixturePlayer['position'][]).flatMap((position) =>
    Array.from({ length: positionCounts[position] }, (_, index) => {
      const age = playerAge(position, index);

      return {
        id: `fixture-${position.toLowerCase()}-${index + 1}`,
        name: `${position} Prospect ${index + 1}`,
        position,
        nflTeam: nflTeams[index % nflTeams.length]!,
        age,
        isRookie: age <= 22 && index % 3 === 0,
        dynastyValue: playerValue(position, index),
      };
    }),
  );
}
