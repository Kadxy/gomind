import { clamp } from '@/game/online';
import { cn } from '@/lib/utils';
import { useEffect, useId, useRef, useState } from 'react';

interface TimeFieldProps {
  label: string;
  presets: { value: number | null; label: string }[];
  value: number | null;
  onChange: (v: number | null) => void;
  /** Unit shown after the custom number, e.g. 分 / 秒. */
  unit: string;
  unitMs: number;
  /** Allowed custom range, in units. */
  range: { min: number; max: number };
  step: number;
  /** Custom value (in units) offered the first time 自定义 is picked. */
  fallback: number;
  disabled?: boolean;
}

const SEG =
  'h-8 min-w-0 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring inline-flex items-center justify-center rounded-md px-1 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';
const SEG_ON = 'bg-background text-foreground shadow-sm';
const SEG_OFF = 'text-muted-foreground hover:text-foreground hover:bg-background/50';

/**
 * Segmented presets whose last segment, 自定义, turns into an inline number
 * field when picked. Values are clamped to `range` when the field loses
 * focus; arrow keys step by `step`.
 */
export function TimeField({
  label,
  presets,
  value,
  onChange,
  unit,
  unitMs,
  range,
  step,
  fallback,
  disabled,
}: TimeFieldProps) {
  const isPreset = presets.some((p) => p.value === value);
  const [custom, setCustom] = useState(!isPreset);
  const [draft, setDraft] = useState(() =>
    String(value !== null && !isPreset ? Math.round(value / unitMs) : fallback),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const focusNext = useRef(false);
  const name = useId();

  useEffect(() => {
    if (custom && focusNext.current) {
      focusNext.current = false;
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [custom]);

  const parsed = clamp(Number.parseInt(draft, 10) || range.min, range.min, range.max);
  const commit = (n: number) => {
    const c = clamp(n, range.min, range.max);
    setDraft(String(c));
    onChange(c * unitMs);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <fieldset
        aria-label={label}
        className="grid gap-1 p-1 rounded-lg bg-muted/60 border border-border"
        style={{ gridTemplateColumns: `repeat(${presets.length + 1}, minmax(0, 1fr))` }}
      >
        {presets.map((p) => {
          const on = !custom && p.value === value;
          return (
            <label key={p.label} className={cn(SEG, 'cursor-pointer', on ? SEG_ON : SEG_OFF)}>
              <input
                type="radio"
                name={name}
                className="sr-only"
                checked={on}
                disabled={disabled}
                onChange={() => {
                  setCustom(false);
                  onChange(p.value);
                }}
              />
              {p.label}
            </label>
          );
        })}
        {custom ? (
          <label
            className={cn(
              SEG,
              SEG_ON,
              'gap-0.5 cursor-text focus-within:ring-2 focus-within:ring-ring',
              disabled && 'opacity-50',
            )}
          >
            <input
              ref={inputRef}
              value={draft}
              disabled={disabled}
              inputMode="numeric"
              autoComplete="off"
              data-1p-ignore="true"
              data-lpignore="true"
              data-bwignore="true"
              data-form-type="other"
              aria-label={`自定义${label}（${unit}）`}
              onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, '').slice(0, 3);
                setDraft(raw);
                const v = Number.parseInt(raw, 10);
                if (Number.isFinite(v)) onChange(clamp(v, range.min, range.max) * unitMs);
              }}
              onBlur={() => commit(parsed)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  commit(parsed + step);
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  commit(parsed - step);
                }
              }}
              style={{ width: `${Math.max(draft.length, 1) + 0.4}ch` }}
              className="bg-transparent text-center tabular-nums outline-none border-b border-dashed border-foreground/35 focus:border-foreground/70 leading-tight"
            />
            <span className="text-muted-foreground">{unit}</span>
          </label>
        ) : (
          <label className={cn(SEG, 'cursor-pointer', SEG_OFF)}>
            <input
              type="radio"
              name={name}
              className="sr-only"
              checked={false}
              disabled={disabled}
              onChange={() => {
                focusNext.current = true;
                setCustom(true);
                onChange(parsed * unitMs);
              }}
            />
            自定义
          </label>
        )}
      </fieldset>
    </div>
  );
}
