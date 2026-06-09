// @spec DFF-STATIC-060
// @spec DFF-STATIC-061
// @spec DFF-STATIC-062
// @spec DFF-UI-070
// @spec DFF-UI-071
// @spec DFF-UI-072
// @spec DFF-UI-073
// @spec DFF-UI-074
// @spec DFF-UI-082
// @spec DFF-UI-083
// @spec DFF-UI-121
import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type PropsWithChildren,
} from 'react';
import type { DraftConfig, Snapshot } from '../types.js';

export type QueueEntry = {
  playerId: string;
  rank: number;
};

type Team = {
  id: string;
  name: string;
  isUser: boolean;
  archetype: string | null;
};

type DraftOrderSlot = {
  pickNumber: number;
  round: number;
  pickInRound: number;
  teamId: string;
};

type PickRecord = {
  pickNumber: number;
  teamId: string;
  playerId: string;
  pickedAt: string;
};

type RosterPlayerRecord = {
  teamId: string;
  playerId: string;
};

type TeamPickAsset = {
  teamId: string;
  year: number;
  round: number;
};

type StartupPickValue = {
  globalPickNumber: number;
  dynastyValue: number;
};

export type AvailablePlayer = {
  id: string;
  name: string;
  position: string;
  nflTeam: string | null;
  age: number | null;
  isRookie: boolean;
  dynastyValue: number;
  adp: number | null;
};

export type TradeRecord = {
  id: string;
  round: number;
  initiatingTeamId: string;
  receivingTeamId: string;
  assetsSent: unknown[];
  assetsReceived: unknown[];
  status: string;
};

type PendingTrade = {
  tradeId: string;
  initiatingTeamId: string;
  receivingTeamId: string;
  assetsSent: unknown[];
  assetsReceived: unknown[];
  isBotToBot: boolean;
  round: number;
};

type SseStatus = 'connecting' | 'connected' | 'disconnected';
export type TradeResponseStatus = 'accepted' | 'declined' | 'force_declined';
export type SubmitTradeOfferResult = {
  ok: boolean;
  tradeId: string | null;
};

export type DraftState = {
  draftId: string | null;
  status: 'idle' | 'in_progress' | 'completed';
  isHydrating: boolean;
  currentPickNumber: number | null;
  rosterConfig: DraftConfig['rosterConfig'] | null;
  teams: Team[];
  draftOrder: DraftOrderSlot[];
  playerCatalog: Record<string, AvailablePlayer>;
  picks: PickRecord[];
  rosterPlayers: RosterPlayerRecord[];
  teamPickAssets: TeamPickAsset[];
  startupPickValues: StartupPickValue[];
  userQueue: QueueEntry[];
  availablePlayers: AvailablePlayer[];
  trades: TradeRecord[];
  pendingTrade: PendingTrade | null;
  sseStatus: SseStatus;
  completedAt: string | null;
};

export type CompletedDraft = {
  draftId: string;
  completedAt: string;
  rosterConfig: DraftConfig['rosterConfig'] | null;
  teams: Team[];
  draftOrder: DraftOrderSlot[];
  picks: PickRecord[];
  rosterPlayers: RosterPlayerRecord[];
  teamPickAssets: TeamPickAsset[];
  startupPickValues: StartupPickValue[];
  trades: TradeRecord[];
};

export interface DraftContextValue {
  snapshot: Snapshot | null;
  draftState: DraftState | null;
  sessionHistory: CompletedDraft[];
  startDraft(config: DraftConfig): void;
  loadDraft(draftId: string): Promise<boolean>;
  showError(message: string): void;
  submitPick(playerId: string): void;
  respondToTrade(status: TradeResponseStatus): Promise<boolean>;
  submitTradeOffer(targetTeamId: string, offeredAssets: unknown[], requestedAssets: unknown[]): Promise<SubmitTradeOfferResult>;
  updateQueue(queue: QueueEntry[]): void;
  newDraft(): void;
}

type HttpDraftContextState = {
  draftState: DraftState | null;
  sessionHistory: CompletedDraft[];
};

