import { Button } from '@/components/ui/Button';
import { ToggleGroup } from '@/components/ui/ToggleGroup';
import { MAIN_TIME_OPTIONS, PER_MOVE_OPTIONS, describeTimeControl } from '@/game/online';
import { formatClock } from '@/game/online';
import type { TimeControl } from '@/game/peer-protocol';
import type { Stone } from '@/game/types';
import { useNow } from '@/hooks/useNow';
import type { RoomStatus } from '@/hooks/useRemoteRoom';
import { loadCreatePrefs } from '@/lib/onlineStorage';
import { cn } from '@/lib/utils';
import { AlertCircle, Check, Copy, Link2, Loader2, LogIn, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface OnlineGateProps {
  status: RoomStatus;
  error: string | null;
  roomId: string | null;
  isHost: boolean;
  /** Host's own settings, shown while waiting for the guest. */
  hostSide: Stone;
  timeControl: TimeControl;
  awayUntil: number | null;
  endedText: string;
  onCreate: (side: Stone, tc: TimeControl) => void;
  onJoin: (roomId: string) => void;
  /** Leave the room (if any) and go back to the create/join screen. */
  onBack: () => void;
  onRetry: () => void;
}

/** Everything before the first move: lobby, waiting room, connection states. */
export function OnlineGate(props: OnlineGateProps) {
  const { status, error, roomId, isHost, awayUntil, onBack, onRetry } = props;

  let body: React.ReactNode;
  if (status === 'idle') {
    return <Lobby onCreate={props.onCreate} onJoin={props.onJoin} />;
  }
  if (status === 'error') {
    body = (
      <StatusCard
        icon="error"
        title="无法进入房间"
        message={error ?? '未知错误'}
        primary={{ label: '重试', onClick: onRetry }}
        secondary={{ label: '返回', onClick: onBack }}
      />
    );
  } else if (status === 'ended') {
    body = (
      <StatusCard
        icon="warn"
        title="房间已关闭"
        message={props.endedText}
        primary={{ label: '返回', onClick: onBack }}
      />
    );
  } else if (roomId && isHost && (status === 'waiting_peer' || status === 'peer_away')) {
    body = (
      <WaitingCard
        roomId={roomId}
        hostSide={props.hostSide}
        timeControl={props.timeControl}
        peerDropped={status === 'peer_away'}
        onCancel={onBack}
      />
    );
  } else if (status === 'peer_away') {
    body = (
      <StatusCard
        icon="spin"
        title="等待房主连接"
        message="房主暂时离线，回来后会自动开局"
        countdownTo={awayUntil}
        secondary={{ label: '离开', onClick: onBack }}
      />
    );
  } else {
    const title =
      status === 'ready' ? '正在开局' : status === 'reconnecting' ? '正在重连' : '正在连接';
    body = <StatusCard icon="spin" title={title} secondary={{ label: '取消', onClick: onBack }} />;
  }

  return (
    <main className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md">{body}</div>
    </main>
  );
}

// ------------------------------------------------------------------ lobby

function Lobby({
  onCreate,
  onJoin,
}: {
  onCreate: (side: Stone, tc: TimeControl) => void;
  onJoin: (roomId: string) => void;
}) {
  return (
    <main className="flex-1 min-h-0 overflow-y-auto flex items-start sm:items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-3xl grid gap-3 sm:gap-4 sm:grid-cols-2 items-stretch">
        <JoinCard onJoin={onJoin} />
        <CreateCard onCreate={onCreate} />
      </div>
    </main>
  );
}

function JoinCard({ onJoin }: { onJoin: (id: string) => void }) {
  const [value, setValue] = useState('');
  const valid = /^\d{4}$/.test(value);
  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm flex flex-col gap-5">
      <CardTitle
        icon={<LogIn className="size-4" />}
        title="加入房间"
        subtitle="输入朋友发来的 4 位房号"
      />
      <div className="flex-1 flex flex-col justify-center">
        <PinInput value={value} onChange={setValue} onSubmit={() => valid && onJoin(value)} />
      </div>
      <Button className="w-full h-10" disabled={!valid} onClick={() => onJoin(value)}>
        加入
      </Button>
    </section>
  );
}

const tcKey = (v: number | null) => (v === null ? 'none' : String(v));
const tcVal = (k: string) => (k === 'none' ? null : Number(k));

function CreateCard({ onCreate }: { onCreate: (side: Stone, tc: TimeControl) => void }) {
  const [prefs] = useState(loadCreatePrefs);
  const [side, setSide] = useState<Stone>(prefs?.side ?? 1);
  const [main, setMain] = useState<number | null>(prefs?.timeControl.main ?? 10 * 60_000);
  const [perMove, setPerMove] = useState<number | null>(prefs?.timeControl.perMove ?? null);
  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm flex flex-col gap-4">
      <CardTitle
        icon={<Plus className="size-4" />}
        title="创建房间"
        subtitle="定好规则，把房号发给朋友"
      />
      <Field label="你执">
        <ToggleGroup<string>
          value={String(side)}
          onChange={(v) => setSide(Number(v) as Stone)}
          options={[
            { value: '1', label: '黑 · 先手', icon: <Dot fill="#111827" stroke="#111827" /> },
            { value: '2', label: '白 · 后手', icon: <Dot fill="#f9fafb" stroke="#9ca3af" /> },
          ]}
        />
      </Field>
      <Field label="局时" hint="每方总用时，用完判负">
        <ToggleGroup<string>
          value={tcKey(main)}
          onChange={(v) => setMain(tcVal(v))}
          options={MAIN_TIME_OPTIONS.map((o) => ({ value: tcKey(o.value), label: o.label }))}
        />
      </Field>
      <Field label="步时" hint="每一步最长用时，超时判负">
        <ToggleGroup<string>
          value={tcKey(perMove)}
          onChange={(v) => setPerMove(tcVal(v))}
          options={PER_MOVE_OPTIONS.map((o) => ({ value: tcKey(o.value), label: o.label }))}
        />
      </Field>
      <Button className="w-full h-10 mt-auto" onClick={() => onCreate(side, { main, perMove })}>
        创建房间
      </Button>
    </section>
  );
}

