import { ProgressRing } from '@/components/ui/ProgressRing';
import type { Stone } from '@/game/types';
import type { RoomStatus } from '@/hooks/useRemoteRoom';

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
  winner: Stone;
  toMove: Stone;
  aiThinking: boolean;
  selfPlaying: boolean;
  moveCount: number;
  thinkingStartedAt: number | null;
  budgetMs: number;
}

export function LocalTurnBadge({
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

interface RemoteTurnBadgeProps {
  winner: Stone;
  toMove: Stone;
  moveCount: number;
  mySide: Stone | null;
  status: RoomStatus;
}

export function RemoteTurnBadge({
  winner,
  toMove,
  moveCount,
  mySide,
  status,
}: RemoteTurnBadgeProps) {
  if (winner !== 0) {
    const suffix = mySide !== null ? (winner === mySide ? ' · 你赢了 🎉' : ' · 你输了') : '';
    return <WinnerBadge winner={winner} moveCount={moveCount} suffix={suffix} />;
  }
  // OnlineApp only mounts this badge when the game is actually underway
  // (status === 'ready' && mySide !== null), so we don't need fallbacks
  // for idle / connecting / waiting_peer / ended / error here — the
  // setup gate owns those states.
  if (status !== 'ready' || mySide === null) {
    return <MutedBadge>准备中…</MutedBadge>;
  }
  const yourTurn = toMove === mySide;
  const label = yourTurn ? '轮到你落子' : '对手思考中';
  return (
    <ActiveBadge
      busy={!yourTurn}
      busyStartedAt={null}
      budgetMs={0}
      toMove={toMove}
      label={label}
      moveCount={moveCount}
    />
  );
}

function WinnerBadge({
  winner,
  moveCount,
  suffix = '',
}: {
  winner: Stone;
  moveCount: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-full bg-emerald-50 ring-1 ring-emerald-200/80 px-4 py-1.5 text-sm font-semibold text-emerald-900">
      <StoneDot color={winner} size={16} />
      <span>
        {winner === 1 ? '黑' : '白'}方胜 · 共 {moveCount} 手{suffix}
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

function MutedBadge({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-full bg-muted/80 ring-1 ring-border/70 px-4 py-1.5 text-sm text-muted-foreground">
      <span>{children}</span>
    </div>
  );
}