type StateSyncPayload = {
  draft_id: string;
  status: 'in_progress' | 'completed';
  current_pick_number: number | null;
  roster_config?: {
    QB: number;
    RB: number;
    WR: number;
    TE: number;
    FLEX: number;
    SF: number;
    bench: number;
  };
  teams: Array<{
    id: string;
    name: string;
    is_user: boolean;
    archetype: string | null;
  }>;
  draft_order: Array<{
    pick_number: number;
    round: number;
    pick_in_round: number;
    team_id: string;
  }>;
  picks: Array<{
    pick_number: number;
    team_id: string;
    player_id: string;
    picked_at: string;
  }>;
  roster_players: Array<{
    team_id: string;
    player_id: string;
  }>;
  team_pick_assets: Array<{
    team_id: string;
    year: number;
    round: number;
  }>;
  user_queue: Array<{
    player_id: string;
    rank: number;
  }>;
  available_players: Array<{
    id: string;
    name: string;
    position: string;
    nfl_team: string | null;
    age: number | null;
    is_rookie: boolean;
    dynasty_value: number;
    adp: number | null;
  }>;
  drafted_players?: Array<{
    id: string;
    name: string;
    position: string;
    nfl_team: string | null;
    age: number | null;
    is_rookie: boolean;
    dynasty_value: number;
    adp: number | null;
  }>;
  startup_pick_values?: Array<{
    global_pick_number: number;
    dynasty_value: number;
  }>;
};

type PickMadePayload = {
  pick_number: number;
  team_id: string;
  player_id: string;
  is_bot: boolean;
};

type YourTurnPayload = {
  pick_number: number;
  round: number;
  pick_in_round: number;
};

type TradeOfferedPayload = {
  trade_id: string;
  initiating_team_id: string;
  receiving_team_id: string;
  assets_sent: unknown[];
  assets_received: unknown[];
  is_bot_to_bot: boolean;
  round?: number;
};

type TradeResolvedPayload = {
  trade_id: string;
  status: string;
  assets_sent: unknown[];
  assets_received: unknown[];
};

type DraftCompletePayload = {
  draft_id: string;
  completed_at: string;
};

type DraftAction =
  | { type: 'DRAFT_CREATED'; draftId: string }
  | { type: 'STATE_SYNC'; payload: StateSyncPayload }
  | { type: 'QUEUE_SYNC'; queue: QueueEntry[] }
  | { type: 'PICK_MADE'; payload: PickMadePayload }
  | { type: 'YOUR_TURN'; payload: YourTurnPayload }
  | { type: 'TRADE_OFFERED'; payload: TradeOfferedPayload }
  | { type: 'TRADE_RESOLVED'; payload: TradeResolvedPayload }
  | { type: 'DRAFT_COMPLETE'; payload: DraftCompletePayload }
  | { type: 'ADVISOR_RESET' }
  | { type: 'SSE_STATUS'; status: SseStatus }
  | { type: 'NEW_DRAFT' }
  | { type: 'LOAD_DRAFT'; payload: StateSyncPayload };

type ToastProps = {
  message: string;
};

type DraftCreateResponse = {
  draftId?: string;
};

const DRAFT_CONTEXT_ERROR = 'Draft context is unavailable.';
const GENERIC_DRAFT_CREATE_ERROR = 'Draft creation failed. Check your config and try again.';
const GENERIC_DRAFT_LOAD_ERROR = 'Failed to load draft state.';
const GENERIC_PICK_ERROR = 'Pick failed — player may already be taken.';
const GENERIC_TRADE_RESPONSE_ERROR = 'Trade response failed. Try again.';
const GENERIC_TRADE_OFFER_ERROR = 'Trade proposal failed. Try again.';
const GENERIC_DISCONNECT_ERROR = 'Lost connection to draft server. Refresh to reconnect.';
const GENERIC_QUEUE_LOAD_ERROR = 'Failed to load draft queue.';
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;

const DraftContext = createContext<DraftContextValue | null>(null);

class DraftCreateUiError extends Error {}