function CardTitle({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="inline-flex items-center justify-center size-9 rounded-xl bg-muted/60 border border-border/70 text-foreground/80 shrink-0">
        {icon}
      </div>
      <div>
        <h2 className="text-base font-semibold tracking-tight leading-tight">{title}</h2>
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {hint && <span className="text-[11px] text-muted-foreground/70">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Dot({ fill, stroke }: { fill: string; stroke: string }) {
  return (
    <span
      className="inline-block size-3 rounded-full border"
      style={{ background: fill, borderColor: stroke }}
    />
  );
}

function PinInput({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  // Focus on open so a pasted/typed code goes straight in. Done in an effect
  // as well as autoFocus because the lobby can mount behind a route change.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="relative">
      {/* The native input holds the value (good IME/paste handling) and
          covers the boxes, fully transparent; the boxes are decorative. */}
      <input
        ref={inputRef}
        // biome-ignore lint/a11y/noAutofocus: the code box is the page's primary input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit();
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode="numeric"
        pattern="\d{4}"
        maxLength={4}
        type="text"
        autoComplete="one-time-code"
        name="gomind-room-pin"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="房间号"
        className="absolute inset-0 w-full h-full opacity-0 cursor-text"
      />
      <div
        aria-hidden="true"
        className="flex items-center justify-between gap-2 pointer-events-none"
      >
        {[0, 1, 2, 3].map((i) => {
          const ch = value[i];
          const filled = ch !== undefined;
          const active = focused && (i === value.length || (i === 3 && value.length === 4));
          return (
            <div
              key={i}
              className={cn(
                'flex-1 aspect-square max-h-20 rounded-xl border-2',
                'flex items-center justify-center',
                'text-3xl font-semibold font-mono transition-colors select-none',
                filled ? 'border-foreground/40 bg-background' : 'border-border bg-muted/40',
                active && 'border-foreground/80 bg-background',
              )}
            >
              {ch ?? (active ? <span className="w-0.5 h-7 bg-foreground/70 animate-pulse" /> : '')}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- waiting room

function WaitingCard({
  roomId,
  hostSide,
  timeControl,
  peerDropped,
  onCancel,
}: {
  roomId: string;
  hostSide: Stone;
  timeControl: TimeControl;
  peerDropped: boolean;
  onCancel: () => void;
}) {
  const shareUrl =
    typeof window === 'undefined' ? '' : `${window.location.origin}/online?room=${roomId}`;
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const copy = (what: 'code' | 'link') => {
    navigator.clipboard.writeText(what === 'code' ? roomId : shareUrl).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-6 sm:p-7 shadow-sm space-y-6">
      <div className="text-center space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">等待对手加入</h2>
        <p className="text-sm text-muted-foreground">
          {peerDropped ? '对方连接中断，等待其重新进入…' : '把房号或链接发给朋友'}
        </p>
      </div>
      <button
        type="button"
        onClick={() => copy('code')}
        className="group w-full rounded-xl bg-muted/60 py-5 hover:bg-muted transition-colors"
        title="复制房号"
      >
        <div
          className="text-5xl font-mono font-semibold tracking-[0.4em] pl-[0.4em] text-center"
          aria-label={`房间号 ${roomId}`}
        >
          {roomId}
        </div>
        <div className="mt-2 text-xs text-muted-foreground inline-flex items-center gap-1">
          {copied === 'code' ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied === 'code' ? '已复制' : '点击复制房号'}
        </div>
      </button>
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        你执{hostSide === 1 ? '黑 · 先手' : '白 · 后手'} · {describeTimeControl(timeControl)}
      </div>
      <div className="space-y-2">
        <Button className="w-full" onClick={() => copy('link')}>
          {copied === 'link' ? <Check className="size-4" /> : <Link2 className="size-4" />}
          {copied === 'link' ? '链接已复制' : '复制邀请链接'}
        </Button>
        <Button className="w-full" variant="outline" onClick={onCancel}>
          取消房间
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- status card

function StatusCard({
  icon,
  title,
  message,
  countdownTo,
  primary,
  secondary,
}: {
  icon: 'spin' | 'warn' | 'error';
  title: string;
  message?: string;
  countdownTo?: number | null;
  primary?: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-7 shadow-sm space-y-4 text-center">
      <div className="flex justify-center">
        {icon === 'spin' && <Loader2 className="size-8 animate-spin text-muted-foreground" />}
        {icon === 'warn' && <AlertCircle className="size-8 text-amber-500" />}
        {icon === 'error' && <AlertCircle className="size-8 text-red-500" />}
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
        {countdownTo ? <Countdown to={countdownTo} /> : null}
      </div>
      {(primary || secondary) && (
        <div className="flex flex-col gap-2 pt-1">
          {primary && (
            <Button className="w-full" onClick={primary.onClick}>
              {primary.label}
            </Button>
          )}
          {secondary && (
            <Button className="w-full" variant="outline" onClick={secondary.onClick}>
              {secondary.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Countdown({ to }: { to: number }) {
  const now = useNow(true, 500);
  return (
    <p className="text-xs text-muted-foreground font-mono tabular-nums">{formatClock(to - now)}</p>
  );
}
