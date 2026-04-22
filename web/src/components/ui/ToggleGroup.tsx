import { cn } from '@/lib/utils';

interface ToggleGroupProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  className?: string;
  disabled?: boolean;
}

export function ToggleGroup<T extends string>({
  value,
  onChange,
  options,
  className,
  disabled,
}: ToggleGroupProps<T>) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-grid gap-1 p-1 rounded-lg bg-muted/60 border border-border w-full',
        `grid-cols-${options.length}`,
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/50',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
