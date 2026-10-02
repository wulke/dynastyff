import type { DraftState } from '../context/DraftContext.js';

// @spec DFF-UI-170
export function computeDerivedPickValues(state: DraftState): Map<number, number> {
  if (state.status !== 'in_progress' || state.currentPickNumber === null) {
    return new Map();
  }

  if (state.availablePlayers.length === 0) {
    return new Map();
  }

  const filledPickNumbers = new Set(state.picks.map((pick) => pick.pickNumber));
  const derivedPickValues = new Map<number, number>();

  for (const slot of state.draftOrder) {
    if (filledPickNumbers.has(slot.pickNumber)) {
      continue;
    }

    const estimatedRank = Math.max(0, slot.pickNumber - state.currentPickNumber - 1);
    const derivedValue = state.availablePlayers[estimatedRank]?.dynastyValue ?? 0;

    derivedPickValues.set(slot.pickNumber, derivedValue);
  }

  return derivedPickValues;
}

// @spec DFF-UI-062
// @spec DFF-UI-148
export function getPickRound(draftState: DraftState, pickNumber: number): number {
  return draftState.draftOrder.find((entry) => entry.pickNumber === pickNumber)?.round ?? 0;
}

// @spec DFF-UI-062
// @spec DFF-UI-148
export function getPickRoundForPlayer(draftState: DraftState, playerId: string): number {
  const pick = draftState.picks.find((entry) => entry.playerId === playerId);
  return pick ? getPickRound(draftState, pick.pickNumber) : 0;
}
