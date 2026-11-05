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
import { Loader2, LogIn, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type LobbyView = 'choose' | 'join' | 'create';

/**
 * Full-height page with its content centred vertically. No card around the
 * content: the controls inside are already boxed, and nesting looks heavy,
 * especially on phones.
 */
function Screen({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 min-h-0 overflow-y-auto flex flex-col px-5 py-8 sm:p-6">
      <div className="my-auto mx-auto w-full max-w-sm space-y-7">{children}</div>
    </main>
  );
}

function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="text-center space-y-1.5">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function BackButton({ onClick, label = '返回' }: { onClick: () => void; label?: string }) {
  return (
    <Button variant="ghost" className="w-full h-10 text-muted-foreground" onClick={onClick}>
      {label}
    </Button>
  );
}

/** First screen of 联机: pick 加入 or 创建. */
export function OnlineChoose({
  onPick,
  onBack,
}: {
  onPick: (v: 'join' | 'create') => void;
  onBack: () => void;
}) {
  return (
    <Screen>
      <div className="grid gap-3">
        <ModeCard
          onClick={() => onPick('join')}
          icon={<LogIn className="size-5" strokeWidth={1.75} />}
          title="加入房间"
          subtitle="通过房间号加入对局"
        />
        <ModeCard
          onClick={() => onPick('create')}
          icon={<Plus className="size-5" strokeWidth={1.75} />}
          title="创建房间"
          subtitle="设置执子与对局时限"
        />
      </div>
      <BackButton onClick={onBack} />
    </Screen>
  );
}

interface JoinFormProps {
  code: string;
  onCode: (c: string) => void;
  /** Join in progress: the button spins until the game starts or fails. */
  busy: boolean;
  onJoin: (roomId: string) => void;
  onBack: () => void;
}

export function JoinForm({ code, onCode, busy, onJoin, onBack }: JoinFormProps) {
  const valid = /^\d{4}$/.test(code);
  const submit = () => {
    if (valid && !busy) onJoin(code);
  };
  return (
    <Screen>
      <Heading title="加入房间" subtitle="请输入 4 位房间号" />
      <PinInput value={code} onChange={onCode} onSubmit={submit} disabled={busy} />
      <div className="space-y-2">
        <Button className="w-full h-10" disabled={!valid || busy} onClick={submit}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          加入
        </Button>
        <BackButton onClick={onBack} />
      </div>
    </Screen>
  );
}

interface CreateFormProps {
  busy: boolean;
  onCreate: (side: Stone, tc: TimeControl) => void;
  onBack: () => void;
}

export function CreateForm({ busy, onCreate, onBack }: CreateFormProps) {
  const [prefs] = useState(loadCreatePrefs);
  const [side, setSide] = useState<Stone>(prefs?.side ?? 1);
  const [main, setMain] = useState<number | null>(prefs?.timeControl.main ?? 10 * 60_000);
  const [perMove, setPerMove] = useState<number | null>(prefs?.timeControl.perMove ?? null);
  return (
    <Screen>
      <Heading title="创建房间" />
      <div className="space-y-5">
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
      <div className="space-y-2">
        <Button
          className="w-full h-10"
          disabled={busy}
          onClick={() => onCreate(side, { main, perMove })}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          创建
        </Button>
        <BackButton onClick={onBack} />
      </div>
    </Screen>
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

/**
 * Hints that keep password managers away from a field. Browsers decide on
 * their own in the end; these cover Chrome / Safari heuristics (no
 * one-time-code, no "pin"/"code" names) plus the common extensions.
 */
export const NO_AUTOFILL = {
  autoComplete: 'off',
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const;

function PinInput({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  // Focus on open, and again whenever a join attempt finishes.
  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  return (
    <div className={cn('relative', disabled && 'opacity-60')}>
      {/* The native input holds the value (good IME/paste handling) and
          covers the boxes, fully transparent; the boxes are decorative. */}
      <input
        ref={inputRef}
        // biome-ignore lint/a11y/noAutofocus: the room number is this form's only input
        autoFocus
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit();
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        type="text"
        inputMode="numeric"
        maxLength={4}
        name="gomind-room"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="房间号"
        {...NO_AUTOFILL}
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
    <Screen>
      <Heading
        title="等待对手加入"
        subtitle={peerDropped ? '对手连接中断，正在等待其重新连接' : '分享房间号或邀请链接'}
      />
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
        <Button className="w-full h-10" onClick={copy}>
          {copied ? '链接已复制' : '复制邀请链接'}
        </Button>
        <Button className="w-full h-10" variant="outline" onClick={onCancel}>
          取消房间
        </Button>
      </div>
    </Screen>
  );
}
