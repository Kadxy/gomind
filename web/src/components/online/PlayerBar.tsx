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

/** Two player cards, black left and white right; the side to move gets a darker outline. */
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
  const now = useNow(ticking, 250);
  const view = clockView(clock, now);

  return (
    <div className="w-full max-w-2xl grid grid-cols-2 gap-2 sm:gap-3 shrink-0">
      {([1, 2] as const).map((side) => {
        const active = started && !result && toMove === side;
        return (
          <PlayerCard
            key={side}
            side={side}
            isMe={side === mySide}
            active={active}
            live={live}
            presence={side === mySide ? 'online' : opponent}
            result={result}
            tc={clock.tc}
            mainLeft={view.main[side]}
            moveLeft={active ? view.moveLeft : null}
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
}) {
  // Big number: main time if any, else the per-move budget. Nothing at all
  // for untimed games.
  let big: string | null = null;
  if (tc.main !== null && mainLeft !== null) big = formatClock(mainLeft);
  else if (tc.perMove !== null)
    big = formatClock(active && moveLeft !== null ? moveLeft : tc.perMove);
  let small =
    tc.main !== null && tc.perMove !== null
      ? `步时 ${formatClock(active && moveLeft !== null ? moveLeft : tc.perMove)}`
      : null;
  // The side that flagged: show the clock that actually ran out at zero.
  const flagged = result?.kind === 'timeout' && result.winner !== side;
  if (flagged && big !== null) {
    const mainOut = tc.main !== null && mainLeft !== null && mainLeft <= 0;
    if (mainOut || tc.main === null) big = formatClock(0);
    else if (small) small = `步时 ${formatClock(0)}`;
  }
  const remaining = Math.min(
    tc.main !== null && mainLeft !== null ? mainLeft : Number.POSITIVE_INFINITY,
    active && moveLeft !== null ? moveLeft : Number.POSITIVE_INFINITY,
  );
  const low = active && live && remaining <= 10_000;

  let status: string;
  let emphasis: 'strong' | 'warn' | 'muted' = 'muted';
  if (result && result.kind !== 'abandon') {
    status = result.winner === 0 ? '和' : result.winner === side ? '胜' : '负';
    if (result.winner === side) emphasis = 'strong';
  } else if (presence === 'away') {
    status = '连接中断';
    emphasis = 'warn';
  } else if (presence === 'gone') {
    status = '已离开';
  } else if (active && !live) {
    status = '计时暂停';
  } else if (active) {
    status = isMe ? '轮到你' : '思考中';
    if (isMe) emphasis = 'strong';
  } else {
    status = side === 1 ? '执黑' : '执白';
  }

  return (
    <div
      className={cn(
        'rounded-xl border bg-card px-3 py-2 sm:px-3.5 sm:py-2.5',
        'flex items-center gap-2.5 sm:gap-3 transition-colors duration-200',
        active ? 'border-foreground/55' : 'border-border',
      )}
    >
      <StoneDot color={side} size={20} />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'text-sm leading-tight',
            active ? 'font-semibold' : 'font-medium text-foreground/70',
          )}
        >
          {isMe ? '你' : '对手'}
        </div>
        <div
          className={cn(
            'mt-0.5 text-xs leading-tight truncate',
            emphasis === 'strong' && 'text-foreground font-medium',
            emphasis === 'warn' && 'text-amber-700',
            emphasis === 'muted' && 'text-muted-foreground',
          )}
        >
          {status}
        </div>
      </div>
      {big !== null && (
        <div className="text-right shrink-0">
          <div
            className={cn(
              'font-mono tabular-nums text-lg sm:text-xl leading-none',
              active ? 'font-semibold text-foreground' : 'text-muted-foreground',
              (low || (flagged && big === '0:00')) && 'text-red-600',
            )}
          >
            {big}
          </div>
          {small && (
            <div
              className={cn(
                'mt-1 font-mono tabular-nums text-[11px] leading-none text-muted-foreground',
                flagged && small.endsWith(' 0:00') && 'text-red-600',
              )}
            >
              {small}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
