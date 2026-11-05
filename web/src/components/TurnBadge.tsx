import { ProgressRing } from '@/components/ui/ProgressRing';
import type { Stone } from '@/game/types';

export function StoneDot({
  color,
  size,
  pulse,
}: {
  color: Stone;
  size: number;
  pulse?: boolean;
}) {
  const fill = color === 1 ? '#111827' : '#f9fafb';
  const stroke = color === 1 ? '#000' : '#9ca3af';
  return (
    <span
      className={`inline-block rounded-full border ${pulse ? 'animate-pulse' : ''}`}
      style={{ width: size, height: size, background: fill, borderColor: stroke }}
    />
  );
}

interface LocalTurnBadgeProps {
  /** Shown instead of the turn while the engine this mode needs isn't ready. */
  engineNotice?: string | null;
  winner: Stone;
  toMove: Stone;
  aiThinking: boolean;
  selfPlaying: boolean;
  moveCount: number;
  thinkingStartedAt: number | null;
  budgetMs: number;
}

export function LocalTurnBadge({
  engineNotice,
  winner,
  toMove,
  aiThinking,
  selfPlaying,
  moveCount,
  thinkingStartedAt,
  budgetMs,
}: LocalTurnBadgeProps) {
  if (winner !== 0) {
    return <WinnerBadge winner={winner} moveCount={moveCount} />;
  }
  if (engineNotice) {
    return (
      <div className="flex items-center rounded-full bg-card ring-1 ring-border/70 px-4 py-1.5 text-sm text-muted-foreground shadow-sm">
        <span className="tabular-nums">{engineNotice}</span>
      </div>
    );
  }
  const busy = aiThinking || selfPlaying;
  const label = selfPlaying
    ? '自对弈进行中'
    : aiThinking
      ? 'AI 思考中'
      : `${toMove === 1 ? '黑' : '白'}方落子`;
  return (
    <ActiveBadge
      busy={busy}
      busyStartedAt={thinkingStartedAt}
      budgetMs={budgetMs}
      toMove={toMove}
      label={label}
      moveCount={moveCount}
    />
  );
}

function WinnerBadge({
  winner,
  moveCount,
}: {
  winner: Stone;
  moveCount: number;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-full bg-emerald-50 ring-1 ring-emerald-200/80 px-4 py-1.5 text-sm font-semibold text-emerald-900">
      <StoneDot color={winner} size={16} />
      <span>
        {winner === 1 ? '黑' : '白'}方胜 · 共 {moveCount} 手
      </span>
    </div>
  );
}

function ActiveBadge({
  busy,
  busyStartedAt,
  budgetMs,
  toMove,
  label,
  moveCount,
}: {
  busy: boolean;
  busyStartedAt: number | null;
  budgetMs: number;
  toMove: Stone;
  label: string;
  moveCount: number;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-full bg-card ring-1 ring-border/70 px-4 py-1.5 text-sm font-semibold shadow-sm">
      {busy && busyStartedAt != null && budgetMs > 0 ? (
        <ProgressRing
          startedAt={busyStartedAt}
          budgetMs={budgetMs}
          size={16}
          className="text-blue-500"
        />
      ) : (
        <StoneDot color={toMove} size={16} pulse={busy} />
      )}
      <span>{label}</span>
      <span className="text-xs font-normal text-muted-foreground">已走 {moveCount} 手</span>
    </div>
  );
}