// @spec DFF-STATIC-060
// @spec DFF-STATIC-062
// @spec DFF-UI-071
// @spec DFF-UI-058f
function createEmptyDraftState(draftId: string): DraftState {
  return {
    draftId,
    status: 'in_progress',
    isHydrating: true,
    currentPickNumber: null,
    rosterConfig: null,
    teams: [],
    draftOrder: [],
    playerCatalog: {},
    picks: [],
    rosterPlayers: [],
    teamPickAssets: [],
    startupPickValues: [],
    userQueue: [],
    availablePlayers: [],
    trades: [],
    pendingTrade: null,
    sseStatus: 'connecting',
    completedAt: null,
  };
}

// @spec DFF-UI-030
function sortAvailablePlayers(players: AvailablePlayer[]): AvailablePlayer[] {
  return [...players].sort((left, right) => right.dynastyValue - left.dynastyValue);
}

// @spec DFF-UI-071
function toUiPlayer(player: {
  id: string;
  name: string;
  position: string;
  nfl_team: string | null;
  age: number | null;
  is_rookie: boolean;
  dynasty_value: number;
  adp: number | null;
}): AvailablePlayer {
  return {
    id: player.id,
    name: player.name,
    position: player.position,
    nflTeam: player.nfl_team,
    age: player.age,
    isRookie: player.is_rookie,
    dynastyValue: player.dynasty_value,
    adp: player.adp,
  };
}

// @spec DFF-STATIC-060
// @spec DFF-STATIC-062
// @spec DFF-UI-071
// @spec DFF-UI-058f
function toDraftStateFromSync(payload: StateSyncPayload, existingState: DraftState | null): DraftState {
  const syncedPlayers = sortAvailablePlayers(payload.available_players.map(toUiPlayer));
  const draftedPlayers = (payload.drafted_players ?? []).map(toUiPlayer);

  const playerCatalog = {
    ...(existingState?.playerCatalog ?? {}),
    ...Object.fromEntries(draftedPlayers.map((player) => [player.id, player])),
    ...Object.fromEntries(syncedPlayers.map((player) => [player.id, player])),
  };

  return {
    draftId: payload.draft_id,
    status: payload.status,
    isHydrating: false,
    currentPickNumber: payload.current_pick_number,
    rosterConfig: payload.roster_config ?? existingState?.rosterConfig ?? null,
    teams: payload.teams.map((team) => ({
      id: team.id,
      name: team.name,
      isUser: team.is_user,
      archetype: team.archetype,
    })),
    draftOrder: payload.draft_order.map((slot) => ({
      pickNumber: slot.pick_number,
      round: slot.round,
      pickInRound: slot.pick_in_round,
      teamId: slot.team_id,
    })),
    playerCatalog,
    picks: payload.picks.map((pick) => ({
      pickNumber: pick.pick_number,
      teamId: pick.team_id,
      playerId: pick.player_id,
      pickedAt: pick.picked_at,
    })),
    rosterPlayers: payload.roster_players.map((entry) => ({
      teamId: entry.team_id,
      playerId: entry.player_id,
    })),
    teamPickAssets: payload.team_pick_assets.map((asset) => ({
      teamId: asset.team_id,
      year: asset.year,
      round: asset.round,
    })),
    startupPickValues: (payload.startup_pick_values ?? []).map((entry) => ({
      globalPickNumber: entry.global_pick_number,
      dynastyValue: entry.dynasty_value,
    })),
    userQueue: payload.user_queue.map((entry) => ({
      playerId: entry.player_id,
      rank: entry.rank,
    })),
    availablePlayers: syncedPlayers,
    trades: existingState?.trades ?? [],
    pendingTrade: existingState?.pendingTrade ?? null,
    sseStatus: existingState?.sseStatus ?? 'connected',
    completedAt: existingState?.completedAt ?? null,
  };
}

