import type { PeerMsg } from '@/game/peer-protocol';
import { getPeerId } from '@/lib/onlineStorage';
import {
  type ConnState,
  type OutgoingMsg,
  RoomConnection,
  type RoomEvent,
  initialConnState,
} from '@/lib/roomConnection';
import { useEffect, useMemo, useRef, useState } from 'react';

export type { EndReason, OutgoingMsg, RoomEvent, RoomRole, RoomStatus } from '@/lib/roomConnection';

// Relay base URL. Default is same-origin (ws:// or wss:// to match the
// page): right whenever the relay serves the built frontend or sits behind
// the same reverse proxy. In dev, vite.config.ts proxies `/room/`, `/rooms`
// and `/health` to the local relay (`bun run dev:relay`). Set
// VITE_RELAY_WS_URL at build time to use a relay hosted elsewhere.
const RELAY_WS_URL = (() => {
  const override = import.meta.env.VITE_RELAY_WS_URL;
  if (override) return override.replace(/\/+$/, '');
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
})();

export interface UseRemoteRoomArgs {
  onMessage: (msg: PeerMsg) => void;
  onEvent: (ev: RoomEvent) => void;
}

export interface UseRemoteRoomReturn extends ConnState {
  create: () => Promise<string | null>;
  join: (roomId: string) => void;
  send: (msg: OutgoingMsg) => void;
  leave: () => void;
}

/** React binding for RoomConnection. Unmounting counts as leaving the room. */
export function useRemoteRoom({ onMessage, onEvent }: UseRemoteRoomArgs): UseRemoteRoomReturn {
  const [conn, setConn] = useState<ConnState>(initialConnState);
  const onMessageRef = useRef(onMessage);
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onMessageRef.current = onMessage;
    onEventRef.current = onEvent;
  });

  const ref = useRef<RoomConnection | null>(null);
  if (!ref.current) {
    ref.current = new RoomConnection(RELAY_WS_URL, getPeerId, {
      onState: setConn,
      onMessage: (m) => onMessageRef.current(m),
      onEvent: (e) => onEventRef.current(e),
    });
  }
  const rc = ref.current;

  // Unmount = leave, deferred one tick: React StrictMode (dev) runs every
  // effect's cleanup and then the effect again on mount, and leaving for
  // real there would tear down the room we just joined.
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    const nudge = () => rc.nudge();
    const onVisible = () => {
      if (document.visibilityState === 'visible') rc.nudge();
    };
    window.addEventListener('online', nudge);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', nudge);
      document.removeEventListener('visibilitychange', onVisible);
      // In-app navigation away (header link, back button) is a deliberate
      // exit. A page reload never gets here: the browser just drops the
      // socket, and the relay holds the seat for the grace window.
      leaveTimer.current = setTimeout(() => rc.leave(), 0);
    };
  }, [rc]);

  return useMemo(
    () => ({
      ...conn,
      create: () => rc.create(),
      join: (id: string) => rc.join(id),
      send: (m: OutgoingMsg) => rc.send(m),
      leave: () => rc.leave(),
    }),
    [conn, rc],
  );
}
