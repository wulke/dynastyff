// @spec DFF-SM-050
// @spec DFF-SM-051
// @spec DFF-SM-052
// @spec DFF-SM-053
// @spec DFF-SM-054
// @spec DFF-SM-055
// @spec DFF-SM-056
// @spec DFF-SM-088
import {
  leagueMedianBenchDepth,
  type LeagueContext,
  type RosterEntry,
  type SleeperTradeOfferRecord,
  type TeamRoster,
} from './context.js';
import { evaluateRoster } from './rosterEvaluator.js';
import { ownedPicks, scoreTrade, type TradeScore } from './tradeScorer.js';

export type TradeCandidateGroup = 'qb' | 'rb' | 'wr' | 'te' | 'picks' | 'sell';

export type TradeCandidate = {
  teamRosterId: number;
  teamName: string;
  group: TradeCandidateGroup;
  rationale: string;
  score: TradeScore;
  offer: SleeperTradeOfferRecord;
};

export type TradeRecommendations = {
  groups: Record<TradeCandidateGroup, { label: string; candidates: TradeCandidate[] }>;
};

const positionGroups = ['QB', 'RB', 'WR', 'TE'] as const;
type PositionGroup = (typeof positionGroups)[number];

const groupLabels: Record<TradeCandidateGroup, string> = {
  qb: 'QB targets',
  rb: 'RB targets',
  wr: 'WR targets',
  te: 'TE targets',
  picks: 'Pick acquisitions',
  sell: 'Value sells',
};

// Letter-grade bands from the Roster Evaluator: composite >= 70 is B or better ("C or below" = < 70).
const gradeBThreshold = 70;
const agingThreshold = 30;

type TeamOutlook = {
  team: TeamRoster;
  composites: Record<PositionGroup, number>;
  surplus: Set<PositionGroup>;
  needs: Set<PositionGroup>;
};

function nonStarters(team: TeamRoster, position: PositionGroup): RosterEntry[] {
  // Bench + taxi are the spare parts; IR is never trade bait here (DFF-SM-084 spirit).
  return team.players.filter(
    (entry) => entry.position === position && (entry.slotType === 'bench' || entry.slotType === 'taxi'),
  );
}

function benchDepth(team: TeamRoster, position: PositionGroup): number {
  return nonStarters(team, position).reduce((sum, entry) => sum + entry.dynastyValue, 0);
}

function bestBy<T>(
  items: T[],
  score: (item: T) => number,
  tiebreak: (a: T, b: T) => number,
): T | null {
  let best: T | null = null;

  for (const item of items) {
    if (best === null || score(item) > score(best) || (score(item) === score(best) && tiebreak(item, best) < 0)) {
      best = item;
    }
  }

  return best;
}

function byValueThenId(a: RosterEntry, b: RosterEntry): number {
  return b.dynastyValue - a.dynastyValue || a.sleeperPlayerId.localeCompare(b.sleeperPlayerId);
}

// @spec DFF-SM-051 — surplus: grade A/B and bench depth above the league-median bench depth.
function outlookFor(context: LeagueContext, team: TeamRoster): TeamOutlook {
  // Other teams are graded by evaluating the same context with the user pointer moved.
  const evaluation = evaluateRoster({ ...context, userRosterId: team.rosterId });

  const composites = {} as Record<PositionGroup, number>;
  const surplus = new Set<PositionGroup>();
  const needs = new Set<PositionGroup>();

  for (const position of positionGroups) {
    const composite = evaluation.positions[position]?.composite ?? 50;
    composites[position] = composite;

    if (composite < gradeBThreshold) {
      needs.add(position);
    }

    const medianDepth = leagueMedianBenchDepth(context.allRosters, position);

    if (composite >= gradeBThreshold && benchDepth(team, position) > medianDepth) {
      surplus.add(position);
    }
  }

  return { team, composites, surplus, needs };
}