// @spec DFF-STATIC-060
// @spec DFF-STATIC-062
// @spec DFF-UI-058f
function toCompletedDraft(state: DraftState, completedAt: string): CompletedDraft {
  return {
    draftId: state.draftId ?? '',
    completedAt,
    rosterConfig: state.rosterConfig,
    teams: state.teams,
    draftOrder: state.draftOrder,
    picks: state.picks,
    rosterPlayers: state.rosterPlayers,
    teamPickAssets: state.teamPickAssets,
    startupPickValues: state.startupPickValues,
    trades: state.trades,
  };
}

// @spec DFF-STATIC-060
// @spec DFF-STATIC-062
// @spec DFF-UI-071
// @spec DFF-UI-072
// @spec DFF-UI-073
// @spec DFF-UI-074
// @spec DFF-UI-025
// @spec DFF-UI-124
function draftReducer(state: HttpDraftContextState, action: DraftAction): HttpDraftContextState {
  switch (action.type) {
    case 'DRAFT_CREATED':
      return {
        ...state,
        draftState: createEmptyDraftState(action.draftId),
      };
    case 'STATE_SYNC':
      return {
        ...state,
        draftState: toDraftStateFromSync(action.payload, state.draftState),
      };
    case 'QUEUE_SYNC':
      if (!state.draftState) {
        return state;
      }

      return {
        ...state,
        draftState: {
          ...state.draftState,
          userQueue: [...action.queue].sort((left, right) => left.rank - right.rank),
        },
      };
    case 'PICK_MADE': {
      if (!state.draftState) {
        return state;
      }

      const nextPicks = [
        ...state.draftState.picks.filter((pick) => pick.pickNumber !== action.payload.pick_number),
        {
          pickNumber: action.payload.pick_number,
          teamId: action.payload.team_id,
          playerId: action.payload.player_id,
          pickedAt: new Date().toISOString(),
        },
      ].sort((left, right) => left.pickNumber - right.pickNumber);

      return {
        ...state,
        draftState: {
          ...state.draftState,
          currentPickNumber: action.payload.pick_number + 1,
          playerCatalog: {
            ...state.draftState.playerCatalog,
            ...Object.fromEntries(
              state.draftState.availablePlayers
                .filter((player) => player.id === action.payload.player_id)
                .map((player) => [player.id, player]),
            ),
          },
          picks: nextPicks,
          rosterPlayers: [
            ...state.draftState.rosterPlayers,
            {
              teamId: action.payload.team_id,
              playerId: action.payload.player_id,
            },
          ],
          userQueue: state.draftState.userQueue.filter((entry) => entry.playerId !== action.payload.player_id),
          availablePlayers: state.draftState.availablePlayers.filter(
            (player) => player.id !== action.payload.player_id,
          ),
        },
      };
    }
    case 'YOUR_TURN':
      if (!state.draftState) {
        return state;
      }

      return {
        ...state,
        draftState: {
          ...state.draftState,
          currentPickNumber: action.payload.pick_number,
        },
      };
    case 'TRADE_OFFERED':
      if (!state.draftState) {
        return state;
      }

      const currentDraftState = state.draftState;

      // @spec DFF-UI-064
      // Derive round from current pick number if not provided in payload
      const tradeRound =
        typeof action.payload.round === 'number' && action.payload.round > 0
          ? action.payload.round
          : currentDraftState.currentPickNumber
            ? currentDraftState.draftOrder.find(
                (slot) => slot.pickNumber === currentDraftState.currentPickNumber,
              )?.round ?? 0
            : 0;

      return {
        ...state,
        draftState: {
          ...currentDraftState,
          pendingTrade: {
            tradeId: action.payload.trade_id,
            initiatingTeamId: action.payload.initiating_team_id,
            receivingTeamId: action.payload.receiving_team_id,
            assetsSent: action.payload.assets_sent,
            assetsReceived: action.payload.assets_received,
            isBotToBot: action.payload.is_bot_to_bot,
            round: tradeRound,
          },
        },
      };
    case 'TRADE_RESOLVED':
      if (!state.draftState) {
        return state;
      }

      return {
        ...state,
        draftState: {
          ...state.draftState,
          pendingTrade: null,
          trades: state.draftState.pendingTrade
            ? [
                ...state.draftState.trades,
                {
                  id: state.draftState.pendingTrade.tradeId,
                  round: state.draftState.pendingTrade.round,
                  initiatingTeamId: state.draftState.pendingTrade.initiatingTeamId,
                  receivingTeamId: state.draftState.pendingTrade.receivingTeamId,
                  assetsSent: action.payload.assets_sent,
                  assetsReceived: action.payload.assets_received,
                  status: action.payload.status,
                },
              ]
            : state.draftState.trades,
        },
      };
    case 'DRAFT_COMPLETE':
      if (!state.draftState) {
        return state;
      }

      return {
        draftState: {
          ...state.draftState,
          status: 'completed',
          currentPickNumber: null,
          pendingTrade: null,
          completedAt: action.payload.completed_at,
        },
        sessionHistory:
          state.draftState.status === 'completed'
            ? state.sessionHistory
            : [...state.sessionHistory, toCompletedDraft(state.draftState, action.payload.completed_at)],
      };
    // @spec DFF-UI-036
    case 'ADVISOR_RESET':
      return state;
    case 'SSE_STATUS':
      if (!state.draftState) {
        return state;
      }

      return {
        ...state,
        draftState: {
          ...state.draftState,
          sseStatus: action.status,
        },
      };
    case 'LOAD_DRAFT':
      // @spec DFF-UI-113
      // @spec DFF-UI-114
      return {
        ...state,
        draftState: toDraftStateFromSync(action.payload, state.draftState),
      };
    case 'NEW_DRAFT':
      return {
        ...state,
        draftState: null,
      };
    default:
      return state;
  }
}

