import { useEffect, useState } from 'react';
import { type Engine, SupersededError } from './useEngine';
import type { ScoredMove, Stone } from '@/game/types';

export interface AnalysisResult {
  candidates: ScoredMove[];
  /// Score normalised to black's perspective — positive is good for black,
  /// negative for white. Converted inside this hook so consumers don't need
  /// to worry about the current side flipping between request and response.
  blackScore: number | null;
  loading: boolean;
  tookMs: number | null;
  /// Timestamp (performance.now()) when the current computation started, or
  /// null when idle. Consumers use this to render a progress indicator
  /// against the known time budget.
  startedAt: number | null;
  /// The time budget (ms) the engine is running with. `0` signals
  /// unlimited — progress UI should render an indeterminate animation.
  budgetMs: number;
}

interface Options {
  enabled: boolean;
  toMove: Stone;
  gameOver: boolean;
  budgetMs: number;
  maxDepth: number;
}

const CANDIDATE_COUNT = 5;
// Debounce the analysis trigger. Rapid slider drags or quick clicks used to
// queue (and evict) many requests in flight. The command queue in useEngine
// already drops superseded requests; this additional delay cuts down on the
// UI-side "flash loading → clear → flash loading" cycle during drags.
const DEBOUNCE_MS = 150;

export function useAnalysis(
  engine: Engine,
  history: [number, number][],
  opts: Options,
): AnalysisResult {
  const [state, setState] = useState<AnalysisResult>({
    candidates: [],
    blackScore: null,
    loading: false,
    tookMs: null,
    startedAt: null,
    budgetMs: opts.budgetMs,
  });

  const budget = opts.budgetMs;
  const depth = opts.maxDepth;

  useEffect(() => {
    if (!engine.ready || !opts.enabled || opts.gameOver) {
      setState((s) =>
        s.loading || s.candidates.length > 0 || s.blackScore !== null
          ? {
              ...s,
              candidates: [],
              blackScore: null,
              loading: false,
              startedAt: null,
            }
          : s,
      );
      return;
    }

    let cancelled = false;

    const kick = setTimeout(() => {
      const startedAt = performance.now();
      setState({
        candidates: [],
        blackScore: null,
        loading: true,
        tookMs: null,
        startedAt,
        budgetMs: budget,
      });

      const snap: [number, number][] = history.slice();
      const scorerSide = opts.toMove;

      (async () => {
        try {
          const top = await engine.topCandidates(snap, CANDIDATE_COUNT, depth, budget);
          if (cancelled) return;
          const tookMs = Math.round(performance.now() - startedAt);
          const engineScore = top.length > 0 ? top[0].score : 0;
          const blackScore = scorerSide === 1 ? engineScore : -engineScore;
          console.log(
            `[analysis] moves=${snap.length} d=${depth} cap=${budget}ms took=${tookMs}ms cand=${top.length} blackScore=${blackScore}`,
          );
          setState({
            candidates: top,
            blackScore,
            loading: false,
            tookMs,
            startedAt: null,
            budgetMs: budget,
          });
        } catch (err) {
          if (cancelled) return;
          if (err instanceof SupersededError) return;
          console.error('[analysis] failed', err);
          setState((s) => ({ ...s, loading: false, startedAt: null }));
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(kick);
    };
  }, [engine, history, opts.enabled, opts.gameOver, opts.toMove, budget, depth]);

  return state;
}
