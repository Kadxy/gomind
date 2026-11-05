import { checkWinner, emptyBoard, idx } from '@/game/rules';
import { BOARD_SIZE, type Stone } from '@/game/types';
import { useCallback, useMemo, useReducer } from 'react';

export interface GameState {
  board: Stone[];
  history: [number, number][];
  toMove: Stone;
  winner: Stone;
  winLine: [number, number][] | null;
}

type Action =
  | { type: 'reset' }
  | { type: 'play'; x: number; y: number }
  | { type: 'undo' }
  | { type: 'loadHistory'; moves: [number, number][] };

export const initialGame: GameState = {
  board: emptyBoard(),
  history: [],
  toMove: 1,
  winner: 0,
  winLine: null,
};
const initial = initialGame;

/** Replay a move list into a full GameState (stops at the first five). */
export function gameFromHistory(moves: [number, number][]): GameState {
  const board = emptyBoard();
  let toMove: Stone = 1;
  let winner: Stone = 0;
  let winLine: [number, number][] | null = null;
  const history: [number, number][] = [];
  for (const [x, y] of moves) {
    if (winner !== 0) break;
    if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE || board[idx(x, y)] !== 0) break;
    board[idx(x, y)] = toMove;
    history.push([x, y]);
    const line = checkWinner(board, x, y, toMove);
    if (line) {
      winner = toMove;
      winLine = line;
    }
    toMove = toMove === 1 ? 2 : 1;
  }
  return { board, history, toMove, winner, winLine };
}

/** Apply one move; returns the same state if the move is illegal. */
export function playMove(state: GameState, x: number, y: number): GameState {
  if (state.winner !== 0) return state;
  if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) return state;
  const at = idx(x, y);
  if (state.board[at] !== 0) return state;
  const board = state.board.slice();
  board[at] = state.toMove;
  const line = checkWinner(board, x, y, state.toMove);
  return {
    board,
    history: [...state.history, [x, y]],
    toMove: state.toMove === 1 ? 2 : 1,
    winner: line ? state.toMove : 0,
    winLine: line,
  };
}

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'reset':
      return initial;
    case 'play':
      return playMove(state, action.x, action.y);
    case 'undo':
      if (state.history.length === 0) return state;
      return gameFromHistory(state.history.slice(0, -1));
    case 'loadHistory':
      return gameFromHistory(action.moves);
  }
}

export function useGame() {
  const [state, dispatch] = useReducer(reducer, initial);
  const play = useCallback((x: number, y: number) => dispatch({ type: 'play', x, y }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);
  // Replace the whole game with a move list (remote sync, agreed undo).
  const load = useCallback(
    (moves: [number, number][]) => dispatch({ type: 'loadHistory', moves }),
    [],
  );
  const lastMove = useMemo<[number, number] | null>(
    () => (state.history.length > 0 ? state.history[state.history.length - 1] : null),
    [state.history],
  );
  return { state, play, undo, reset, load, lastMove };
}
