import { ModeCard } from '@/components/ModeCard';
import { TimeField } from '@/components/online/TimeField';
import { Button } from '@/components/ui/Button';
import { ToggleGroup } from '@/components/ui/ToggleGroup';
import {
  MAIN_MINUTES_RANGE,
  MAIN_TIME_OPTIONS,
  PER_MOVE_OPTIONS,
  PER_MOVE_SECONDS_RANGE,
  describeTimeControl,
} from '@/game/online';
import type { TimeControl } from '@/game/peer-protocol';
import type { Stone } from '@/game/types';
import { loadCreatePrefs } from '@/lib/onlineStorage';
import { cn } from '@/lib/utils';
import { Check, ChevronLeft, Link2, Loader2, LogIn, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type LobbyView = 'choose' | 'join' | 'create';

/** First screen of 联机: pick 加入 or 创建, same cards as the home page. */
export function OnlineChoose({ onPick }: { onPick: (v: 'join' | 'create') => void }) {
  return (
    <main className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center p-6">
      <div className="w-full max-w-xl grid gap-3 sm:grid-cols-2">
        <ModeCard
          onClick={() => onPick('join')}
          icon={<LogIn className="size-5" strokeWidth={1.75} />}
          title="加入房间"
          subtitle="输入朋友给的 4 位房号"
        />
        <ModeCard
          onClick={() => onPick('create')}
          icon={<Plus className="size-5" strokeWidth={1.75} />}
          title="创建房间"
          subtitle="定好执子和时限，邀请朋友"
        />
      </div>
    </main>
  );
}

function FormCard({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <main className="flex-1 min-h-0 overflow-y-auto flex items-start sm:items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card p-5 sm:p-6 shadow-sm space-y-5">
        <div className="flex items-center gap-1 -ml-2 -mt-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            aria-label="返回"
            onClick={onBack}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        </div>
        {children}
      </div>
    </main>
  );
}

function Feedback({ error, info }: { error: string | null; info?: string | null }) {
  return (
    <p
      className={cn(
        'min-h-5 text-sm text-center',
        error ? 'text-red-600' : 'text-muted-foreground',
      )}
      aria-live="polite"
    >
      {error ?? info ?? ''}
    </p>
  );
}

interface JoinFormProps {
  code: string;
  onCode: (c: string) => void;
  /** Join in progress: the button spins until the game starts or fails. */
  busy: boolean;
  error: string | null;
  /** Neutral status while busy, e.g. the host is offline. */
  info: string | null;
  onJoin: (roomId: string) => void;
  onBack: () => void;
}

export function JoinForm({ code, onCode, busy, error, info, onJoin, onBack }: JoinFormProps) {
  const valid = /^\d{4}$/.test(code);
  const submit = () => {
    if (valid && !busy) onJoin(code);
  };
  return (
    <FormCard title="加入房间" onBack={onBack}>
      <PinInput value={code} onChange={onCode} onSubmit={submit} disabled={busy} focusKey={error} />
      <Feedback error={error} info={busy ? info : null} />
      <Button className="w-full h-10" disabled={!valid || busy} onClick={submit}>
        {busy && <Loader2 className="size-4 animate-spin" />}
        加入
      </Button>
    </FormCard>
  );
}

interface CreateFormProps {
  busy: boolean;
  error: string | null;
  onCreate: (side: Stone, tc: TimeControl) => void;
  onBack: () => void;
}

export function CreateForm({ busy, error, onCreate, onBack }: CreateFormProps) {
  const [prefs] = useState(loadCreatePrefs);
  const [side, setSide] = useState<Stone>(prefs?.side ?? 1);
  const [main, setMain] = useState<number | null>(prefs?.timeControl.main ?? 10 * 60_000);
  const [perMove, setPerMove] = useState<number | null>(prefs?.timeControl.perMove ?? null);
  return (
    <FormCard title="创建房间" onBack={onBack}>
      <div className="space-y-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">执子</span>
          <ToggleGroup<string>
            value={String(side)}
            onChange={(v) => setSide(Number(v) as Stone)}
            disabled={busy}
            options={[
              { value: '1', label: '黑 · 先手', icon: <Dot fill="#111827" stroke="#111827" /> },
              { value: '2', label: '白 · 后手', icon: <Dot fill="#f9fafb" stroke="#9ca3af" /> },
            ]}
          />
        </div>
        <TimeField
          label="局时"
          presets={MAIN_TIME_OPTIONS}
          value={main}
          onChange={setMain}
          unit="分"
          unitMs={60_000}
          range={MAIN_MINUTES_RANGE}
          step={1}
          fallback={15}
          disabled={busy}
        />
        <TimeField
          label="步时"
          presets={PER_MOVE_OPTIONS}
          value={perMove}
          onChange={setPerMove}
          unit="秒"
          unitMs={1000}
          range={PER_MOVE_SECONDS_RANGE}
          step={5}
          fallback={45}
          disabled={busy}
        />
      </div>
      <Feedback error={error} />
      <Button
        className="w-full h-10"
        disabled={busy}
        onClick={() => onCreate(side, { main, perMove })}
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        创建
      </Button>
    </FormCard>
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
  disabled,
  focusKey,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  /** Re-focus whenever this changes (e.g. a new error came back). */
  focusKey?: unknown;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: focusKey is a trigger
  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [focusKey, disabled]);

  return (
    <div className={cn('relative', disabled && 'opacity-60')}>
      {/* The native input holds the value (good IME/paste handling) and
          covers the boxes, fully transparent; the boxes are decorative. */}
      <input
        ref={inputRef}
        // biome-ignore lint/a11y/noAutofocus: the code box is this form's only input
        autoFocus
        value={value}
        disabled={disabled}
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
        className="flex items-center justify-between gap-2.5 pointer-events-none"
      >
        {[0, 1, 2, 3].map((i) => {
          const ch = value[i];
          const active = focused && (i === value.length || (i === 3 && value.length === 4));
          return (
            <div
              key={i}
              className={cn(
                'flex-1 aspect-square max-h-20 rounded-xl border-2',
                'flex items-center justify-center',
                'text-3xl font-semibold font-mono transition-colors select-none',
                ch !== undefined
                  ? 'border-foreground/40 bg-background'
                  : 'border-border bg-muted/40',
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

export function WaitingRoom({
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
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <main className="flex-1 min-h-0 overflow-y-auto flex items-start sm:items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card p-6 sm:p-7 shadow-sm space-y-6">
        <div className="text-center space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">等待对手加入</h2>
          <p className="text-sm text-muted-foreground">
            {peerDropped ? '对方连接中断，等待其重新进入' : '把房号或链接发给朋友'}
          </p>
        </div>
        <div className="rounded-xl bg-muted/60 py-6">
          <div
            className="text-5xl font-mono font-semibold tracking-[0.4em] pl-[0.4em] text-center select-all"
            aria-label={`房间号 ${roomId}`}
          >
            {roomId}
          </div>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          你执{hostSide === 1 ? '黑 · 先手' : '白 · 后手'} · {describeTimeControl(timeControl)}
        </p>
        <div className="space-y-2">
          <Button className="w-full" onClick={copy}>
            {copied ? <Check className="size-4" /> : <Link2 className="size-4" />}
            {copied ? '链接已复制' : '复制邀请链接'}
          </Button>
          <Button className="w-full" variant="outline" onClick={onCancel}>
            取消房间
          </Button>
        </div>
      </div>
    </main>
  );
}
