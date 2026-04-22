import type { ReactNode } from 'react';
import { scoreToWinRate } from '@/game/rules';
import type { ScoredMove, Stone } from '@/game/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { CAND_COLORS } from '@/components/Board';

interface AnalysisPanelProps {
  /// Score normalised to black's perspective — positive is good for black.
  blackScore: number | null;
  winner: Stone;
  candidates: ScoredMove[];
  thinking: boolean;
  tookMs: number | null;
  startedAt: number | null;
  budgetMs: number;
  showWinrate: boolean;
  onToggleWinrate: () => void;
  /// Controls BOTH the candidate list in the panel AND the candidate
  /// markers on the board (App wires this through).
  showCandidates: boolean;
  onToggleCandidates: () => void;
}

export function AnalysisPanel({
  blackScore,
  winner,
  candidates,
  thinking,
  tookMs,
  startedAt,
  budgetMs,
  showWinrate,
  onToggleWinrate,
  showCandidates,
  onToggleCandidates,
}: AnalysisPanelProps) {
  const hasScore = blackScore != null || winner !== 0;
  const fromBlack = winner === 1 ? 1e7 : winner === 2 ? -1e7 : (blackScore ?? 0);
  const blackRate = scoreToWinRate(fromBlack);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span>形势评估</span>
          {thinking ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-normal text-blue-600">
              <ProgressRing
                startedAt={startedAt}
                budgetMs={budgetMs}
                size={14}
                className="text-blue-500"
              />
              <span>计算中</span>
            </span>
          ) : (
            tookMs != null && (
              <span className="text-xs font-normal text-muted-foreground font-mono">
                {tookMs}ms
              </span>
            )
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Section title="胜率" expanded={showWinrate} onToggle={onToggleWinrate}>
          {hasScore ? (
            <AdvantageBar blackRate={blackRate} />
          ) : (
            <EmptyHint />
          )}
        </Section>

        <Section title="候选手" expanded={showCandidates} onToggle={onToggleCandidates}>
          {candidates.length > 0 ? (
            <ul className="space-y-1.5">
              {candidates.map((c, i) => (
                <li
                  key={`${c.x},${c.y}`}
                  className="flex items-center justify-between text-sm font-mono"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-flex items-center justify-center size-5 rounded-full text-[11px] font-bold text-white"
                      style={{ backgroundColor: CAND_COLORS[i] ?? '#64748b' }}
                    >
                      {i + 1}
                    </span>
                    <span className="text-foreground">{`(${c.x}, ${c.y})`}</span>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {c.score >= 0 ? `+${formatScore(c.score)}` : formatScore(c.score)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyHint />
          )}
        </Section>
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>{title}</span>
        <span className="text-[10px]">{expanded ? '收起 ▾' : '展开 ▸'}</span>
      </button>
      {expanded && <div className="mt-2">{children}</div>}
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="flex items-center justify-center h-8 text-xs text-muted-foreground/70 italic">
      尚未评估
    </div>
  );
}

function AdvantageBar({ blackRate }: { blackRate: number }) {
  const pct = Math.round(blackRate * 100);
  return (
    <div className="h-6 w-full overflow-hidden rounded-full border border-slate-400 bg-slate-200 shadow-inner">
      <div className="flex h-full w-full text-xs font-semibold">
        <div
          className="flex items-center justify-end pr-2 bg-slate-900 text-white transition-[width] duration-500 ease-out"
          style={{ width: `${blackRate * 100}%` }}
        >
          {blackRate > 0.12 && `${pct}%`}
        </div>
        <div
          className="flex items-center justify-start pl-2 bg-slate-50 text-slate-800 border-l border-slate-400 transition-[width] duration-500 ease-out"
          style={{ width: `${(1 - blackRate) * 100}%` }}
        >
          {1 - blackRate > 0.12 && `${100 - pct}%`}
        </div>
      </div>
    </div>
  );
}

function formatScore(s: number): string {
  const abs = Math.abs(s);
  if (abs >= 1_000_000) return `${(s / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(s / 1_000).toFixed(0)}k`;
  return `${s}`;
}
