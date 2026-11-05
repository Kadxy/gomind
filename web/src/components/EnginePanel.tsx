import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Slider } from '@/components/ui/Slider';
import type { Engine } from '@/hooks/useEngine';
import { cn } from '@/lib/utils';

interface EnginePanelProps {
  engine: Engine;
  budgetMs: number;
  onBudgetChange: (ms: number) => void;
  maxDepth: number;
  onMaxDepthChange: (d: number) => void;
}

// 1..20 seconds followed by the "unlimited" sentinel (0). The sentinel tells
// the engine to skip its deadline check and run until max_depth is reached
// (or a mate is found).
const TIME_STOPS: number[] = (() => {
  const out: number[] = [];
  for (let i = 1; i <= 20; i++) out.push(i * 1000);
  out.push(0);
  return out;
})();
const UNLIMITED_INDEX = TIME_STOPS.length - 1;

function indexForBudget(ms: number): number {
  if (ms === 0) return UNLIMITED_INDEX;
  let best = 0;
  let diff = Number.POSITIVE_INFINITY;
  for (let i = 0; i < UNLIMITED_INDEX; i++) {
    const d = Math.abs(TIME_STOPS[i] - ms);
    if (d < diff) {
      diff = d;
      best = i;
    }
  }
  return best;
}

function formatBudget(ms: number): string {
  if (ms === 0) return '不限时';
  return `${(ms / 1000).toFixed(0)}s`;
}

export function EnginePanel({
  engine,
  budgetMs,
  onBudgetChange,
  maxDepth,
  onMaxDepthChange,
}: EnginePanelProps) {
  const timeIdx = indexForBudget(budgetMs);
  const pct = enginePercent(engine);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span>引擎预算</span>
          <span
            className={cn(
              'text-[11px] font-normal',
              engine.ready ? 'text-emerald-600' : 'text-muted-foreground',
            )}
          >
            {engine.ready
              ? engine.threads > 1
                ? `● 就绪 · ${engine.threads} 线程`
                : '● 就绪 · 单线程'
              : engine.failed
                ? '○ 加载失败，请刷新页面'
                : `○ 加载中${pct !== null ? ` ${pct}%` : ''}`}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!engine.ready && !engine.failed && (
          <div className="h-1 rounded-full bg-muted overflow-hidden" aria-hidden="true">
            <div
              className="h-full rounded-full bg-foreground/40 transition-[width] duration-200"
              style={{ width: `${pct ?? 0}%` }}
            />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">搜索深度</span>
            <span className="font-mono font-semibold">D {maxDepth}</span>
          </div>
          <Slider
            value={[maxDepth]}
            min={6}
            max={24}
            step={1}
            onValueChange={(v) => onMaxDepthChange(v[0])}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">时间预算</span>
            <span className="font-mono font-semibold">{formatBudget(budgetMs)}</span>
          </div>
          <Slider
            value={[timeIdx]}
            min={0}
            max={UNLIMITED_INDEX}
            step={1}
            onValueChange={(v) => onBudgetChange(TIME_STOPS[v[0]])}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/** Download progress of the engine's data package, 0-100, or null if unknown. */
export function enginePercent(engine: Engine): number | null {
  const l = engine.loading;
  if (!l || l.total <= 0) return null;
  return Math.min(100, Math.floor((l.loaded / l.total) * 100));
}
