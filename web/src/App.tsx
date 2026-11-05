import { HomeApp } from '@/HomeApp';
import { LocalApp } from '@/LocalApp';
import { OnlineApp } from '@/OnlineApp';
import { cn } from '@/lib/utils';
import { ChevronLeft } from 'lucide-react';
import { useEffect, useState } from 'react';

type Route = 'home' | 'local' | 'online';

// Path-based routing. A `?room=XXXX` deep link goes straight to `online`
// regardless of pathname so shared room links Just Work; otherwise we
// route by path: `/local` → single-device play, `/online` → online, `/`
// (anything else) → home with mode-pick cards.
function routeFromLocation(): Route {
  if (typeof window === 'undefined') return 'home';
  const params = new URLSearchParams(window.location.search);
  const roomParam = params.get('room');
  if (roomParam && /^\d{4}$/.test(roomParam)) return 'online';
  const { pathname } = window.location;
  if (pathname.startsWith('/online')) return 'online';
  if (pathname.startsWith('/local')) return 'local';
  return 'home';
}

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromLocation);

  useEffect(() => {
    const onPop = () => setRoute(routeFromLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (to: Route) => {
    if (to === route) return;
    const path = to === 'home' ? '/' : to === 'online' ? '/online' : '/local';
    window.history.pushState(null, '', path);
    setRoute(to);
  };

  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-background text-foreground">
      <Header route={route} onNavigate={navigate} />
      {route === 'home' ? (
        <HomeApp onNavigate={navigate} />
      ) : route === 'online' ? (
        <OnlineApp onExit={() => navigate('home')} />
      ) : (
        <LocalApp />
      )}
    </div>
  );
}

function Header({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }) {
  const onGamePage = route !== 'home';
  return (
    <header className="flex items-center justify-between px-4 lg:px-6 h-12 border-b border-border/70 shrink-0 bg-background/80 backdrop-blur">
      <div className="flex items-center gap-2">
        {onGamePage && (
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className={cn(
              'inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground',
              'hover:text-foreground transition-colors rounded-md px-1.5 py-1 -ml-1.5',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
            aria-label="返回首页"
          >
            <ChevronLeft className="size-4" />
            <span>首页</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="text-sm font-semibold tracking-tight hover:opacity-80 transition-opacity"
        >
          Gomind
        </button>
        {onGamePage && (
          <span className="text-xs text-muted-foreground/80 hidden sm:inline-block">
            · {route === 'local' ? '单机' : '联机'}
          </span>
        )}
      </div>
    </header>
  );
}
