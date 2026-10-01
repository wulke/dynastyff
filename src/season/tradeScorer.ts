// @spec DFF-SM-032
// @spec DFF-SM-033
// @spec DFF-SM-034
// @spec DFF-SM-035
// @spec DFF-SM-036
// @spec DFF-SM-037
// @spec DFF-SM-038
// @spec DFF-SM-082
// @spec DFF-SM-087
import type {
  LeagueContext,
  RosterEntry,
  SleeperTradeOfferRecord,
  TeamRoster,
} from './context.js';
import { classifyTeamContext, evaluateRoster } from './rosterEvaluator.js';

export type ScoredAsset = {
  kind: 'player' | 'pick';
  id: string;
  label: string;
  position: string | null;
  age: number | null;
  dynastyValue: number;
  direction: 'in' | 'out';
};

export type TradeSignals = {
  valueDelta: number;
  ageCurveScore: number;
  positionalNeedScore: number;
  teamContextMultiplier: number;
  assetLiquidity: -1 | 0 | 1;
};

export type TradeScore = {
  transactionId: string;
  assetsOut: ScoredAsset[];
  assetsIn: ScoredAsset[];
  signals: TradeSignals;
  compositeScore: number;
  verdict: 'win' | 'loss' | 'neutral';
  warnings: string[];
};

const draftRounds = [1, 2, 3, 4];
const futureSeasonCount = 3;
const fallbackAverageAge = 26;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function playerIndex(allRosters: TeamRoster[]): Map<string, RosterEntry> {
  const index = new Map<string, RosterEntry>();

  for (const team of allRosters) {
    for (const entry of team.players) {
      index.set(entry.sleeperPlayerId, entry);

      if (entry.playersId !== null) {
        index.set(entry.playersId, entry);
      }
    }
  }

  return index;
}

type DerivedAssets = {
  assetsIn: ScoredAsset[];
  assetsOut: ScoredAsset[];
  warnings: string[];
};

// @spec DFF-SM-087 — direction comes from adds/drops for players and owner/previous_owner for picks.
function deriveAssets(
  context: LeagueContext,
  offer: SleeperTradeOfferRecord,
  index: Map<string, RosterEntry>,
): DerivedAssets {
  const assetsIn: ScoredAsset[] = [];
  const assetsOut: ScoredAsset[] = [];
  const warnings: string[] = [];
  const userRosterId = context.userRosterId;

  const playerIds = new Set([...Object.keys(offer.adds), ...Object.keys(offer.drops)]);

  for (const sleeperPlayerId of playerIds) {
    const receiver = offer.adds[sleeperPlayerId];
    const giver = offer.drops[sleeperPlayerId];
    const entry = index.get(sleeperPlayerId);
    const onUserRoster = context.userRoster.some((row) => row.sleeperPlayerId === sleeperPlayerId);

    let direction: 'in' | 'out' | null = null;

    if (receiver === userRosterId) {
      direction = 'in';
    } else if (giver === userRosterId) {
      direction = 'out';
    } else if (giver === undefined && receiver !== undefined && onUserRoster) {
      // Some payloads omit `drops`; a player added to another team who currently sits on the
      // user's roster is being sent away (DFF-SM-087).
      direction = 'out';
    }

    if (direction === null) {
      continue;
    }

    if (!entry) {
      warnings.push(`Unknown player ${sleeperPlayerId} in trade ${offer.transactionId}.`);
      const asset: ScoredAsset = {
        kind: 'player',
        id: sleeperPlayerId,
        label: sleeperPlayerId,
        position: null,
        age: null,
        dynastyValue: 0,
        direction,
      };
      (direction === 'in' ? assetsIn : assetsOut).push(asset);
      continue;
    }

    const asset: ScoredAsset = {
      kind: 'player',
      id: entry.playersId ?? entry.sleeperPlayerId,
      label: entry.name,
      position: entry.position,
      age: entry.age,
      dynastyValue: entry.dynastyValue,
      direction,
    };
    (direction === 'in' ? assetsIn : assetsOut).push(asset);
  }

  for (const raw of offer.draftPicks) {
    if (!raw || typeof raw !== 'object') {
      warnings.push(`Malformed pick asset in trade ${offer.transactionId}.`);
      continue;
    }

    const pick = raw as {
      season?: unknown;
      round?: unknown;
      roster_id?: unknown;
      previous_owner_id?: unknown;
      owner_id?: unknown;
    };

    const season = pick.season === undefined ? null : String(pick.season);
    const round = typeof pick.round === 'number' ? pick.round : null;
    const owner = typeof pick.owner_id === 'number' ? pick.owner_id : null;
    const previousOwner = typeof pick.previous_owner_id === 'number' ? pick.previous_owner_id : null;

    let direction: 'in' | 'out' | null = null;

    if (owner === userRosterId && previousOwner !== userRosterId) {
      direction = 'in';
    } else if (previousOwner === userRosterId && owner !== userRosterId) {
      direction = 'out';
    } else if (owner === userRosterId && previousOwner === null) {
      direction = 'in';
    } else if (previousOwner === userRosterId && owner === null) {
      direction = 'out';
    }

    if (direction === null) {
      continue;
    }

    if (season === null || round === null) {
      warnings.push(`Pick asset with missing season/round in trade ${offer.transactionId}.`);
      continue;
    }

    const key = `${Number(season)}:${round}`;
    const value = context.pickValues[key];

    if (value === undefined) {
      // @spec DFF-SM-082 — missing pick values score 0 and are flagged.
      warnings.push(`No pick value for ${season} round ${round}.`);
    }

    const asset: ScoredAsset = {
      kind: 'pick',
      id: key,
      label: `${season} Round ${round}`,
      position: null,
      age: null,
      dynastyValue: value ?? 0,
      direction,
    };
    (direction === 'in' ? assetsIn : assetsOut).push(asset);
  }

  return { assetsIn, assetsOut, warnings };
}

