import { Button } from '@/components/ui/Button';
import { formatClock } from '@/game/online';
import { useNow } from '@/hooks/useNow';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';

export interface DockAction {
  key: string;
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  variant?: 'default' | 'outline' | 'ghost';
  disabled?: boolean;
  /** Needs a second click. The first one turns the button into this label. */
  confirm?: { label: string; destructive?: boolean };
}

export type DockSpec =
  | { kind: 'actions'; actions: DockAction[]; trailing?: DockAction[] }
  | {
      kind: 'message';
      /** Bold lead, e.g. "你赢了". */
      strong?: string;
      text?: string;
      tone?: 'default' | 'warn' | 'muted';
      /** Appends a live m:ss countdown to this wall-clock time. */
      countdownTo?: number | null;
      actions?: DockAction[];
    };

/**
 * The strip under the board. Normally the action buttons; while something
 * needs an answer (a request, a disconnect, the result) it turns into that
 * prompt instead, so the board stays fully visible.
 *
 * `resetKey`: any change disarms a pending confirmation (e.g. a move came in).
 */
export function OnlineDock({ spec, resetKey }: { spec: DockSpec; resetKey: string }) {
  const [armed, setArmed] = useState<string | null>(null);
  const armedEl = useRef<HTMLButtonElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey is a trigger
  useEffect(() => setArmed(null), [resetKey]);

  // Any click / tap / key / focus change outside the armed button cancels it.
  useEffect(() => {
    if (!armed) return;
    const outside = (e: Event) => {
      if (!armedEl.current?.contains(e.target as Node)) setArmed(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Tab') setArmed(null);
    };
    const cancel = () => setArmed(null);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', cancel);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', cancel);
    };
  }, [armed]);

  const render = (a: DockAction, size: 'sm' | 'default' = 'sm') => {
    const isArmed = armed === a.key;
    return (
      <Button
        key={a.key}
        ref={isArmed ? armedEl : undefined}
        size={size === 'sm' ? 'sm' : 'default'}
        variant={
          isArmed ? (a.confirm?.destructive ? 'destructive' : 'default') : (a.variant ?? 'outline')
        }
        disabled={a.disabled}
        className={cn(!isArmed && a.variant === 'ghost' && 'text-muted-foreground')}
        onClick={() => {
          if (!a.confirm || isArmed) {
            setArmed(null);
            a.onClick();
          } else {
            setArmed(a.key);
          }
        }}
      >
        {a.icon}
        {isArmed && a.confirm ? a.confirm.label : a.label}
      </Button>
    );
  };

  return (
    <div className="w-full max-w-2xl min-h-11 flex items-center justify-center shrink-0">
      {spec.kind === 'actions' ? (
        <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
          {spec.actions.map((a) => render(a))}
          {spec.trailing?.length ? (
            <>
              <span className="w-px h-5 bg-border mx-0.5 sm:mx-1" aria-hidden="true" />
              {spec.trailing.map((a) => render(a))}
            </>
          ) : null}
        </div>
      ) : (
        <output
          aria-live="polite"
          className="max-w-full flex flex-wrap items-center justify-center gap-x-4 gap-y-2"
        >
          <span
            className={cn(
              'text-sm',
              spec.tone === 'warn' && 'text-amber-700',
              spec.tone === 'muted' && 'text-muted-foreground',
            )}
          >
            {spec.strong && <span className="font-semibold text-foreground">{spec.strong}</span>}
            {spec.strong && spec.text && <span className="text-muted-foreground"> · </span>}
            {spec.text}
            {spec.countdownTo ? <Countdown to={spec.countdownTo} /> : null}
          </span>
          {spec.actions?.length ? (
            <span className="flex items-center gap-1.5 sm:gap-2">
              {spec.actions.map((a) => render(a))}
            </span>
          ) : null}
        </output>
      )}
    </div>
  );
}

function Countdown({ to }: { to: number }) {
  const now = useNow(true, 500);
  return <span className="ml-1.5 font-mono tabular-nums">{formatClock(to - now)}</span>;
}
