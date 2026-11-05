import { cn } from '@/lib/utils';
import { ArrowRight } from 'lucide-react';

/** Large tappable card used for top-level choices (单机 / 联机, 加入 / 创建). */
export function ModeCard({
  onClick,
  icon,
  title,
  subtitle,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex items-center gap-4 p-5 lg:p-6 text-left',
        'rounded-2xl border border-border/70 bg-card',
        'transition-all duration-200 ease-out',
        'shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-foreground/20',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
    >
      <div
        className={cn(
          'inline-flex items-center justify-center size-10 rounded-xl',
          'bg-muted/60 border border-border/70',
          'text-foreground/80 group-hover:text-foreground transition-colors',
        )}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-base font-semibold tracking-tight">{title}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>
      </div>
      <ArrowRight
        className={cn(
          'size-4 text-muted-foreground shrink-0',
          'transition-all group-hover:text-foreground group-hover:translate-x-0.5',
        )}
      />
    </button>
  );
}
