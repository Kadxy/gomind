import { Check, Copy, LogOut } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import type { Stone } from '@/game/types';

interface RemotePanelProps {
  roomId: string | null;
  mySide: Stone | null;
  onLeave: () => void;
}

export function RemotePanel({ roomId, mySide, onLeave }: RemotePanelProps) {
  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined' || !roomId) return '';
    const base = `${window.location.origin}${window.location.pathname.replace(/\/?$/, '')}`;
    return `${base}?room=${roomId}`;
  }, [roomId]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>房间</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">房号</span>
          {roomId ? (
            <CopyInline value={roomId} mono large />
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>
        {shareUrl && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground shrink-0">分享</span>
            <CopyInline value={shareUrl} truncate />
          </div>
        )}
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">你执</span>
          <span className="inline-flex items-center gap-1.5 font-medium">
            {mySide === null ? (
              <span className="text-muted-foreground">等待分配</span>
            ) : (
              <>
                <Dot
                  color={mySide === 1 ? '#111827' : '#f9fafb'}
                  border={mySide === 1 ? '#111827' : '#9ca3af'}
                />
                {mySide === 1 ? '黑 · 先手' : '白 · 后手'}
              </>
            )}
          </span>
        </div>
        <Button onClick={onLeave} size="sm" variant="outline" className="w-full">
          <LogOut className="size-3.5" />
          离开房间
        </Button>
      </CardContent>
    </Card>
  );
}

function CopyInline({
  value,
  mono,
  large,
  truncate,
}: {
  value: string;
  mono?: boolean;
  large?: boolean;
  truncate?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-accent transition-colors min-w-0"
      title={value}
    >
      <span
        className={`${mono ? 'font-mono tracking-widest' : ''} ${large ? 'text-base font-semibold' : 'text-xs'} ${truncate ? 'truncate' : ''}`}
      >
        {value}
      </span>
      {copied ? (
        <Check className="size-3.5 text-emerald-600 shrink-0" />
      ) : (
        <Copy className="size-3.5 shrink-0" />
      )}
    </button>
  );
}

function Dot({ color, border = color }: { color: string; border?: string }) {
  return (
    <span
      className="inline-block size-3 rounded-full border"
      style={{ background: color, borderColor: border }}
    />
  );
}