function sumValue(assets: ScoredAsset[]): number {
  return assets.reduce((sum, asset) => sum + asset.dynastyValue, 0);
}

function userRosterValue(context: LeagueContext): number {
  return context.userRoster
    .filter((entry) => entry.slotType !== 'ir')
    .reduce((sum, entry) => sum + entry.dynastyValue, 0);
}

function weightedMeanAge(assets: ScoredAsset[]): number | null {
  const aged = assets.filter((asset) => asset.age !== null) as (ScoredAsset & { age: number })[];

  if (aged.length === 0) {
    return null;
  }

  const totalWeight = aged.reduce((sum, asset) => sum + Math.max(asset.dynastyValue, 0), 0);

  if (totalWeight <= 0) {
    return aged.reduce((sum, asset) => sum + asset.age, 0) / aged.length;
  }

  return aged.reduce((sum, asset) => sum + asset.age * Math.max(asset.dynastyValue, 0), 0) / totalWeight;
}

function leagueAveragePlayerAge(context: LeagueContext): number {
  const ages: number[] = [];

  for (const team of context.allRosters) {
    for (const entry of team.players) {
      if (entry.age !== null) {
        ages.push(entry.age);
      }
    }
  }

  if (ages.length === 0) {
    return fallbackAverageAge;
  }

  return ages.reduce((sum, age) => sum + age, 0) / ages.length;
}

// @spec DFF-SM-034 — slot-fill rule shared with the Waiver Scorer: a joining player takes a
// vacant starting slot at their position, else bench.
export function nextSlotType(
  roster: RosterEntry[],
  position: string,
  rosterPositions: string[],
): RosterEntry['slotType'] {
  const starterSlots = rosterPositions.filter((slot) => slot === position).length;
  const currentStarters = roster.filter(
    (row) => row.position === position && row.slotType === 'starter',
  ).length;

  return currentStarters < starterSlots ? 'starter' : 'bench';
}

