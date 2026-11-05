import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PeerMsg } from '@/game/peer-protocol';

// Relay server URL. WebSocket path uses `/room/<ID>` — one room per path.
// Default is same-origin (ws:// or wss:// to match the page), which is
// right whenever the relay serves the built frontend (STATIC_DIR) or sits
// behind the same reverse proxy. In dev, vite.config.ts proxies `/room`
// to the local relay (`bun run dev:relay`). Set VITE_RELAY_WS_URL at
// build time to point at a relay hosted elsewhere (wss://relay.example.com).
const RELAY_WS_URL = (() => {
  const override = import.meta.env.VITE_RELAY_WS_URL;
  if (override) return override.replace(/\/+$/, '');
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
})();

// App-level ping cadence. Relay's idleTimeout is 120s; ~30s ping keeps
// that from firing on active-but-silent games (e.g. tab in background).
const PING_INTERVAL_MS = 30_000;

// Room ended because the other peer disconnected — relay fires this
// code on all surviving sockets before deleting the room.
const CLOSE_CODE_PEER_GONE = 4001;
// Room was already full when we tried to join.
const CLOSE_CODE_ROOM_FULL = 4002;

export type RoomStatus =
  | 'idle'
  | 'connecting'
  | 'waiting_peer' // we're alone in the room
  | 'ready' // both peers present
  | 'ended' // game ended (peer disconnected; room is destroyed)
  | 'error';

export interface UseRemoteRoomArgs {
  onMessage: (msg: PeerMsg) => void;
}

// Distribute Omit across the discriminated union so each variant keeps
// its own discriminant shape. A plain Omit<PeerMsg, ...> collapses to
// only the intersection of common keys, which loses the `t` field.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type OutgoingMsg = DistributiveOmit<PeerMsg, 'v' | 'ts'>;

export interface UseRemoteRoomReturn {
  status: RoomStatus;
  error: string | null;
  roomId: string | null;
  /// True iff this client was alone in the room at welcome time. The
  /// consumer uses this to decide who rolls the side assignment when
  /// the second peer joins.
  isFirst: boolean;
  connect: (roomId: string) => void;
  send: (msg: OutgoingMsg) => void;
  leave: () => void;
}

// Server-originated control messages, distinct from PeerMsg (which uses `t`).
type ServerMsg = { type: 'welcome'; peers: number } | { type: 'peer_joined' };

/**
 * Thin native-WebSocket wrapper for a two-player room. The server is a
 * dumb relay: every JSON message this hook sends is forwarded verbatim
 * to the other peer. Server-originated control messages (welcome,
 * peer_joined) are handled internally and never surface to onMessage.
 */
export function useRemoteRoom({ onMessage }: UseRemoteRoomArgs): UseRemoteRoomReturn {
  const [status, setStatus] = useState<RoomStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [isFirst, setIsFirst] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  });

  const cleanup = useCallback(() => {
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    const ws = wsRef.current;
    if (ws) {
      wsRef.current = null;
      try {
        ws.close();
      } catch {}
    }
  }, []);

  const connect = useCallback(
    (id: string) => {
      cleanup();
      setError(null);
      setRoomId(id);
      setStatus('connecting');
      setIsFirst(false);

      const ws = new WebSocket(`${RELAY_WS_URL}/room/${id}`);
      wsRef.current = ws;

      ws.onopen = () => {
        // Start heartbeat once the socket is actually open. Before open,
        // send() throws. 30s cadence keeps the relay's 120s idleTimeout
        // from reaping us even when the tab is in the background.
        pingTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ t: 'ping', v: 1, ts: Date.now() }));
          }
        }, PING_INTERVAL_MS);
      };

      ws.onmessage = (ev) => {
        let msg: ServerMsg | PeerMsg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          console.warn('[room] non-JSON message', ev.data);
          return;
        }
        if ('type' in msg) {
          if (msg.type === 'welcome') {
            setIsFirst(msg.peers === 0);
            setStatus(msg.peers > 0 ? 'ready' : 'waiting_peer');
          } else if (msg.type === 'peer_joined') {
            setStatus('ready');
          }
          return;
        }
        onMessageRef.current(msg as PeerMsg);
      };

      ws.onerror = (ev) => {
        console.error('[room] ws error', ev);
      };

      ws.onclose = (ev) => {
        if (pingTimerRef.current) {
          clearInterval(pingTimerRef.current);
          pingTimerRef.current = null;
        }
        // Guard against late events from a socket we already replaced.
        if (wsRef.current !== ws) return;
        wsRef.current = null;

        if (ev.code === CLOSE_CODE_PEER_GONE) {
          setStatus('ended');
          setError('对局结束');
          return;
        }
        if (ev.code === CLOSE_CODE_ROOM_FULL) {
          setStatus('error');
          setError('房间已满');
          return;
        }
        // 1000 = normal close from us (leave). 1001 = going away (tab close).
        if (ev.code !== 1000 && ev.code !== 1001) {
          setStatus('error');
          setError(ev.reason || `连接关闭 (${ev.code})`);
        }
      };
    },
    [cleanup],
  );

  const send = useCallback((msg: OutgoingMsg) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[room] send while not open', msg);
      return;
    }
    const payload = {
      ...msg,
      v: 1 as const,
      ts: Date.now(),
    };
    ws.send(JSON.stringify(payload));
  }, []);

  const leave = useCallback(() => {
    cleanup();
    setRoomId(null);
    setStatus('idle');
    setError(null);
    setIsFirst(false);
  }, [cleanup]);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // Memo'd so consumers depending on `room` in useEffect deps don't
  // refire on every render (their setState would otherwise produce a
  // new `room` object each time, causing an infinite loop of effects).
  return useMemo(
    () => ({ status, error, roomId, isFirst, connect, send, leave }),
    [status, error, roomId, isFirst, connect, send, leave],
  );
}
