import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { Flag, Handshake, LogOut, RotateCcw, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';

interface OnlineActionsProps {
  canUndo: boolean;
  canDraw: boolean;
  canResign: boolean;
  canReset: boolean;
  /** Game over: the reset button reads "再来一局" and is emphasised. */
  finished: boolean;
  /** Leaving would abandon a game in progress, so ask twice. */
  confirmLeave: boolean;
  /** The room is gone: the only thing left to do is go back to the lobby. */
  closed: boolean;
  onUndo: () => void;
  onDraw: () => void;
  onResign: () => void;
  onReset: () => void;
  onLeave: () => void;
}

export function OnlineActions({
  canUndo,
  canDraw,
  canResign,
  canReset,
  finished,
  confirmLeave,
  closed,
  onUndo,
  onDraw,
  onResign,
  onReset,
  onLeave,
}: OnlineActionsProps) {
  const [armed, setArmed] = useState<'resign' | 'leave' | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  const icon = 'size-4 hidden sm:block';
  if (closed) {
    return (
      <div className="flex items-center justify-center shrink-0">
        <Button size="sm" className="px-5" onClick={onLeave}>
          <LogOut className={icon} />
          返回大厅
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 shrink-0">
      <Button variant="outline" size="sm" disabled={!canUndo} onClick={onUndo}>
        <Undo2 className={icon} />
        悔棋
      </Button>
      <Button variant="outline" size="sm" disabled={!canDraw} onClick={onDraw}>
        <Handshake className={icon} />
        求和
      </Button>
      <Button
        variant={armed === 'resign' ? 'destructive' : 'outline'}
        size="sm"
        disabled={!canResign}
        onClick={() => {
          if (armed === 'resign') {
            setArmed(null);
            onResign();
          } else setArmed('resign');
        }}
      >
        <Flag className={icon} />
        {armed === 'resign' ? '确认认输' : '认输'}
      </Button>
      <Button
        variant={finished && canReset ? 'default' : 'outline'}
        size="sm"
        disabled={!canReset}
        onClick={onReset}
      >
        <RotateCcw className={icon} />
        {finished ? '再来一局' : '重开'}
      </Button>
      <span className="w-px h-5 bg-border mx-0.5 sm:mx-1" aria-hidden="true" />
      <Button
        variant={armed === 'leave' ? 'destructive' : 'ghost'}
        size="sm"
        className={cn(armed !== 'leave' && 'text-muted-foreground')}
        onClick={() => {
          if (!confirmLeave || armed === 'leave') {
            setArmed(null);
            onLeave();
          } else setArmed('leave');
        }}
      >
        <LogOut className={icon} />
        {armed === 'leave' ? '确认离开' : '离开'}
      </Button>
    </div>
  );
}
