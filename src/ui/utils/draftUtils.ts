import type { DraftState } from '../context/DraftContext.js';

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
