import { Button } from '@/components/ui/Button';
import { ToggleGroup } from '@/components/ui/ToggleGroup';
import {
  MAIN_MINUTES_RANGE,
  MAIN_TIME_OPTIONS,
  PER_MOVE_OPTIONS,
  PER_MOVE_SECONDS_RANGE,
  clamp,
  describeTimeControl,
} from '@/game/online';
import type { TimeControl } from '@/game/peer-protocol';
import type { Stone } from '@/game/types';
import { loadCreatePrefs } from '@/lib/onlineStorage';
import { cn } from '@/lib/utils';
import { Check, Copy, Link2, Loader2, Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type LobbyTab = 'join' | 'create';

interface LobbyProps {
  tab: LobbyTab;
  onTab: (t: LobbyTab) => void;
  code: string;
  onCode: (c: string) => void;
  /** The join / create in progress (button spinner). */
  busy: boolean;
  /** Result of the last attempt, shown under the active form. */
  error: string | null;
  /** Neutral status while busy, e.g. the host is offline. */
  info: string | null;
  onJoin: (roomId: string) => void;
  onCreate: (side: Stone, tc: TimeControl) => void;
  onCancel: () => void;
}

/** Entry screen: one card that switches between joining and creating a room. */
export function Lobby(props: LobbyProps) {
  const { tab, onTab, busy } = props;
  return (
    <main className="flex-1 min-h-0 overflow-y-auto flex items-start sm:items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card p-5 sm:p-6 shadow-sm space-y-6">
        <ToggleGroup<LobbyTab>
          value={tab}
          onChange={onTab}
          disabled={busy}
          options={[
            { value: 'join', label: '加入房间' },
            { value: 'create', label: '创建房间' },
          ]}
        />
        {tab === 'join' ? <JoinForm {...props} /> : <CreateForm {...props} />}
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

function JoinForm({ code, onCode, busy, error, info, onJoin, onCancel }: LobbyProps) {
  const valid = /^\d{4}$/.test(code);
  const submit = () => {
    if (valid && !busy) onJoin(code);
  };
  return (
    <div className="space-y-3">
      <PinInput value={code} onChange={onCode} onSubmit={submit} disabled={busy} focusKey={error} />
      <Feedback error={error} info={busy ? info : null} />
      <Button className="w-full h-10" disabled={!valid || busy} onClick={submit}>
        {busy && <Loader2 className="size-4 animate-spin" />}
        加入
      </Button>
      {busy && info && (
        <Button variant="ghost" className="w-full" onClick={onCancel}>
          取消
        </Button>
      )}
    </div>
  );
}

const key = (v: number | null) => (v === null ? 'none' : String(v));

function CreateForm({ busy, error, onCreate }: LobbyProps) {
  const [prefs] = useState(loadCreatePrefs);
  const [side, setSide] = useState<Stone>(prefs?.side ?? 1);
  const [main, setMain] = useState<number | null>(prefs?.timeControl.main ?? 10 * 60_000);
  const [perMove, setPerMove] = useState<number | null>(prefs?.timeControl.perMove ?? null);
  return (
    <div className="space-y-4">
      <Field label="执子">
        <ToggleGroup<string>
          value={String(side)}
          onChange={(v) => setSide(Number(v) as Stone)}
          disabled={busy}
          options={[
            { value: '1', label: '黑 · 先手', icon: <Dot fill="#111827" stroke="#111827" /> },
            { value: '2', label: '白 · 后手', icon: <Dot fill="#f9fafb" stroke="#9ca3af" /> },
          ]}
        />
      </Field>
      <TimeField
        label="局时"
        options={MAIN_TIME_OPTIONS}
        value={main}
        onChange={setMain}
        unit="分钟"
        unitMs={60_000}
        range={MAIN_MINUTES_RANGE}
        step={1}
        fallback={15}
        disabled={busy}
      />
      <TimeField
        label="步时"
        options={PER_MOVE_OPTIONS}
        value={perMove}
        onChange={setPerMove}
        unit="秒"
        unitMs={1000}
        range={PER_MOVE_SECONDS_RANGE}
        step={5}
        fallback={45}
        disabled={busy}
      />
      <Feedback error={error} />
      <Button
        className="w-full h-10"
        disabled={busy}
        onClick={() => onCreate(side, { main, perMove })}
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        创建
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** Preset segments plus "自定义", which reveals a clamped number stepper. */
function TimeField({
  label,
  options,
  value,
  onChange,
  unit,
  unitMs,
  range,
  step,
  fallback,
  disabled,
}: {
  label: string;
  options: { value: number | null; label: string }[];
  value: number | null;
  onChange: (v: number | null) => void;
  unit: string;
  unitMs: number;
  range: { min: number; max: number };
  step: number;
  fallback: number;
  disabled?: boolean;
}) {
  const isPreset = options.some((o) => o.value === value);
  const [custom, setCustom] = useState(!isPreset);
  const initial = value !== null && !isPreset ? Math.round(value / unitMs) : fallback;
  const [draft, setDraft] = useState(String(initial));
  const n = clamp(Number.parseInt(draft, 10) || range.min, range.min, range.max);

  const commit = (v: number) => {
    const c = clamp(v, range.min, range.max);
    setDraft(String(c));
    onChange(c * unitMs);
  };

  return (
    <Field label={label}>
      <ToggleGroup<string>
        value={custom ? 'custom' : key(value)}
        disabled={disabled}
        onChange={(k) => {
          if (k === 'custom') {
            setCustom(true);
            onChange(n * unitMs);
          } else {
            setCustom(false);
            onChange(k === 'none' ? null : Number(k));
          }
        }}
        options={[
          ...options.map((o) => ({ value: key(o.value), label: o.label })),
          { value: 'custom', label: '自定义' },
        ]}
      />
      {custom && (
        <div className="flex items-center justify-center gap-2 pt-1">
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="减少"
            disabled={disabled || n <= range.min}
            onClick={() => commit(n - step)}
          >
            <Minus className="size-3.5" />
          </Button>
          <input
            value={draft}
            disabled={disabled}
            inputMode="numeric"
            aria-label={`${label}（${unit}）`}
            onChange={(e) => {
              const raw = e.target.value.replace(/\D/g, '').slice(0, 3);
              setDraft(raw);
              const v = Number.parseInt(raw, 10);
              if (Number.isFinite(v)) onChange(clamp(v, range.min, range.max) * unitMs);
            }}
            onBlur={() => commit(n)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                commit(n + step);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                commit(n - step);
              }
            }}
            className="w-16 h-8 rounded-md border border-border bg-background text-center font-mono tabular-nums text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="增加"
            disabled={disabled || n >= range.max}
            onClick={() => commit(n + step)}
          >
            <Plus className="size-3.5" />
          </Button>
          <span className="w-8 text-sm text-muted-foreground">{unit}</span>
        </div>
      )}
    </Field>
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
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const copy = (what: 'code' | 'link') => {
    navigator.clipboard.writeText(what === 'code' ? roomId : shareUrl).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
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
        <button
          type="button"
          onClick={() => copy('code')}
          className="w-full rounded-xl bg-muted/60 py-5 hover:bg-muted transition-colors"
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
        <p className="text-center text-xs text-muted-foreground">
          你执{hostSide === 1 ? '黑 · 先手' : '白 · 后手'} · {describeTimeControl(timeControl)}
        </p>
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
    </main>
  );
}
