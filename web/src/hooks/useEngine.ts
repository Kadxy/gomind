import type { Move, ScoredMove } from '@/game/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type WorkerRes =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

type WorkerEvent = { type: 'progress'; loaded: number; total: number };

export interface EngineLoad {
  loaded: number;
  total: number;
}

export interface DepthTrace {
  depth: number;
  timeMs: number;
  nodes: number;
  x: number;
  y: number;
  score: number;
  completed: boolean;
}

export interface Engine {
  ready: boolean;
  /** Data-package download progress while initialising; null before it starts. */
  loading: EngineLoad | null;
  /** Init failed (e.g. network); the engine stays unavailable until reload. */
  failed: boolean;
  threads: number;
  bestMove: (
    moves: [number, number][],
    maxDepth: number,
    timeMs: number,
  ) => Promise<ScoredMove | null>;
  topCandidates: (
    moves: [number, number][],
    n: number,
    depth: number,
    timeMs: number,
  ) => Promise<ScoredMove[]>;
  evaluate: (moves: [number, number][]) => Promise<number>;
  benchmark: (moves: [number, number][], maxDepth: number, timeMs: number) => Promise<DepthTrace[]>;
}

/** Error thrown when a queued request is evicted by a newer one for the same
 * command. Callers (e.g. useAnalysis) treat this as a silent no-op — the
 * superseding call will produce the final state. */
export class SupersededError extends Error {
  constructor(cmd: string) {
    super(`superseded: ${cmd}`);
    this.name = 'SupersededError';
  }
}

/**
 * Owns a Web Worker hosting the WASM Gomoku engine.
 *
 * Latest-wins semantics: a new bestMove/topCandidates always preempts an
 * in-flight search on the worker side (via YXSTOP → see rapfiWorker.ts),
 * and cleanly rejects the stale caller's promise with SupersededError so
 * downstream (useAnalysis, LocalApp PvC effect) can swallow it silently.
 *
 * That means we DON'T queue in the main thread anymore — we just send and
 * let the worker preempt. This is the fix for the "UI frozen for seconds
 * because the old search is still running" bug: rapid slider drags and
 * move clicks now cancel the previous search immediately instead of
 * stacking a minute's worth of obsolete work.
 */
export function useEngine(): Engine {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(new Map<number, (res: WorkerRes) => void>());
  const nextIdRef = useRef(1);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState<EngineLoad | null>(null);
  const [failed, setFailed] = useState(false);
  const [threads, setThreads] = useState(1);

  useEffect(() => {
    // Classic worker (not module) because Rapfi is an Emscripten IIFE that
    // attaches to the worker's global scope via `importScripts`; module
    // workers can't see that binding.
    const w = new Worker(new URL('../lib/rapfiWorker.ts', import.meta.url));
    workerRef.current = w;
    w.onmessage = (ev: MessageEvent<WorkerRes | WorkerEvent>) => {
      const msg = ev.data;
      if ('type' in msg) {
        if (msg.type === 'progress') setLoading({ loaded: msg.loaded, total: msg.total });
        return;
      }
      const res = msg;
      const cb = pendingRef.current.get(res.id);
      if (cb) {
        pendingRef.current.delete(res.id);
        cb(res);
      }
    };
    // prime
    const initId = nextIdRef.current++;
    pendingRef.current.set(initId, (res) => {
      if (res.ok) {
        const info = res.result as { size: number; threads: number };
        console.log(`[engine] ready (threads=${info.threads})`);
        setThreads(info.threads);
        setReady(true);
      } else {
        console.error('[engine] init failed', res.error);
        setFailed(true);
      }
    });
    w.postMessage({ id: initId, cmd: 'init' });

    return () => {
      w.terminate();
      workerRef.current = null;
      pendingRef.current.clear();
    };
  }, []);

  const rawCall = useCallback(<T>(cmd: string, payload: Record<string, unknown>): Promise<T> => {
    const w = workerRef.current;
    if (!w) return Promise.reject(new Error('worker not ready'));
    const id = nextIdRef.current++;
    return new Promise<T>((resolve, reject) => {
      pendingRef.current.set(id, (res) => {
        if (res.ok) {
          resolve(res.result as T);
        } else if (res.error === 'aborted') {
          // Worker preempted this request — translate to SupersededError so
          // callers that care (useAnalysis, the PvC effect) can swallow it.
          reject(new SupersededError(cmd));
        } else {
          reject(new Error(res.error));
        }
      });
      w.postMessage({ id, cmd, ...payload });
    });
  }, []);

  const bestMove = useCallback(
    async (moves: [number, number][], maxDepth: number, timeMs: number) => {
      try {
        const r = await rawCall<{
          x: number;
          y: number;
          score: number;
          completed_depth: number;
          timed_out: boolean;
          time_ms: number;
          nodes: number;
        } | null>('bestMove', { moves, maxDepth, timeMs });
        if (!r) return null;
        console.log(
          `[engine:bestMove] depth=${r.completed_depth}/${maxDepth} ${
            r.timed_out ? '[TIMED_OUT]' : '[COMPLETED]'
          } time=${r.time_ms}ms nodes=${r.nodes} score=${r.score}`,
        );
        return { x: r.x, y: r.y, score: r.score };
      } catch (err) {
        if (err instanceof SupersededError) throw err;
        console.error('[engine:bestMove] failed', err);
        throw err;
      }
    },
    [rawCall],
  );

  const topCandidates = useCallback(
    async (moves: [number, number][], n: number, depth: number, timeMs: number) => {
      try {
        const r = await rawCall<{
          candidates: { x: number; y: number; score: number }[];
          processed: number;
          total: number;
          time_ms: number;
          nodes: number;
          timed_out: boolean;
          completed_depth: number;
        }>('topCandidates', { moves, n, depth, timeMs });
        console.log(
          `[engine:topCandidates] depth=${r.completed_depth}/${depth} ${
            r.timed_out ? '[TIMED_OUT]' : '[COMPLETED]'
          } scored=${r.processed}/${r.total} time=${r.time_ms}ms nodes=${r.nodes}`,
        );
        return r.candidates.map((m): ScoredMove => ({ x: m.x, y: m.y, score: m.score }));
      } catch (err) {
        if (err instanceof SupersededError) throw err;
        console.error('[engine:topCandidates] failed', err);
        throw err;
      }
    },
    [rawCall],
  );

  const evaluate = useCallback(
    async (moves: [number, number][]) => {
      return rawCall<number>('evaluate', { moves });
    },
    [rawCall],
  );

  const benchmark = useCallback(
    async (moves: [number, number][], maxDepth: number, timeMs: number) => {
      const r = await rawCall<
        {
          depth: number;
          time_ms: number;
          nodes: number;
          x: number;
          y: number;
          score: number;
          completed: boolean;
        }[]
      >('benchmark', { moves, maxDepth, timeMs });
      return r.map(
        (t): DepthTrace => ({
          depth: t.depth,
          timeMs: t.time_ms,
          nodes: t.nodes,
          x: t.x,
          y: t.y,
          score: t.score,
          completed: t.completed,
        }),
      );
    },
    [rawCall],
  );

  return useMemo<Engine>(
    () => ({ ready, loading, failed, threads, bestMove, topCandidates, evaluate, benchmark }),
    [ready, loading, failed, threads, bestMove, topCandidates, evaluate, benchmark],
  );
}

export type { Move };
