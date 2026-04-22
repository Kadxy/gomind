import { BOARD_SIZE, type Stone } from './types';

/** Frontend-side winner check as a safety net independent from the engine. */
export function checkWinner(
  board: Stone[],
  x: number,
  y: number,
  player: Stone,
): [number, number][] | null {
  const dirs: [number, number][] = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  for (const [dx, dy] of dirs) {
    // walk back to the start of the run
    let sx = x;
    let sy = y;
    while (inBounds(sx - dx, sy - dy) && board[idx(sx - dx, sy - dy)] === player) {
      sx -= dx;
      sy -= dy;
    }
    const line: [number, number][] = [];
    let cx = sx;
    let cy = sy;
    while (inBounds(cx, cy) && board[idx(cx, cy)] === player) {
      line.push([cx, cy]);
      cx += dx;
      cy += dy;
    }
    if (line.length >= 5) {
      return line.slice(0, 5);
    }
  }
  return null;
}

export function idx(x: number, y: number): number {
  return y * BOARD_SIZE + x;
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE;
}

export function emptyBoard(): Stone[] {
  return new Array(BOARD_SIZE * BOARD_SIZE).fill(0);
}

/** Sigmoid win-rate mapping used for the advantage bar.
 *
 *  Calibrated for Rapfi's NNUE eval scale (roughly centipawn-like):
 *    eval ~200        ≈ 57-60%   (slight edge)
 *    eval ~500        ≈ 65-70%   (meaningful advantage)
 *    eval ~1000       ≈ 80%      (winning position)
 *    eval ~2000       ≈ 94%      (very winning)
 *    +M/-M (mapped to ±1M in rapfiWorker)  →  terminal, 99%/1%
 *
 *  Earlier versions of this file used k=1/80_000, which was calibrated for
 *  our hand-rolled engine whose scores ran into the hundreds of thousands
 *  for an open-three. Rapfi's NNUE outputs two-to-four digit evals for the
 *  same positions, so we rescale here. Final k is a judgment call — feel
 *  free to retune by watching a few games.
 *
 *  Hard-capped to [0.05, 0.95] unless a true terminal score is passed in.
 */
export const TERMINAL_THRESHOLD = 500_000;

export function scoreToWinRate(score: number): number {
  const terminal = Math.abs(score) >= TERMINAL_THRESHOLD;
  if (terminal) {
    return score > 0 ? 0.99 : 0.01;
  }
  const k = 1 / 700;
  const raw = 1 / (1 + Math.exp(-score * k));
  return Math.max(0.05, Math.min(0.95, raw));
}