function bestPickFor(
  picks: ReturnType<typeof ownedPicks>,
  rosterId: number,
): ReturnType<typeof ownedPicks>[number] | null {
  const owned = picks.filter((pick) => pick.ownerId === rosterId && pick.value > 0);

  return bestBy(
    owned,
    (pick) => pick.value,
    (a, b) => a.season.localeCompare(b.season) || a.round - b.round,
  );
}

function bestAgingPlayer(team: TeamRoster, position: PositionGroup): RosterEntry | null {
  const aging = team.players.filter(
    (entry) => entry.position === position && entry.slotType !== 'ir' && (entry.age ?? 0) >= agingThreshold,
  );

  return bestBy(aging, (entry) => entry.dynastyValue, byValueThenId);
}

function bestNonStarter(team: TeamRoster, position: PositionGroup): RosterEntry | null {
  return bestBy(nonStarters(team, position), (entry) => entry.dynastyValue, byValueThenId);
}

function closestValueNonStarter(
  team: TeamRoster,
  position: PositionGroup,
  target: number,
): RosterEntry | null {
  // Closest dynasty value to the outbound asset; ties break to the higher value, then the
  // lower player ID, for determinism (DFF-SM-088).
  return bestBy(
    nonStarters(team, position),
    (entry) => -Math.abs(entry.dynastyValue - target),
    byValueThenId,
  );
}

// @spec DFF-SM-088 — synthetic negative IDs can never collide with Sleeper transaction IDs.
function syntheticTransactionId(counterpartyId: number, seq: number): number {
  return -(counterpartyId * 1000 + seq);
}

function buildCandidate(
  context: LeagueContext,
  counterparty: TeamOutlook,
  seq: number,
  outbound: RosterEntry,
  inboundPlayer: RosterEntry | null,
  inboundPick: { season: string; round: number } | null,
  group: TradeCandidateGroup,
  rationale: string,
  now: () => Date,
): TradeCandidate {
  const adds: Record<string, number> = { [outbound.sleeperPlayerId]: counterparty.team.rosterId };
  const drops: Record<string, number> = { [outbound.sleeperPlayerId]: context.userRosterId };
  const draftPicks: unknown[] = [];

  if (inboundPlayer !== null) {
    adds[inboundPlayer.sleeperPlayerId] = context.userRosterId;
    drops[inboundPlayer.sleeperPlayerId] = counterparty.team.rosterId;
  }

  if (inboundPick !== null) {
    draftPicks.push({
      season: inboundPick.season,
      round: inboundPick.round,
      roster_id: counterparty.team.rosterId,
      previous_owner_id: counterparty.team.rosterId,
      owner_id: context.userRosterId,
    });
  }

  const offer: SleeperTradeOfferRecord = {
    transactionId: syntheticTransactionId(counterparty.team.rosterId, seq),
    status: 'hypothetical',
    proposerRosterId: counterparty.team.rosterId,
    responderRosterIds: [context.userRosterId],
    adds,
    drops,
    draftPicks,
    createdAt: now().toISOString(),
  };

  return {
    teamRosterId: counterparty.team.rosterId,
    teamName: counterparty.team.displayName,
    group,
    rationale,
    score: scoreTrade(context, offer),
    offer,
  };
}

type Draft = { candidate: TradeCandidate; key: string };

