// @spec DFF-SM-060
// @spec DFF-SM-062
// @spec DFF-SM-063
// @spec DFF-SM-064
// @spec DFF-SM-065
// @spec DFF-SM-066
import type { LeagueContext, PlayerWithValue, RosterEntry } from './context.js';
import { evaluateRoster } from './rosterEvaluator.js';
import { nextSlotType } from './tradeScorer.js';

export type WaiverPlayer = {
  id: string;
  name: string;
  position: string;
  age: number | null;
  dynastyValue: number;
};

export type WaiverPairScore = {
  valueDeltaScore: number;
  positionalNeedScore: number;
  ageCurve: -1 | 0 | 1;
  rankScore: number;
};

export type WaiverPair = {
  add: WaiverPlayer;
  drop: WaiverPlayer | null;
  valueDelta: number;
  score: WaiverPairScore;
};

export type WaiverPairs = {
  pairs: WaiverPair[];
};

// Free agents are scored only at positions the Roster Evaluator grades.
const gradedPositions = new Set(['QB', 'RB', 'WR', 'TE']);
// Scoring is O(evaluateRoster) per candidate; the actionable waiver tier is the top of the pool.
export const freeAgentPoolCap = 50;
export const pairsPerPositionCap = 5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function userRosterValue(context: LeagueContext): number {
  return context.userRoster
    .filter((entry) => entry.slotType !== 'ir')
    .reduce((sum, entry) => sum + entry.dynastyValue, 0);
}

// @spec DFF-SM-063 — over the roster limit when non-IR players fill every league slot.
export function isOverRosterLimit(context: LeagueContext): boolean {
  const nonIrCount = context.userRoster.filter((entry) => entry.slotType !== 'ir').length;

  return nonIrCount >= context.league.rosterPositions.length;
}

// Eligible drop candidates: matched bench players (players-table ID present so the analyze
// endpoint can re-derive the pair). Taxi is developmental depth and never a waiver drop.
export function lowestValueBenchPlayer(context: LeagueContext, position: string): RosterEntry | null {
  const candidates = context.userRoster.filter(
    (entry) =>
      entry.position === position && entry.slotType === 'bench' && entry.playersId !== null,
  );

  let best: RosterEntry | null = null;

  for (const entry of candidates) {
    if (
      best === null ||
      entry.dynastyValue < best.dynastyValue ||
      (entry.dynastyValue === best.dynastyValue && entry.sleeperPlayerId < best.sleeperPlayerId)
    ) {
      best = entry;
    }
  }

  return best;
}

function toWaiverPlayer(entry: RosterEntry): WaiverPlayer {
  return {
    id: entry.playersId ?? entry.sleeperPlayerId,
    name: entry.name,
    position: entry.position,
    age: entry.age,
    dynastyValue: entry.dynastyValue,
  };
}

// The post-add roster: drop removed, free agent added under the slot-fill rule (DFF-SM-034).
function postAddRoster(
  context: LeagueContext,
  add: PlayerWithValue,
  drop: RosterEntry | null,
): RosterEntry[] {
  const roster =
    drop === null
      ? [...context.userRoster]
      : context.userRoster.filter(
          (entry) => entry.playersId !== drop.playersId || entry.playersId === null,
        );

  roster.push({
    sleeperPlayerId: `fa-${add.id}`,
    playersId: add.id,
    name: add.name,
    position: add.position,
    age: add.age,
    dynastyValue: add.dynastyValue,
    slotType: nextSlotType(roster, add.position, context.league.rosterPositions),
    matched: true,
  });

  return roster;
}

// @spec DFF-SM-064 — value delta, positional need gap, age curve. Shared by the listing
// endpoint and the analyze endpoint so both score identically.
export function scoreWaiverPair(
  context: LeagueContext,
  add: PlayerWithValue,
  drop: RosterEntry | null,
): { valueDelta: number; score: WaiverPairScore } {
  const valueDelta = add.dynastyValue - (drop?.dynastyValue ?? 0);
  const valueDeltaScore = clamp((100 * valueDelta) / Math.max(userRosterValue(context), 1), -100, 100);

  const before = evaluateRoster(context);
  const postRoster = postAddRoster(context, add, drop);
  const after = evaluateRoster({
    ...context,
    userRoster: postRoster,
    allRosters: context.allRosters.map((team) =>
      team.rosterId === context.userRosterId ? { ...team, players: postRoster } : team,
    ),
  });

  const positionalNeedScore = clamp(
    (after.positions[add.position]?.composite ?? 0) - (before.positions[add.position]?.composite ?? 0),
    -100,
    100,
  );

  const ageCurve: -1 | 0 | 1 =
    drop !== null && add.age !== null && drop.age !== null
      ? add.age < drop.age
        ? 1
        : add.age > drop.age
          ? -1
          : 0
      : 0;

  return {
    valueDelta,
    score: {
      valueDeltaScore,
      positionalNeedScore,
      ageCurve,
      rankScore: valueDeltaScore + positionalNeedScore,
    },
  };
}

function comparePairs(a: WaiverPair, b: WaiverPair): number {
  return (
    b.score.rankScore - a.score.rankScore ||
    b.valueDelta - a.valueDelta ||
    a.add.name.localeCompare(b.add.name)
  );
}

// @spec DFF-SM-060
// @spec DFF-SM-062
// @spec DFF-SM-063
// @spec DFF-SM-065
// @spec DFF-SM-066
export function scoreWaiverPairs(context: LeagueContext): WaiverPairs {
  const overLimit = isOverRosterLimit(context);

  const byPosition = new Map<string, WaiverPair[]>();

  for (const add of context.freeAgents.slice(0, freeAgentPoolCap)) {
    if (add.dynastyValue <= 0 || !gradedPositions.has(add.position)) {
      continue;
    }

    let drop: RosterEntry | null = null;

    if (overLimit) {
      drop = lowestValueBenchPlayer(context, add.position);

      // @spec DFF-SM-063 — over the limit with no droppable bench player at the position: skip.
      if (drop === null) {
        continue;
      }
    }

    const { valueDelta, score } = scoreWaiverPair(context, add, drop);

    // @spec DFF-SM-065 — strictly positive value delta, with a valid drop or none required.
    if (valueDelta <= 0) {
      continue;
    }

    const list = byPosition.get(add.position) ?? [];
    list.push({
      add: { ...add },
      drop: drop === null ? null : toWaiverPlayer(drop),
      valueDelta,
      score,
    });
    byPosition.set(add.position, list);
  }

  // @spec DFF-SM-066 — at most 5 per position group, then ranked overall.
  const pairs = [...byPosition.values()]
    .flatMap((list) => list.sort(comparePairs).slice(0, pairsPerPositionCap))
    .sort(comparePairs);

  return { pairs };
}
