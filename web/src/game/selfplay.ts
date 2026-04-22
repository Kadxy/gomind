import type { Engine } from '@/hooks/useEngine';
import type { Stone } from '@/game/types';
import { checkWinner } from '@/game/rules';

export interface SelfPlayStep {
  x: number;
  y: number;
  player: Stone;
  score: number;
}

export interface SelfPlayResult {
  moves: SelfPlayStep[];
  winner: Stone;
  aborted: boolean;
}

export interface SelfPlayOptions {
  /// Getters rather than numbers so slider changes take effect mid-game.
  getMaxDepth: () => number;
  getTimeMs: () => number;
  maxMoves?: number;
  shouldAbort?: () => boolean;
  /// Called right before `engine.bestMove` kicks off for a move. Lets the
  /// caller start a progress timer / UI signal scoped to this move.
  beforeMove?: () => void;
  onStep?: (step: SelfPlayStep, all: SelfPlayStep[]) => void | Promise<void>;
}

export async function selfPlay(engine: Engine, opts: SelfPlayOptions): Promise<SelfPlayResult> {
  const maxMoves = opts.maxMoves ?? 225;
  const moves: SelfPlayStep[] = [];
  let toMove: Stone = 1;

  for (let i = 0; i < maxMoves; i++) {
    if (opts.shouldAbort?.()) {
      return { moves, winner: 0, aborted: true };
    }
    opts.beforeMove?.();
    const history = moves.map((m): [number, number] => [m.x, m.y]);
    const best = await engine.bestMove(history, opts.getMaxDepth(), opts.getTimeMs());
    if (!best) break;
    if (opts.shouldAbort?.()) {
      return { moves, winner: 0, aborted: true };
    }

    const step: SelfPlayStep = { x: best.x, y: best.y, player: toMove, score: best.score };
    moves.push(step);
    await opts.onStep?.(step, moves);

    const flatBoard: Stone[] = new Array(15 * 15).fill(0);
    for (const m of moves) flatBoard[m.y * 15 + m.x] = m.player;
    const win = checkWinner(flatBoard, best.x, best.y, toMove);
    if (win) {
      return { moves, winner: toMove, aborted: false };
    }
    toMove = toMove === 1 ? 2 : 1;
  }
  return { moves, winner: 0, aborted: false };
}
