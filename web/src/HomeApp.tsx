import { ArrowRight, Gamepad2, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HomeAppProps {
  onNavigate: (to: 'local' | 'online') => void;
}

export function HomeApp({ onNavigate }: HomeAppProps) {
  return (
    <main className="flex-1 min-h-0 flex flex-col items-center justify-center p-6 gap-10 lg:gap-12">
      <header className="text-center space-y-1.5">
        <h1 className="text-5xl lg:text-6xl font-semibold tracking-tight">Gomind</h1>
        <p className="text-sm text-muted-foreground tracking-wider uppercase">Gomoku · 五子棋</p>
      </header>
      <div className="w-full max-w-xl grid gap-3 sm:grid-cols-2">
        <ModeCard
          onClick={() => onNavigate('local')}
          icon={<Gamepad2 className="size-5" strokeWidth={1.75} />}
          title="单机"
          subtitle="自己玩或者和 AI 对弈"
        />
        <ModeCard
          onClick={() => onNavigate('online')}
          icon={<Users className="size-5" strokeWidth={1.75} />}
          title="联机"
          subtitle="和朋友远程对战"
        />
      </div>
    </main>
  );
}

function ModeCard({
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