// @spec DFF-SM-034 — received players fill a vacant starting slot at their position, else bench.
function postTradeRoster(
  context: LeagueContext,
  assetsIn: ScoredAsset[],
  assetsOut: ScoredAsset[],
  index: Map<string, RosterEntry>,
): RosterEntry[] {
  const sentIds = new Set(assetsOut.filter((asset) => asset.kind === 'player').map((asset) => asset.id));
  const roster = context.userRoster.filter(
    (entry) => !sentIds.has(entry.playersId ?? entry.sleeperPlayerId),
  );

  const received = assetsIn
    .filter((asset) => asset.kind === 'player')
    .map((asset) => index.get(asset.id))
    .filter((entry): entry is RosterEntry => entry !== undefined);

  const additions: RosterEntry[] = [];

  for (const entry of received) {
    const slotType = nextSlotType([...roster, ...additions], entry.position, context.league.rosterPositions);
    additions.push({ ...entry, slotType });
  }

  return [...roster, ...additions];
}

export type OwnedPick = {
  season: string;
  round: number;
  originRosterId: number;
  ownerId: number;
  value: number;
};

// Every pick of the next three seasons with its current owner (traded picks override the
// original roster). Missing `pick_values` rows score 0, mirroring DFF-SM-082.
export function ownedPicks(context: LeagueContext): OwnedPick[] {
  const currentSeason = Number(context.league.season);
  const baseSeason = Number.isFinite(currentSeason) ? currentSeason : new Date().getUTCFullYear();
  const tradedIndex = new Map<string, number>();

  for (const pick of context.tradedPicks) {
    tradedIndex.set(`${pick.season}:${pick.round}:${pick.rosterId}`, pick.ownerId);
  }

  const picks: OwnedPick[] = [];

  for (let offset = 1; offset <= futureSeasonCount; offset += 1) {
    const season = baseSeason + offset;

    for (const round of draftRounds) {
      for (const team of context.allRosters) {
        const origin = team.rosterId;
        const ownerId = tradedIndex.get(`${season}:${round}:${origin}`) ?? origin;
        picks.push({
          season: String(season),
          round,
          originRosterId: origin,
          ownerId,
          value: context.pickValues[`${season}:${round}`] ?? 0,
        });
      }
    }
  }

  return picks;
}

