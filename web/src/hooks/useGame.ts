import { useCallback, useMemo, useReducer } from 'react';
import { BOARD_SIZE, type Stone } from '@/game/types';
import { checkWinner, emptyBoard, idx } from '@/game/rules';

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

const initial: GameState = {
  board: emptyBoard(),
  history: [],
  toMove: 1,
  winner: 0,
  winLine: null,
};

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'reset':
      return initial;
    case 'play': {
      if (state.winner !== 0) return state;
      const { x, y } = action;
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
    case 'undo': {
      if (state.history.length === 0) return state;
      const history = state.history.slice(0, -1);
      const board = emptyBoard();
      let toMove: Stone = 1;
      for (const [x, y] of history) {
        board[idx(x, y)] = toMove;
        toMove = toMove === 1 ? 2 : 1;
      }
      return { board, history, toMove, winner: 0, winLine: null };
    }
    case 'loadHistory': {
      const board = emptyBoard();
      let toMove: Stone = 1;
      let winner: Stone = 0;
      let winLine: [number, number][] | null = null;
      for (const [x, y] of action.moves) {
        if (winner !== 0) break;
        board[idx(x, y)] = toMove;
        const line = checkWinner(board, x, y, toMove);
        if (line) {
          winner = toMove;
          winLine = line;
        }
        toMove = toMove === 1 ? 2 : 1;
      }
      return { board, history: action.moves.slice(), toMove, winner, winLine };
    }
  }
}

export function useGame() {
  const [state, dispatch] = useReducer(reducer, initial);
  const play = useCallback((x: number, y: number) => dispatch({ type: 'play', x, y }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);
  const lastMove = useMemo<[number, number] | null>(
    () => (state.history.length > 0 ? state.history[state.history.length - 1] : null),
    [state.history],
  );
  return { state, play, undo, reset, lastMove };
}
