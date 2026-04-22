import { AnalysisPanel } from '@/components/AnalysisPanel';
import { Board } from '@/components/Board';
import { Controls } from '@/components/Controls';
import { EnginePanel } from '@/components/EnginePanel';
import { ModeSelect } from '@/components/ModeSelect';
import { LocalTurnBadge } from '@/components/TurnBadge';
import { Button } from '@/components/ui/Button';
import { selfPlay } from '@/game/selfplay';
import type { Mode, Stone } from '@/game/types';
import { useAnalysis } from '@/hooks/useAnalysis';
import { SupersededError, useEngine } from '@/hooks/useEngine';
import { useGame } from '@/hooks/useGame';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const SHOW_WINRATE_KEY = 'gomind.showWinrate';
const SHOW_CANDIDATES_KEY = 'gomind.showCandidates';

export function LocalApp() {
  const engine = useEngine();
  const { state, play, undo: rawUndo, reset } = useGame();

  const [mode, setMode] = useState<Mode>('pvp-local');
  const [humanSide, setHumanSide] = useState<Stone>(1);
  const [aiThinking, setAiThinking] = useState(false);
  const [aiStartedAt, setAiStartedAt] = useState<number | null>(null);
  const [selfPlaying, setSelfPlaying] = useState(false);
  const [selfPlayStartedAt, setSelfPlayStartedAt] = useState<number | null>(null);
  const [budgetMs, setBudgetMs] = useState(1_000);
  const [maxDepth, setMaxDepth] = useState(12);
  // Current score from black's POV (positive = good for black). Unifies
  // three sources: live analysis, AI moves (PvC), and self-play steps.
  const [blackScore, setBlackScore] = useState<number | null>(null);

  const [showWinrate, setShowWinrate] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const v = localStorage.getItem(SHOW_WINRATE_KEY);
    return v === null ? true : v === '1';
  });
  const [showCandidates, setShowCandidates] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const v = localStorage.getItem(SHOW_CANDIDATES_KEY);
    return v === null ? true : v === '1';
  });
  useEffect(() => {
    localStorage.setItem(SHOW_WINRATE_KEY, showWinrate ? '1' : '0');
  }, [showWinrate]);
  useEffect(() => {
    localStorage.setItem(SHOW_CANDIDATES_KEY, showCandidates ? '1' : '0');
  }, [showCandidates]);

  const aiBusyRef = useRef(false);
  // Session token for self-play. Each runSelfPlay bumps this; the running
  // loop's shouldAbort checks `current !== mySession`. Fixes the race where
  // a shared abort-boolean could be toggled back to false by a new start,
  // causing the previously-aborted loop to resume (two loops in parallel).
  const selfPlaySessionRef = useRef(0);
  // Refs track the latest slider values so a running self-play loop picks
  // up changes on its next move (closures capture stale values otherwise).
  const budgetMsRef = useRef(budgetMs);
  const maxDepthRef = useRef(maxDepth);
  useEffect(() => {
    budgetMsRef.current = budgetMs;
  }, [budgetMs]);
  useEffect(() => {
    maxDepthRef.current = maxDepth;
  }, [maxDepth]);

  // Mode or human-side changes should reset the game and tear down
  // any in-flight AI/self-play work. humanSide isn't read inside but
  // is listed so switching 黑/白 also resets the board.
  // biome-ignore lint/correctness/useExhaustiveDependencies: humanSide is a trigger
  useEffect(() => {
    selfPlaySessionRef.current += 1;
    reset();
    aiBusyRef.current = false;
    setAiThinking(false);
    setSelfPlaying(false);
    setBlackScore(null);
  }, [mode, humanSide, reset]);

  const analysisEnabled = useMemo(() => {
    if (!engine.ready) return false;
    if (mode === 'selfplay') return false;
    if (mode === 'pvc' && state.toMove !== humanSide) return false;
    return true;
  }, [engine.ready, mode, humanSide, state.toMove]);

  const analysis = useAnalysis(engine, state.history, {
    enabled: analysisEnabled,
    toMove: state.toMove,
    gameOver: state.winner !== 0,
    budgetMs,
    maxDepth,
  });

  // Fold analysis's (already black-POV) score into the unified blackScore.
  useEffect(() => {
    if (analysis.blackScore != null) {
      setBlackScore(analysis.blackScore);
    }
  }, [analysis.blackScore]);

  useEffect(() => {
    if (mode !== 'pvc') return;
    if (!engine.ready) return;
    if (state.winner !== 0) return;
    if (state.toMove === humanSide) return;
    if (aiBusyRef.current) return;

    aiBusyRef.current = true;
    setAiThinking(true);
    setAiStartedAt(performance.now());
    // Capture AI's side BEFORE the async call — state.toMove can change
    // by the time the promise resolves.
    const aiSide: Stone = state.toMove;
    const history = state.history.slice();
    engine
      .bestMove(history, maxDepth, budgetMs)
      .then((best) => {
        if (!best) return;
        const fromBlack = aiSide === 1 ? best.score : -best.score;
        setBlackScore(fromBlack);
        play(best.x, best.y);
      })
      .catch((err) => {
        if (err instanceof SupersededError) return;
        console.error('[ai] bestMove failed', err);
      })
      .finally(() => {
        aiBusyRef.current = false;
        setAiThinking(false);
        setAiStartedAt(null);
      });
  }, [
    mode,
    engine,
    state.toMove,
    state.winner,
    state.history,
    humanSide,
    play,
    maxDepth,
    budgetMs,
  ]);

  const runSelfPlay = useCallback(async () => {
    if (!engine.ready || selfPlaying) return;
    const mySession = ++selfPlaySessionRef.current;
    setSelfPlaying(true);
    reset();
    setBlackScore(null);
    try {
      await selfPlay(engine, {
        getMaxDepth: () => maxDepthRef.current,
        getTimeMs: () => budgetMsRef.current,
        shouldAbort: () => selfPlaySessionRef.current !== mySession,
        beforeMove: () => {
          if (selfPlaySessionRef.current !== mySession) return;
          setSelfPlayStartedAt(performance.now());
        },
        onStep: async (step) => {
          if (selfPlaySessionRef.current !== mySession) return;
          const fromBlack = step.player === 1 ? step.score : -step.score;
          setBlackScore(fromBlack);
          play(step.x, step.y);
          await new Promise<void>((r) => requestAnimationFrame(() => r()));
        },
      });
    } finally {
      if (selfPlaySessionRef.current === mySession) {
        setSelfPlaying(false);
        setSelfPlayStartedAt(null);
      }
    }
  }, [engine, selfPlaying, play, reset]);

  const handleReset = useCallback(() => {
    selfPlaySessionRef.current += 1;
    setSelfPlaying(false);
    setSelfPlayStartedAt(null);
    setBlackScore(null);
    reset();
  }, [reset]);

  // PvC undo: pop the AI's response AND the human's last move in one go,
  // so the human actually gets to replay their own move. Without this,
  // undoing one step just lets the engine re-think and play again.
  const handleUndo = useCallback(() => {
    if (mode === 'pvc' && state.history.length >= 2) {
      rawUndo();
      rawUndo();
    } else {
      rawUndo();
    }
    setBlackScore(null);
  }, [mode, state.history.length, rawUndo]);

  const humansTurn =
    mode === 'pvp-local' || (mode === 'pvc' && state.toMove === humanSide && !aiThinking);
  const canPlay = state.winner === 0 && engine.ready && humansTurn && !selfPlaying;

  const boardCandidates = showCandidates ? analysis.candidates : [];
  const hideCandidatesForMode = mode === 'selfplay';

  return (
    <main className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[1fr_360px] gap-3 lg:gap-6 p-3 lg:p-6">
      <section className="flex flex-col items-center gap-3 min-h-0 min-w-0 flex-1">
        <LocalTurnBadge
          winner={state.winner}
          toMove={state.toMove}
          aiThinking={aiThinking}
          selfPlaying={selfPlaying}
          moveCount={state.history.length}
          thinkingStartedAt={aiStartedAt ?? selfPlayStartedAt}
          budgetMs={budgetMs}
        />
        <div className="flex-1 min-h-0 w-full flex items-center justify-center">
          <div
            className="aspect-square"
            style={{ height: '100%', maxWidth: '100%', maxHeight: '100%' }}
          >
            <Board
              board={state.board}
              lastMove={state.history.length ? state.history[state.history.length - 1] : null}
              winLine={state.winLine}
              candidates={hideCandidatesForMode ? [] : boardCandidates}
              hoverColor={state.toMove}
              onPlay={play}
              disabled={!canPlay}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Controls
            onReset={handleReset}
            onUndo={handleUndo}
            canUndo={state.history.length > 0 && !selfPlaying && !aiThinking}
          />
          {mode === 'selfplay' && (
            <Button onClick={runSelfPlay} disabled={selfPlaying || !engine.ready} size="sm">
              {selfPlaying ? '对弈中…' : '开始自对弈'}
            </Button>
          )}
        </div>
      </section>
      <aside className="flex flex-col gap-2.5 min-h-0 min-w-0 overflow-y-auto max-h-[42dvh] lg:max-h-none shrink-0">
        <ModeSelect
          mode={mode}
          onModeChange={setMode}
          humanSide={humanSide}
          onHumanSideChange={setHumanSide}
        />
        <EnginePanel
          engine={engine}
          budgetMs={budgetMs}
          onBudgetChange={setBudgetMs}
          maxDepth={maxDepth}
          onMaxDepthChange={setMaxDepth}
        />
        <AnalysisPanel
          winner={state.winner}
          blackScore={blackScore}
          candidates={hideCandidatesForMode ? [] : analysis.candidates}
          thinking={analysis.loading || aiThinking || selfPlaying}
          tookMs={analysis.tookMs}
          startedAt={
            aiThinking ? aiStartedAt : selfPlaying ? selfPlayStartedAt : analysis.startedAt
          }
          budgetMs={aiThinking || selfPlaying ? budgetMs : analysis.budgetMs}
          showWinrate={showWinrate}
          onToggleWinrate={() => setShowWinrate((v) => !v)}
          showCandidates={showCandidates}
          onToggleCandidates={() => setShowCandidates((v) => !v)}
        />
      </aside>
    </main>
  );
}