// @spec DFF-STATIC-062
function parseDraftCreateResponse(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || typeof (payload as DraftCreateResponse).draftId !== 'string') {
    throw new DraftCreateUiError(GENERIC_DRAFT_CREATE_ERROR);
  }

  const draftId = (payload as DraftCreateResponse).draftId?.trim();

  if (!draftId) {
    throw new DraftCreateUiError(GENERIC_DRAFT_CREATE_ERROR);
  }

  return draftId;
}

// @spec DFF-STATIC-062
async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new DraftCreateUiError(GENERIC_DRAFT_CREATE_ERROR);
  }
}

// @spec DFF-UI-080
function isStateSyncPayload(payload: unknown): payload is StateSyncPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const candidate = payload as Partial<StateSyncPayload>;
  return (
    typeof candidate.draft_id === 'string' &&
    Array.isArray(candidate.teams) &&
    Array.isArray(candidate.draft_order) &&
    Array.isArray(candidate.picks) &&
    Array.isArray(candidate.roster_players) &&
    Array.isArray(candidate.team_pick_assets) &&
    Array.isArray(candidate.user_queue) &&
    Array.isArray(candidate.available_players)
  );
}

// @spec DFF-UI-121
function isQueuePayload(payload: unknown): payload is QueueEntry[] {
  if (!Array.isArray(payload)) {
    return false;
  }

  return payload.every((entry) => {
    if (!entry || typeof entry !== 'object') {
      return false;
    }

    const candidate = entry as Partial<QueueEntry>;
    return typeof candidate.playerId === 'string' && typeof candidate.rank === 'number';
  });
}

// @spec DFF-UI-080
async function hydrateDraftState(
  draftId: string,
  dispatch: Dispatch<DraftAction>,
  actionType: 'STATE_SYNC' | 'LOAD_DRAFT',
): Promise<boolean> {
  const response = await fetch(`/drafts/${draftId}/state`);

  if (!response.ok) {
    throw new Error(GENERIC_DRAFT_LOAD_ERROR);
  }

  const payload = await response.json();

  if (!isStateSyncPayload(payload)) {
    throw new Error(GENERIC_DRAFT_LOAD_ERROR);
  }

  dispatch({ type: actionType, payload });
  return true;
}

