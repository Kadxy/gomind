// State for one online match: configuration, board, clocks, result and the
// single in-flight consent request. A pure reducer so the whole thing can be
// snapshotted to localStorage, rebuilt from a `sync`, and unit-tested.

import {
  type ClockState,
  clockFromSnapshot,
  commitMove,
  newClock,
  pauseClock,
  resumeClock,
  snapshotClock,
  startTurn,
  stopClock,
} from '@/game/online';
import type { GameResult, RequestKind, SyncMsg, TimeControl } from '@/game/peer-protocol';
import { BOARD_SIZE, type Stone } from '@/game/types';
import { type GameState, gameFromHistory, initialGame, playMove } from '@/hooks/useGame';
import { useCallback, useReducer, useRef } from 'react';

export interface PendingRequest {
  kind: RequestKind;
  /** 'out' = we asked and are waiting; 'in' = the opponent asked us. */
  dir: 'in' | 'out';
  /** undo: number of moves that remain after the take-back. */
  to?: number;
  /** reset: proposed time control for the new game. */
  timeControl?: TimeControl;
}

export interface MatchState {
  hostSide: Stone;
  timeControl: TimeControl;
  /** True once a `sync` has been exchanged, i.e. both players have a game. */
  started: boolean;
  game: GameState;
  clock: ClockState;
  result: GameResult | null;
  pending: PendingRequest | null;
}

export type MatchAction =
  | { type: 'clear' }
  | { type: 'configure'; hostSide: Stone; timeControl: TimeControl }
  | { type: 'start'; now: number }
  | { type: 'adoptSync'; msg: SyncMsg; now: number }
  | { type: 'restore'; state: Omit<MatchState, 'pending'>; now: number }
  | { type: 'move'; x: number; y: number; now: number; reportedClock?: number | null }
  | { type: 'undoTo'; to: number; now: number }
  | { type: 'newGame'; timeControl: TimeControl; now: number }
  | { type: 'finish'; result: GameResult }
  | { type: 'pause'; now: number }
  | { type: 'resume'; now: number }
  | { type: 'pendingSet'; pending: PendingRequest }
  | { type: 'pendingClear' };

const UNLIMITED: TimeControl = { main: null, perMove: null };

export const initialMatch: MatchState = {
  hostSide: 1,
  timeControl: UNLIMITED,
  started: false,
  game: initialGame,
  clock: newClock(UNLIMITED),
  result: null,
  pending: null,
};

function terminalResult(game: GameState): GameResult | null {
  if (game.winner !== 0) return { kind: 'five', winner: game.winner };
  if (game.history.length >= BOARD_SIZE * BOARD_SIZE) return { kind: 'full', winner: 0 };
  return null;
}

export function matchReducer(state: MatchState, action: MatchAction): MatchState {
  switch (action.type) {
    case 'clear':
      return initialMatch;

    case 'configure':
      return { ...state, hostSide: action.hostSide, timeControl: action.timeControl };

    case 'start':
      return {
        ...state,
        started: true,
        game: initialGame,
        clock: startTurn(newClock(state.timeControl), 1, action.now),
        result: null,
        pending: null,
      };

    case 'adoptSync': {
      const { msg, now } = action;
      const game = gameFromHistory(msg.history);
      const result = msg.result ?? terminalResult(game);
      const clock = result
        ? stopClock(clockFromSnapshot(msg.timeControl, msg.clocks, 0, now))
        : clockFromSnapshot(msg.timeControl, msg.clocks, game.toMove, now);
      return {
        hostSide: msg.hostSide,
        timeControl: msg.timeControl,
        started: true,
        game,
        clock,
        result,
        pending: null,
      };
    }

    case 'restore':
      // Local snapshot from before a refresh. Clocks come back paused until
      // the room is live again (the opponent's sync will replace them).
      return { ...action.state, pending: null, clock: pauseClock(action.state.clock, action.now) };

    case 'move': {
      if (state.result) return state;
      const game = playMove(state.game, action.x, action.y);
      if (game === state.game) return state;
      const result = terminalResult(game);
      let clock = commitMove(state.clock, action.now, action.reportedClock);
      if (result) clock = stopClock(clock);
      // Pending requests are resolved explicitly by the caller (moving
      // declines an incoming one and withdraws our own), except at game end.
      return { ...state, game, clock, result, pending: result ? null : state.pending };
    }

    case 'undoTo': {
      const to = Math.max(0, Math.min(action.to, state.game.history.length));
      const game = gameFromHistory(state.game.history.slice(0, to));
      return {
        ...state,
        game,
        clock: startTurn(state.clock, game.toMove, action.now),
        result: null,
        pending: null,
      };
    }

    case 'newGame':
      return {
        ...state,
        timeControl: action.timeControl,
        started: true,
        game: initialGame,
        clock: startTurn(newClock(action.timeControl), 1, action.now),
        result: null,
        pending: null,
      };

    case 'finish':
      if (state.result) return state;
      return { ...state, result: action.result, clock: stopClock(state.clock), pending: null };

    case 'pause':
      return { ...state, clock: pauseClock(state.clock, action.now) };
    case 'resume':
      return { ...state, clock: resumeClock(state.clock, action.now) };

    case 'pendingSet':
      return { ...state, pending: action.pending };
    case 'pendingClear':
      return state.pending ? { ...state, pending: null } : state;
  }
}

/** Build the `sync` payload (minus v/ts) describing `state` as of `now`. */
export function syncFromState(state: MatchState, now: number): Omit<SyncMsg, 'v' | 'ts'> {
  return {
    t: 'sync',
    hostSide: state.hostSide,
    timeControl: state.timeControl,
    history: state.game.history,
    clocks: snapshotClock(state.clock, now),
    result: state.result,
  };
}

/**
 * Match state plus a synchronous mirror. Socket handlers must decide based
 * on the state *including* actions they dispatched a moment ago (e.g. reply
 * to a sync request right after starting the game), which React state
 * can't give them until the next render. Every update goes through
 * `apply`, so `stateRef.current` and React's copy run the same reducer over
 * the same actions and never diverge.
 */
export function useOnlineMatch() {
  const [state, dispatch] = useReducer(matchReducer, initialMatch);
  const stateRef = useRef<MatchState>(state);
  const apply = useCallback((action: MatchAction): MatchState => {
    stateRef.current = matchReducer(stateRef.current, action);
    dispatch(action);
    return stateRef.current;
  }, []);
  return { state, stateRef, apply };
}
