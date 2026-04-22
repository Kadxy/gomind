export const BOARD_SIZE = 15;

export type Stone = 0 | 1 | 2; // 0=empty, 1=black, 2=white

export type Mode = 'pvp-local' | 'pvc' | 'selfplay';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'max';

export interface DifficultyPreset {
  label: string;
  maxDepth: number;
  timeBudgetMs: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyPreset> = {
  easy: { label: '简单', maxDepth: 2, timeBudgetMs: 200 },
  normal: { label: '普通', maxDepth: 3, timeBudgetMs: 800 },
  hard: { label: '困难', maxDepth: 4, timeBudgetMs: 3_000 },
  max: { label: '极限', maxDepth: 6, timeBudgetMs: 10_000 },
};

export interface Move {
  x: number;
  y: number;
}

export interface ScoredMove extends Move {
  score: number;
}

export interface EngineState {
  toMove: Stone; // whose turn (1 or 2)
  winner: Stone; // 0 = none
  moveCount: number;
  last: [number, number] | null;
  winLine: [number, number][] | null;
}
