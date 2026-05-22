// @spec DFF-STATIC-034
// @spec DFF-STATIC-035
// @spec DFF-STATIC-063
// @spec DFF-STATIC-070
// @spec DFF-STATIC-071
// @spec DFF-STATIC-073
import { useEffect, useRef, useState, type PropsWithChildren } from 'react';

import { availablePlayers, createDraft, currentTeam, submitPick as submitEnginePick, type InMemoryDraftState } from '../draft/engine.js';
import { selectBotPick } from '../draft/bot.js';
import {
  type CompletedDraft,
  type DraftContextValue,
  type DraftState,
  DraftContextProvider,
  type QueueEntry,
} from '../ui/context/DraftContext.js';
import type { DraftConfig, Snapshot } from '../ui/types.js';

const BOT_PICK_MIN_DELAY_MS = 1_500;
const BOT_PICK_DELAY_RANGE_MS = 1_500;

const BOT_NOISE_BY_ARCHETYPE = {
  bpa: 0.05,
  balanced: 0.1,
  win_now: 0.08,
  punt: 0.12,
  rb_heavy: 0.1,
  qb_early: 0.08,
} as const;

// @spec DFF-STATIC-063
function buildDraftState(
  engineState: InMemoryDraftState,
  snapshot: Snapshot,
  completedAt: string | null,
): DraftState {
  return {
    draftId: engineState.draftId,
    status: engineState.status,
    currentPickNumber: engineState.status === 'completed' ? null : engineState.picks.length + 1,
    teams: engineState.teams,
    draftOrder: engineState.draftOrder,
    picks: engineState.picks,
    rosterPlayers: engineState.rosterPlayers,
    teamPickAssets: engineState.teamPickAssets,
    userQueue: engineState.userQueue,
    availablePlayers: availablePlayers(engineState, snapshot.players),
    trades: [],
    pendingTrade: null,
    sseStatus: 'connected',
    completedAt,
  };
}

// @spec DFF-STATIC-070
// @spec DFF-STATIC-071
function buildCompletedDraft(state: DraftState, completedAt: string): CompletedDraft {
  return {
    draftId: state.draftId ?? '',
    completedAt,
    teams: state.teams,
    draftOrder: state.draftOrder,
    picks: state.picks,
    rosterPlayers: state.rosterPlayers,
    teamPickAssets: state.teamPickAssets,
    trades: state.trades,
  };
}

// @spec DFF-STATIC-034
function getBotDelayMs() {
  return BOT_PICK_MIN_DELAY_MS + Math.floor(Math.random() * (BOT_PICK_DELAY_RANGE_MS + 1));
}

// @spec DFF-STATIC-034
function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

// @spec DFF-STATIC-034
function getBotNoise(archetype: InMemoryDraftState['teams'][number]['archetype']) {
  if (!archetype) {
    return BOT_NOISE_BY_ARCHETYPE.balanced;
  }

  return BOT_NOISE_BY_ARCHETYPE[archetype];
}

// @spec DFF-STATIC-063
// @spec DFF-STATIC-070
// @spec DFF-STATIC-071
export function InMemoryDraftContextProvider({
  snapshot,
  children,
}: PropsWithChildren<{ snapshot: Snapshot }>) {
  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [sessionHistory, setSessionHistory] = useState<CompletedDraft[]>([]);
  const engineStateRef = useRef<InMemoryDraftState | null>(null);
  const botLoopTokenRef = useRef(0);

  useEffect(() => {
    return () => {
      botLoopTokenRef.current += 1;
    };
  }, []);

  function stopBotLoop() {
    botLoopTokenRef.current += 1;
  }

  // @spec DFF-STATIC-071
  function applyDraftState(nextEngineState: InMemoryDraftState): InMemoryDraftState {
    engineStateRef.current = nextEngineState;

    if (nextEngineState.status === 'completed') {
      const completedAt = new Date().toISOString();
      const completedDraftState = buildDraftState(nextEngineState, snapshot, completedAt);

      setDraftState(completedDraftState);
      setSessionHistory((previousHistory) => [...previousHistory, buildCompletedDraft(completedDraftState, completedAt)]);
      return nextEngineState;
    }

    setDraftState(buildDraftState(nextEngineState, snapshot, null));
    return nextEngineState;
  }

  // @spec DFF-STATIC-034
  // @spec DFF-STATIC-035
  async function runBotLoop(initialState: InMemoryDraftState, token: number) {
    let workingState = initialState;

    while (botLoopTokenRef.current === token) {
      const team = currentTeam(workingState);

      if (!team || team.isUser) {
        return;
      }

      await delay(getBotDelayMs());

      if (botLoopTokenRef.current !== token) {
        return;
      }

      const nextPlayerId = selectBotPick(
        availablePlayers(workingState, snapshot.players),
        team,
        workingState.rosterPlayers.filter((entry) => entry.teamId === team.id),
        getBotNoise(team.archetype),
      );

      workingState = applyDraftState(submitEnginePick(workingState, nextPlayerId));

      if (workingState.status === 'completed') {
        return;
      }
    }
  }

  function enterBotLoop(state: InMemoryDraftState) {
    const team = currentTeam(state);

    if (!team || team.isUser) {
      return;
    }

    const token = botLoopTokenRef.current + 1;
    botLoopTokenRef.current = token;
    void runBotLoop(state, token);
  }

  // @spec DFF-STATIC-063
  function startDraft(config: DraftConfig) {
    stopBotLoop();
    const nextEngineState = applyDraftState(createDraft(config, snapshot.players, snapshot.pickValues));
    enterBotLoop(nextEngineState);
  }

  // @spec DFF-STATIC-035
  // @spec DFF-STATIC-063
  function submitPick(playerId: string) {
    const currentState = engineStateRef.current;
    const teamOnClock = currentState ? currentTeam(currentState) : null;

    if (!currentState || !teamOnClock?.isUser) {
      return;
    }

    const nextEngineState = applyDraftState(submitEnginePick(currentState, playerId));

    if (nextEngineState.status !== 'completed') {
      enterBotLoop(nextEngineState);
    }
  }

  // @spec DFF-STATIC-063
  function updateQueue(queue: QueueEntry[]) {
    const currentState = engineStateRef.current;

    if (!currentState) {
      return;
    }

    const nextEngineState = {
      ...currentState,
      userQueue: [...queue],
    };

    applyDraftState(nextEngineState);
  }

  // @spec DFF-STATIC-063
  // @spec DFF-STATIC-070
  // @spec DFF-STATIC-073
  function newDraft() {
    stopBotLoop();
    engineStateRef.current = null;
    setDraftState(null);
  }

  const value: DraftContextValue = {
    snapshot,
    draftState,
    sessionHistory,
    startDraft,
    submitPick,
    updateQueue,
    newDraft,
  };

  return <DraftContextProvider value={value}>{children}</DraftContextProvider>;
}