// @spec DFF-SM-036 — counterparty preference inferred from held future picks vs roster size.
function pickInventory(context: LeagueContext): Map<number, number> {
  const owners = new Map<number, number>();

  for (const pick of ownedPicks(context)) {
    owners.set(pick.ownerId, (owners.get(pick.ownerId) ?? 0) + 1);
  }

  return owners;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function counterpartyRosterId(offer: SleeperTradeOfferRecord, userRosterId: number): number | null {
  if (offer.proposerRosterId !== userRosterId) {
    return offer.proposerRosterId;
  }

  return offer.responderRosterIds.find((id) => id !== userRosterId) ?? null;
}

// @spec DFF-SM-036
function assetLiquidity(
  context: LeagueContext,
  offer: SleeperTradeOfferRecord,
  assetsIn: ScoredAsset[],
  assetsOut: ScoredAsset[],
): -1 | 0 | 1 {
  const counterpartyId = counterpartyRosterId(offer, context.userRosterId);

  if (counterpartyId === null) {
    return 0;
  }

  const counterparty = context.allRosters.find((team) => team.rosterId === counterpartyId);

  if (!counterparty) {
    return 0;
  }

  const inventory = pickInventory(context);
  const ratios = context.allRosters.map(
    (team) => (inventory.get(team.rosterId) ?? 0) / Math.max(team.players.length, 1),
  );
  const leagueMedian = median(ratios);
  const counterpartyRatio = (inventory.get(counterpartyId) ?? 0) / Math.max(counterparty.players.length, 1);

  if (leagueMedian <= 0) {
    return 0;
  }

  const sendsPicks = assetsOut.some((asset) => asset.kind === 'pick');
  const sendsPlayers = assetsOut.some((asset) => asset.kind === 'player');

  if (sendsPicks && !sendsPlayers) {
    return counterpartyRatio < leagueMedian * 0.5 ? 1 : counterpartyRatio > leagueMedian * 1.5 ? -1 : 0;
  }

  if (sendsPlayers && !sendsPicks) {
    return counterpartyRatio > leagueMedian * 1.5 ? 1 : counterpartyRatio < leagueMedian * 0.5 ? -1 : 0;
  }

  return 0;
}

// @spec DFF-SM-037
// @spec DFF-SM-038
function compositeScore(
  context: LeagueContext,
  signals: Omit<TradeSignals, 'teamContextMultiplier'>,
): { composite: number; valueMultiplier: number } {
  const userTeam = context.allRosters.find((team) => team.rosterId === context.userRosterId);

  if (!userTeam) {
    throw new Error(`User roster ${context.userRosterId} missing from league ${context.league.leagueId}.`);
  }

  const context_ = classifyTeamContext(userTeam, context.allRosters);
  const contender = context_.classification === 'contender';

  const valueMultiplier = contender ? 0.8 : 1.2;
  const ageMultiplier = contender ? 1.0 : 1.4;
  const needMultiplier = contender ? 1.4 : 1.0;

  const weights = {
    value: 0.5 * valueMultiplier,
    age: 0.2 * ageMultiplier,
    need: 0.2 * needMultiplier,
    liquidity: 0.1,
  };

  const totalWeight = weights.value + weights.age + weights.need + weights.liquidity;

  // Age is sign-inverted: getting younger raises the composite.
  const weighted =
    weights.value * signals.valueDelta +
    weights.age * -signals.ageCurveScore +
    weights.need * signals.positionalNeedScore +
    weights.liquidity * (signals.assetLiquidity * 100);

  return { composite: clamp(weighted / totalWeight, -100, 100), valueMultiplier };
}

// @spec DFF-SM-032
// @spec DFF-SM-033
// @spec DFF-SM-034
// @spec DFF-SM-035
// @spec DFF-SM-036
// @spec DFF-SM-037
// @spec DFF-SM-038
// @spec DFF-SM-087
export function scoreTrade(context: LeagueContext, offer: SleeperTradeOfferRecord): TradeScore {
  const index = playerIndex(context.allRosters);
  const { assetsIn, assetsOut, warnings } = deriveAssets(context, offer, index);

  // @spec DFF-SM-032
  const rawValueDelta = sumValue(assetsIn) - sumValue(assetsOut);
  const valueDelta = clamp((100 * rawValueDelta) / Math.max(userRosterValue(context), 1), -100, 100);

  // @spec DFF-SM-033
  const meanIn = weightedMeanAge(assetsIn);
  const meanOut = weightedMeanAge(assetsOut);
  const ageCurveScore =
    meanIn === null || meanOut === null
      ? 0
      : clamp((100 * (meanIn - meanOut)) / leagueAveragePlayerAge(context), -100, 100);

  // @spec DFF-SM-034
  const affected = new Set(
    [...assetsIn, ...assetsOut]
      .filter((asset) => asset.kind === 'player' && asset.position !== null)
      .map((asset) => asset.position as string),
  );
  const before = evaluateRoster(context);
  const postRoster = postTradeRoster(context, assetsIn, assetsOut, index);
  const after = evaluateRoster({
    ...context,
    userRoster: postRoster,
    allRosters: context.allRosters.map((team) =>
      team.rosterId === context.userRosterId ? { ...team, players: postRoster } : team,
    ),
  });

  let rawNeed = 0;
  for (const position of affected) {
    const beforeComposite = before.positions[position]?.composite ?? 0;
    const afterComposite = after.positions[position]?.composite ?? 0;
    rawNeed += afterComposite - beforeComposite;
  }
  const positionalNeedScore = clamp(rawNeed, -100, 100);

  const liquidity = assetLiquidity(context, offer, assetsIn, assetsOut);

  const { composite, valueMultiplier } = compositeScore(context, {
    valueDelta,
    ageCurveScore,
    positionalNeedScore,
    assetLiquidity: liquidity,
  });

  const verdict: TradeScore['verdict'] = composite > 10 ? 'win' : composite < -10 ? 'loss' : 'neutral';

  return {
    transactionId: String(offer.transactionId),
    assetsOut,
    assetsIn,
    signals: {
      valueDelta,
      ageCurveScore,
      positionalNeedScore,
      // @spec DFF-SM-035 — the value-delta multiplier applied for the user's team context.
      teamContextMultiplier: valueMultiplier,
      assetLiquidity: liquidity,
    },
    compositeScore: composite,
    verdict,
    warnings,
  };
}
