import { ModeCard } from '@/components/ModeCard';
import { Gamepad2, Users } from 'lucide-react';

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