function draftCandidatesFor(
  context: LeagueContext,
  counterparty: TeamOutlook,
  user: TeamOutlook,
  picks: ReturnType<typeof ownedPicks>,
  now: () => Date,
): Draft[] {
  const drafts: Draft[] = [];
  let seq = 0;

  const push = (
    outbound: RosterEntry,
    inboundPlayer: RosterEntry | null,
    inboundPick: { season: string; round: number } | null,
    group: TradeCandidateGroup,
    rationale: string,
    inboundKey: string,
  ) => {
    seq += 1;
    drafts.push({
      candidate: buildCandidate(context, counterparty, seq, outbound, inboundPlayer, inboundPick, group, rationale, now),
      key: `${counterparty.team.rosterId}:${outbound.sleeperPlayerId}:${inboundKey}`,
    });
  };

  // 1. Value sells — aging (30+) assets out, best future pick in. Generated first so the
  //    sell group takes precedence over an identical pick-acquisition triple (DFF-SM-088).
  for (const position of positionGroups) {
    if (!counterparty.needs.has(position)) {
      continue;
    }

    const aging = bestAgingPlayer(user.team, position);
    const pick = bestPickFor(picks, counterparty.team.rosterId);

    if (aging !== null && pick !== null) {
      push(aging, null, pick, 'sell', `Sell aging ${position} for draft capital`, `pick:${pick.season}:${pick.round}`);
    }
  }

  // 2. Pick acquisitions — surplus depth out, best future pick in.
  for (const position of positionGroups) {
    if (!user.surplus.has(position) || !counterparty.needs.has(position)) {
      continue;
    }

    const outbound = bestNonStarter(user.team, position);
    const pick = bestPickFor(picks, counterparty.team.rosterId);

    if (outbound !== null && pick !== null) {
      push(outbound, null, pick, 'picks', `Convert surplus ${position} depth into draft capital`, `pick:${pick.season}:${pick.round}`);
    }
  }

  // 3. Player swaps — surplus out, value-matched surplus in.
  for (const outboundPosition of positionGroups) {
    if (!user.surplus.has(outboundPosition) || !counterparty.needs.has(outboundPosition)) {
      continue;
    }

    const outbound = bestNonStarter(user.team, outboundPosition);

    if (outbound === null) {
      continue;
    }

    for (const inboundPosition of positionGroups) {
      if (!counterparty.surplus.has(inboundPosition) || !user.needs.has(inboundPosition)) {
        continue;
      }

      const inbound = closestValueNonStarter(counterparty.team, inboundPosition, outbound.dynastyValue);

      if (inbound === null) {
        continue;
      }

      const group: TradeCandidateGroup =
        (outbound.age ?? 0) >= agingThreshold
          ? 'sell'
          : (inboundPosition.toLowerCase() as TradeCandidateGroup);

      push(
        outbound,
        inbound,
        null,
        group,
        `Swap surplus ${outboundPosition} depth for ${inboundPosition} help`,
        inbound.sleeperPlayerId,
      );
    }
  }

  return drafts;
}

// @spec DFF-SM-050
// @spec DFF-SM-053
// @spec DFF-SM-054
// @spec DFF-SM-055
export function recommendTrades(context: LeagueContext, now: () => Date = () => new Date()): TradeRecommendations {
  const picks = ownedPicks(context);
  const userTeam = context.allRosters.find((team) => team.rosterId === context.userRosterId);

  if (!userTeam) {
    throw new Error(`User roster ${context.userRosterId} missing from league ${context.league.leagueId}.`);
  }

  const user = outlookFor(context, userTeam);

  const seen = new Set<string>();
  const byGroup = new Map<TradeCandidateGroup, TradeCandidate[]>();

  for (const team of context.allRosters) {
    if (team.rosterId === context.userRosterId) {
      continue;
    }

    const counterparty = outlookFor(context, team);

    for (const draft of draftCandidatesFor(context, counterparty, user, picks, now)) {
      if (seen.has(draft.key)) {
        continue;
      }

      seen.add(draft.key);

      // @spec DFF-SM-053 — only net-positive candidates are surfaced.
      if (draft.candidate.score.compositeScore > 0) {
        const list = byGroup.get(draft.candidate.group) ?? [];
        list.push(draft.candidate);
        byGroup.set(draft.candidate.group, list);
      }
    }
  }

  const groups = {} as TradeRecommendations['groups'];

  for (const key of Object.keys(groupLabels) as TradeCandidateGroup[]) {
    const candidates = (byGroup.get(key) ?? [])
      .sort((a, b) => b.score.compositeScore - a.score.compositeScore)
      .slice(0, 3);

    groups[key] = { label: groupLabels[key], candidates };
  }

  return { groups };
}