// @spec DFF-UI-121
async function hydrateDraftQueue(draftId: string, dispatch: Dispatch<DraftAction>): Promise<void> {
  const response = await fetch(`/drafts/${draftId}/queue`);

  if (!response.ok) {
    throw new Error(GENERIC_QUEUE_LOAD_ERROR);
  }

  const payload = await response.json();

  if (!isQueuePayload(payload)) {
    throw new Error(GENERIC_QUEUE_LOAD_ERROR);
  }

  dispatch({ type: 'QUEUE_SYNC', queue: payload });
}

// @spec DFF-UI-083
function DraftToast({ message }: ToastProps) {
  return (
    <div
      role="alert"
      className="fixed right-6 top-6 z-10 max-w-sm rounded-2xl border border-red-400/40 bg-red-950/90 px-4 py-3 text-sm text-red-100 shadow-2xl shadow-black/30"
    >
      {message}
    </div>
  );
}

// @spec DFF-STATIC-060
// @spec DFF-STATIC-061
export function useDraftContext(): DraftContextValue {
  const value = useContext(DraftContext);

  if (!value) {
    throw new Error(DRAFT_CONTEXT_ERROR);
  }

  return value;
}

// @spec DFF-STATIC-063
export function DraftContextProvider({
  value,
  children,
}: PropsWithChildren<{ value: DraftContextValue }>) {
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

// @spec DFF-UI-072
// @spec DFF-UI-083
function handleStreamDisconnect(
  cleanupCurrentSource: () => void,
  dispatch: Dispatch<DraftAction>,
  reconnectAttemptRef: { current: number },
  reconnectTimerRef: { current: number | null },
  connect: () => void,
  onDisconnectExhausted: () => void,
) {
  cleanupCurrentSource();
  dispatch({ type: 'SSE_STATUS', status: 'disconnected' });

  const reconnectDelay = RECONNECT_DELAYS_MS[reconnectAttemptRef.current];

  if (reconnectDelay === undefined) {
    onDisconnectExhausted();
    return;
  }

  reconnectAttemptRef.current += 1;
  reconnectTimerRef.current = window.setTimeout(() => {
    reconnectTimerRef.current = null;
    connect();
  }, reconnectDelay);
}

// @spec DFF-STATIC-062
// @spec DFF-UI-071
// @spec DFF-UI-072
// @spec DFF-UI-073
// @spec DFF-UI-074
// @spec DFF-UI-082
// @spec DFF-UI-083
function useDraftStream(
  draftId: string | null,
  dispatch: Dispatch<DraftAction>,
  onDisconnectExhausted: () => void,
): void {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const disposedRef = useRef(false);
  const onDisconnectExhaustedRef = useRef(onDisconnectExhausted);

  useEffect(() => {
    onDisconnectExhaustedRef.current = onDisconnectExhausted;
  }, [onDisconnectExhausted]);

  useEffect(() => {
    disposedRef.current = false;

    if (!draftId) {
      return () => {
        disposedRef.current = true;
      };
    }

    function cleanupCurrentSource() {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    }

    function cleanupTimer() {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }

    function setConnectedFromMessage() {
      reconnectAttemptRef.current = 0;
      dispatch({ type: 'SSE_STATUS', status: 'connected' });
    }

    function connect() {
      if (disposedRef.current) {
        return;
      }

      cleanupCurrentSource();
      dispatch({ type: 'SSE_STATUS', status: 'connecting' });

      const eventSource = new EventSource(`/drafts/${draftId}/stream`);
      eventSourceRef.current = eventSource;

      function registerMessageListener<TPayload>(
        eventName: string,
        listener: (payload: TPayload, source: EventSource) => void,
      ) {
        eventSource.addEventListener(eventName, (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent<string>).data) as TPayload;
            setConnectedFromMessage();
            listener(payload, eventSource);
          } catch {
            handleStreamDisconnect(
              cleanupCurrentSource,
              dispatch,
              reconnectAttemptRef,
              reconnectTimerRef,
              connect,
              onDisconnectExhaustedRef.current,
            );
          }
        });
      }

      registerMessageListener<StateSyncPayload>('state_sync', (payload) => {
        dispatch({ type: 'STATE_SYNC', payload });
      });
      registerMessageListener<PickMadePayload>('pick_made', (payload) => {
        dispatch({ type: 'PICK_MADE', payload });
      });
      registerMessageListener<YourTurnPayload>('your_turn', (payload) => {
        dispatch({ type: 'YOUR_TURN', payload });
      });
      registerMessageListener<TradeOfferedPayload>('trade_offered', (payload) => {
        dispatch({ type: 'TRADE_OFFERED', payload });
      });
      registerMessageListener<TradeResolvedPayload>('trade_resolved', (payload) => {
        dispatch({ type: 'TRADE_RESOLVED', payload });
      });
      registerMessageListener<DraftCompletePayload>('draft_complete', (payload, source) => {
        dispatch({ type: 'DRAFT_COMPLETE', payload });
        source.close();
        if (eventSourceRef.current === source) {
          eventSourceRef.current = null;
        }
      });

      eventSource.onerror = () => {
        handleStreamDisconnect(
          cleanupCurrentSource,
          dispatch,
          reconnectAttemptRef,
          reconnectTimerRef,
          connect,
          onDisconnectExhaustedRef.current,
        );
      };
    }

    connect();

    return () => {
      disposedRef.current = true;
      cleanupTimer();
      cleanupCurrentSource();
    };
  }, [dispatch, draftId]);
}

