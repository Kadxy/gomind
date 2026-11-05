import { StoneDot } from '@/components/TurnBadge';
import { type ClockState, clockView, formatClock } from '@/game/online';
import type { GameResult } from '@/game/peer-protocol';
import type { Stone } from '@/game/types';
import { useNow } from '@/hooks/useNow';
import { cn } from '@/lib/utils';

export type Presence = 'online' | 'away' | 'gone';

interface PlayerBarProps {
  clock: ClockState;
  mySide: Stone;
  toMove: Stone;
  started: boolean;
  result: GameResult | null;
  /** Both players connected: the side to move is actually on the clock. */
  live: boolean;
  opponent: Presence;
}

/** Two player cards, black left and white right; the side to move is lit up. */
export function PlayerBar({
  clock,
  mySide,
  toMove,
  started,
  result,
  live,
  opponent,
}: PlayerBarProps) {
  const ticking = clock.active !== 0 && clock.pausedAt === null;
  const now = useNow(ticking, 200);
  const view = clockView(clock, now);
  const turnElapsed =
    clock.active !== 0 && clock.turnStartedAt !== null
      ? Math.max(0, (clock.pausedAt ?? now) - clock.turnStartedAt)
      : 0;

  return (
    <div className="w-full max-w-2xl grid grid-cols-2 gap-2 sm:gap-3">
      {([1, 2] as const).map((side) => {
        const isMe = side === mySide;
        const active = started && !result && toMove === side;
        return (
          <PlayerCard
            key={side}
            side={side}
            isMe={isMe}
            active={active}
            live={live}
            presence={isMe ? 'online' : opponent}
            result={result}
            tc={clock.tc}
            mainLeft={view.main[side]}
            moveLeft={active ? view.moveLeft : null}
            turnElapsed={active ? turnElapsed : 0}
          />
        );
      })}
    </div>
  );
}

function PlayerCard({
  side,
  isMe,
  active,
  live,
  presence,
  result,
  tc,
  mainLeft,
  moveLeft,
  turnElapsed,
}: {
  side: 1 | 2;
  isMe: boolean;
  active: boolean;
  live: boolean;
  presence: Presence;
  result: GameResult | null;
  tc: ClockState['tc'];
  mainLeft: number | null;
  moveLeft: number | null;
  turnElapsed: number;
}) {
  // Big number: main time if any, else the per-move budget, else (no limits
  // at all) how long the current turn has taken so far.
  let big: string | null = null;
  if (tc.main !== null && mainLeft !== null) big = formatClock(mainLeft);
  else if (tc.perMove !== null)
    big = formatClock(active && moveLeft !== null ? moveLeft : tc.perMove);
  else if (active) big = formatClock(turnElapsed);

  const small =
    tc.main !== null && tc.perMove !== null
      ? `步时 ${formatClock(active && moveLeft !== null ? moveLeft : tc.perMove)}`
      : null;

  const remaining = Math.min(
    tc.main !== null && mainLeft !== null ? mainLeft : Number.POSITIVE_INFINITY,
    active && moveLeft !== null ? moveLeft : Number.POSITIVE_INFINITY,
  );
  const low = active && live && remaining <= 10_000;
  const won = result !== null && result.winner === side;
  const drawn = result !== null && result.winner === 0 && result.kind !== 'abandon';

  let status: React.ReactNode;
  if (won) status = <span className="font-medium text-emerald-700">获胜</span>;
  else if (drawn) status = '和棋';
  else if (active && !live) status = '计时暂停';
  else if (active && isMe) status = <span className="font-medium text-foreground">轮到你落子</span>;
  else if (active) status = <Thinking />;
  else
    status = (
      <>
        {side === 1 ? '执黑' : '执白'}
        <span className="hidden sm:inline">{side === 1 ? ' · 先手' : ' · 后手'}</span>
      </>
    );

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border px-3 py-2 sm:px-3.5 sm:py-2.5',
        'flex items-center gap-2.5 sm:gap-3 transition-[background-color,border-color,box-shadow,opacity] duration-300',
        active ? 'bg-card border-foreground/25 shadow-md' : 'bg-card border-border/60 shadow-none',
        won && 'border-emerald-300 bg-emerald-50',
      )}
    >
      <StoneDot color={side} size={22} />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'flex items-center gap-1.5 text-sm font-semibold leading-tight',
            !active && !won && 'text-foreground/70',
          )}
        >
          <span>{isMe ? '你' : '对手'}</span>
          {!isMe && <PresenceDot presence={presence} />}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground truncate leading-tight">{status}</div>
      </div>
      {big !== null && (
        <div className="text-right shrink-0">
          <div
            className={cn(
              'font-mono tabular-nums text-lg sm:text-xl font-semibold leading-none',
              active ? 'text-foreground' : 'text-muted-foreground',
              low && 'text-red-600',
            )}
          >
            {big}
          </div>
          {small && (
            <div
              className={cn(
                'mt-1 font-mono tabular-nums text-[11px] leading-none text-muted-foreground',
                low && moveLeft !== null && moveLeft <= 10_000 && 'text-red-600',
              )}
            >
              {small}
            </div>
          )}
        </div>
      )}
      {active && live && tc.perMove !== null && moveLeft !== null && (
        <div className="absolute inset-x-3 bottom-1 h-0.5 rounded-full bg-border/70 overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-200 ease-linear',
              low ? 'bg-red-500' : 'bg-foreground/35',
            )}
            style={{ width: `${Math.max(0, Math.min(1, moveLeft / tc.perMove)) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

function PresenceDot({ presence }: { presence: Presence }) {
  const label = presence === 'online' ? '在线' : presence === 'away' ? '连接中断' : '已离开';
  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        'inline-block size-1.5 rounded-full',
        presence === 'online' && 'bg-emerald-500',
        presence === 'away' && 'bg-amber-500 animate-pulse',
        presence === 'gone' && 'bg-muted-foreground/50',
      )}
    />
  );
}

function Thinking() {
  return (
    <span className="inline-flex items-center gap-1">
      思考中
      <span className="inline-flex gap-0.5" aria-hidden="true">
        {[0, 150, 300].map((d) => (
          <span
            key={d}
            className="size-1 rounded-full bg-current animate-pulse"
            style={{ animationDelay: `${d}ms` }}
          />
        ))}
      </span>
    </span>
  );
}
