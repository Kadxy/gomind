import { Button } from '@/components/ui/Button';
import { formatClock } from '@/game/online';
import { useNow } from '@/hooks/useNow';
import { cn } from '@/lib/utils';

export interface NoticeAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

export interface NoticeSpec {
  tone: 'info' | 'warn' | 'success' | 'muted';
  text: string;
  /** Appends a live "m:ss" countdown to this wall-clock time. */
  countdownTo?: number | null;
  actions?: NoticeAction[];
}

const TONES: Record<NoticeSpec['tone'], string> = {
  info: 'bg-sky-50 ring-sky-200 text-sky-950',
  warn: 'bg-amber-50 ring-amber-200 text-amber-950',
  success: 'bg-emerald-50 ring-emerald-200 text-emerald-950',
  muted: 'bg-muted/80 ring-border text-foreground/80',
};

/**
 * Fixed-height slot between the player bar and the board. Shows the most
 * important notice, or the quiet `fallback` line when there's nothing to
 * say, so the board never jumps as notices come and go.
 */
export function OnlineNotice({
  notice,
  fallback,
}: {
  notice: NoticeSpec | null;
  fallback: React.ReactNode;
}) {
  return (
    <div className="h-10 w-full max-w-2xl flex items-center justify-center shrink-0">
      {notice ? (
        <output
          aria-live="polite"
          className={cn(
            'max-w-full inline-flex items-center gap-2 sm:gap-3 rounded-full ring-1 pl-4 pr-1 h-10 text-sm',
            !notice.actions?.length && 'pr-4',
            TONES[notice.tone],
          )}
        >
          <span className="truncate">
            {notice.text}
            {notice.countdownTo ? <Countdown to={notice.countdownTo} /> : null}
          </span>
          {notice.actions?.length ? (
            <span className="flex items-center gap-1 shrink-0">
              {notice.actions.map((a) => (
                <Button
                  key={a.label}
                  size="sm"
                  variant={a.primary ? 'default' : 'ghost'}
                  className="h-8 rounded-full px-3"
                  onClick={a.onClick}
                >
                  {a.label}
                </Button>
              ))}
            </span>
          ) : null}
        </output>
      ) : (
        <div className="text-xs text-muted-foreground truncate">{fallback}</div>
      )}
    </div>
  );
}

function Countdown({ to }: { to: number }) {
  const now = useNow(true, 500);
  return <span className="ml-1.5 font-mono tabular-nums">{formatClock(to - now)}</span>;
}