// @spec DFF-STATIC-060
// @spec DFF-STATIC-062
// @spec DFF-UI-082
// @spec DFF-UI-083
export function HttpDraftContextProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(draftReducer, {
    draftState: null,
    sessionHistory: [],
  });
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const startDraftInFlightRef = useRef(false);

  useDraftStream(state.draftState?.draftId ?? null, dispatch, () => {
    setToastMessage(GENERIC_DISCONNECT_ERROR);
  });

  useEffect(() => {
    if (!toastMessage) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setToastMessage(null);
    }, 6_000);

    return () => window.clearTimeout(timeoutId);
  }, [toastMessage]);

  // @spec DFF-UI-117
  function showError(message: string) {
    setToastMessage(message);
  }

  // @spec DFF-UI-014
  // @spec DFF-UI-015
  // @spec DFF-UI-119
  async function startDraft(config: DraftConfig) {
    if (startDraftInFlightRef.current) {
      return;
    }

    startDraftInFlightRef.current = true;
    setToastMessage(null);
    let draftCreated = false;

    try {
      const response = await fetch('/drafts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          configName: config.name,
          teamCount: config.teamCount,
          rounds: config.rounds,
          scoringFormat: config.scoringFormat,
          pickPosition: config.userPickPosition,
          futurePickYears: config.futurePickYears,
          rosterSlots: {
            QB: config.rosterConfig.QB,
            RB: config.rosterConfig.RB,
            WR: config.rosterConfig.WR,
            TE: config.rosterConfig.TE,
            FLEX: config.rosterConfig.FLEX,
            SF: config.rosterConfig.SF,
            BN: config.rosterConfig.bench,
          },
        }),
      });

      if (!response.ok) {
        const message = (await response.text().catch(() => '')).trim();

        if (response.status >= 400 && response.status < 500 && message) {
          throw new DraftCreateUiError(message);
        }

        throw new DraftCreateUiError(GENERIC_DRAFT_CREATE_ERROR);
      }

      const payload = await readJsonResponse(response);
      const draftId = parseDraftCreateResponse(payload);
      dispatch({ type: 'DRAFT_CREATED', draftId });
      draftCreated = true;
      await hydrateDraftState(draftId, dispatch, 'STATE_SYNC');
      await hydrateDraftQueue(draftId, dispatch).catch(() => {
        setToastMessage(GENERIC_QUEUE_LOAD_ERROR);
      });
    } catch (error) {
      if (draftCreated && error instanceof Error && error.message === GENERIC_DRAFT_LOAD_ERROR) {
        dispatch({ type: 'NEW_DRAFT' });
      }

      setToastMessage(
        error instanceof DraftCreateUiError
          ? error.message
          : error instanceof Error && error.message === GENERIC_DRAFT_LOAD_ERROR
            ? GENERIC_DRAFT_LOAD_ERROR
            : GENERIC_DRAFT_CREATE_ERROR,
      );
    } finally {
      startDraftInFlightRef.current = false;
    }
  }

  // @spec DFF-STATIC-060
  // @spec DFF-STATIC-062
  // @spec DFF-UI-084
  async function submitPick(playerId: string) {
    const draftId = state.draftState?.draftId;

    if (!draftId) {
      return;
    }

    try {
      dispatch({ type: 'ADVISOR_RESET' });
      const response = await fetch(`/drafts/${draftId}/pick`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ playerId }),
      });

      if (!response.ok) {
        throw new Error(GENERIC_PICK_ERROR);
      }
    } catch {
      setToastMessage(GENERIC_PICK_ERROR);
    }
  }

  // @spec DFF-UI-053
  // @spec DFF-UI-054
  // @spec DFF-UI-055
  async function respondToTrade(status: TradeResponseStatus): Promise<boolean> {
    const draftId = state.draftState?.draftId;

    if (!draftId) {
      return false;
    }

    try {
      const response = await fetch(`/drafts/${draftId}/trade-response`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        throw new Error(GENERIC_TRADE_RESPONSE_ERROR);
      }

      return true;
    } catch {
      setToastMessage(GENERIC_TRADE_RESPONSE_ERROR);
      return false;
    }
  }

  // @spec DFF-UI-059
  async function submitTradeOffer(
    targetTeamId: string,
    offeredAssets: unknown[],
    requestedAssets: unknown[],
  ): Promise<SubmitTradeOfferResult> {
    const draftId = state.draftState?.draftId;

    if (!draftId) {
      return { ok: false, tradeId: null };
    }

    try {
      const response = await fetch(`/drafts/${draftId}/trade-offer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          targetTeamId,
          offeredAssets,
          requestedAssets,
        }),
      });

      if (!response.ok) {
        throw new Error(GENERIC_TRADE_OFFER_ERROR);
      }

      const payload = (await response.json().catch(() => null)) as { tradeId?: unknown } | null;
      return {
        ok: true,
        tradeId: typeof payload?.tradeId === 'string' ? payload.tradeId : null,
      };
    } catch {
      setToastMessage(GENERIC_TRADE_OFFER_ERROR);
      return { ok: false, tradeId: null };
    }
  }

  // @spec DFF-STATIC-060
  // @spec DFF-STATIC-062
  async function updateQueue(queue: QueueEntry[]) {
    const draftId = state.draftState?.draftId;

    if (!draftId) {
      return;
    }

    try {
      await fetch(`/drafts/${draftId}/queue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ queue }),
      });
    } catch {
      setToastMessage('Queue update failed. Try again.');
    }
  }

  // @spec DFF-UI-113
  // @spec DFF-UI-114
  async function loadDraft(draftId: string) {
    try {
      const didLoad = await hydrateDraftState(draftId, dispatch, 'LOAD_DRAFT');
      await hydrateDraftQueue(draftId, dispatch).catch(() => {
        setToastMessage(GENERIC_QUEUE_LOAD_ERROR);
      });
      return didLoad;
    } catch {
      setToastMessage(GENERIC_DRAFT_LOAD_ERROR);
      return false;
    }
  }

  // @spec DFF-STATIC-060
  // @spec DFF-STATIC-062
  function newDraft() {
    setToastMessage(null);
    dispatch({ type: 'NEW_DRAFT' });
  }

  return (
    <DraftContext.Provider
      value={{
        snapshot: null,
        draftState: state.draftState,
        sessionHistory: state.sessionHistory,
        startDraft,
        loadDraft,
        showError,
        submitPick,
        respondToTrade,
        submitTradeOffer,
        updateQueue,
        newDraft,
      }}
    >
      {toastMessage ? <DraftToast message={toastMessage} /> : null}
      {children}
    </DraftContext.Provider>
  );
}
