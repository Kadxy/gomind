// Transport for one two-seat room on the relay (see relay/server.js).
// Owns the WebSocket, heartbeats, dead-connection detection and automatic
// reconnection within the relay's grace window. Knows nothing about the
// game: peer messages and room events are handed to the listener.

import type { PeerMsg } from '@/game/peer-protocol';

// App-level ping cadence. The relay answers each with a pong; if nothing at
// all arrives for STALE_MS the socket is presumed dead (browsers can take
// minutes to notice a silently dropped TCP connection on their own).
const PING_INTERVAL_MS = 10_000;
const STALE_MS = 25_000;
const MAX_RETRY_DELAY_MS = 5_000;
// On a bad network the handshake can hang instead of failing; give up and
// retry rather than sit in CONNECTING for the browser's own (long) timeout.
const CONNECT_TIMEOUT_MS = 8_000;

// Close codes shared with relay/server.js.
const CLOSE_LEAVE = 4000;
const CLOSE_PEER_GONE = 4001;
const CLOSE_ROOM_FULL = 4002;
const CLOSE_REPLACED = 4003;
const CLOSE_NOT_FOUND = 4004;

export type RoomStatus =
  | 'idle'
  | 'connecting' // first connection to this room, no welcome yet
  | 'waiting_peer' // alone in the room
  | 'ready' // both seats online
  | 'peer_away' // other seat is held but its owner is offline
  | 'reconnecting' // our socket dropped; retrying while the relay holds our seat
  | 'ended' // room is gone; see `endReason`
  | 'error'; // could not enter; see `error`

export type RoomRole = 'host' | 'guest';
export type EndReason = 'peer_left' | 'lost';

export interface ConnState {
  status: RoomStatus;
  roomId: string | null;
  role: RoomRole | null;
  error: string | null;
  endReason: EndReason | null;
  /** When the opponent's held seat expires (status peer_away). */
  awayUntil: number | null;
}

export const initialConnState: ConnState = {
  status: 'idle',
  roomId: null,
  role: null,
  error: null,
  endReason: null,
  awayUntil: null,
};

export type RoomEvent =
  | { type: 'welcome'; role: RoomRole; peers: number; online: number; rejoined: boolean }
  | { type: 'peer_joined' }
  | { type: 'peer_away' }
  | { type: 'peer_back' }
  | { type: 'ended'; reason: EndReason };

type ServerMsg =
  | {
      type: 'welcome';
      role: RoomRole;
      peers: number;
      online: number;
      rejoined: boolean;
      grace: number;
    }
  | { type: 'peer_joined' }
  | { type: 'peer_away'; grace: number }
  | { type: 'peer_back' }
  | { type: 'pong' };

// Distribute Omit across the union so each variant keeps its discriminant.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type OutgoingMsg = DistributiveOmit<PeerMsg, 'v' | 'ts'>;

export interface RoomListener {
  onState: (s: ConnState) => void;
  onMessage: (m: PeerMsg) => void;
  onEvent: (e: RoomEvent) => void;
}

export class RoomConnection {
  private ws: WebSocket | null = null;
  /** Bumped by every reset; a create() that outlives one is abandoned. */
  private gen = 0;
  private state: ConnState = initialConnState;
  /** False after leave(): late socket events are ignored. */
  private active = false;
  /** Got a welcome in this room at least once, so drops are worth retrying. */
  private welcomed = false;
  private grace = 90_000;
  private reconnectDeadline: number | null = null;
  private retries = 0;
  private lastRx = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly wsBase: string,
    private readonly peerId: () => string,
    private readonly listener: RoomListener,
  ) {}

  get snapshot(): ConnState {
    return this.state;
  }

  /** Ask the relay for a fresh room and join it as host. */
  async create(): Promise<string | null> {
    this.reset();
    const gen = this.gen;
    this.set({ ...initialConnState, status: 'connecting' });
    try {
      const r = await fetch(`${this.wsBase.replace(/^ws/, 'http')}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer: this.peerId() }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { id } = (await r.json()) as { id: string };
      if (gen !== this.gen) return null;
      this.join(id);
      return id;
    } catch (e) {
      if (gen !== this.gen) return null;
      console.error('[room] create failed', e);
      this.set({ status: 'error', error: '无法连接服务器' });
      return null;
    }
  }

  join(roomId: string): void {
    this.reset();
    this.active = true;
    this.set({ ...initialConnState, status: 'connecting', roomId });
    this.open();
  }

  send(msg: OutgoingMsg): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[room] send while not open', msg.t);
      return;
    }
    ws.send(JSON.stringify({ ...msg, v: 2, ts: Date.now() }));
  }

  /** Deliberate exit: the relay tears the room down for both players. */
  leave(): void {
    // Take the socket first: reset() would otherwise close it without a
    // code, which the relay reads as a drop and holds our seat.
    const ws = this.ws;
    this.ws = null;
    this.reset();
    if (ws) this.detach(ws, CLOSE_LEAVE);
    if (this.state.status !== 'idle') this.set({ ...initialConnState });
  }

  /** Network came back or the tab became visible: check the link right away. */
  nudge(): void {
    if (!this.active) return;
    if (this.state.status === 'reconnecting' && !this.ws) {
      this.clearRetry();
      this.open();
      return;
    }
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (Date.now() - this.lastRx > STALE_MS) {
        this.drop(ws, 1006);
      } else {
        ws.send(JSON.stringify({ t: 'ping', v: 2, ts: Date.now() }));
      }
    }
  }

  // ------------------------------------------------------------ internals

  private set(patch: Partial<ConnState>): void {
    this.state = { ...this.state, ...patch };
    this.listener.onState(this.state);
  }

  private reset(): void {
    this.gen += 1;
    this.active = false;
    this.welcomed = false;
    this.reconnectDeadline = null;
    this.retries = 0;
    this.clearRetry();
    this.clearPing();
    const ws = this.ws;
    this.ws = null;
    if (ws) this.detach(ws);
  }

  private clearPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private detach(ws: WebSocket, code?: number): void {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try {
      ws.close(code);
    } catch {}
  }

  private open(): void {
    const id = this.state.roomId;
    if (!this.active || !id) return;
    const ws = new WebSocket(`${this.wsBase}/room/${id}?peer=${this.peerId()}`);
    this.ws = ws;
    this.lastRx = Date.now();
    const connectTimer = setTimeout(() => {
      if (this.ws === ws && ws.readyState === WebSocket.CONNECTING) this.drop(ws, 1006);
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      clearTimeout(connectTimer);
      this.clearPing();
      this.pingTimer = setInterval(() => {
        if (this.ws !== ws) return;
        if (Date.now() - this.lastRx > STALE_MS) {
          this.drop(ws, 1006);
          return;
        }
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ t: 'ping', v: 2, ts: Date.now() }));
        }
      }, PING_INTERVAL_MS);
    };

    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.lastRx = Date.now();
      let msg: ServerMsg | PeerMsg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        console.warn('[room] non-JSON message', ev.data);
        return;
      }
      if ('type' in msg) this.onServerMsg(msg);
      else this.listener.onMessage(msg);
    };

    ws.onclose = (ev) => {
      clearTimeout(connectTimer);
      if (this.ws !== ws) return;
      this.drop(ws, ev.code);
    };
  }

  private onServerMsg(msg: ServerMsg): void {
    switch (msg.type) {
      case 'pong':
        return;
      case 'welcome': {
        this.welcomed = true;
        this.reconnectDeadline = null;
        this.retries = 0;
        this.grace = msg.grace;
        const away = msg.peers > 0 && msg.online === 0;
        this.set({
          role: msg.role,
          error: null,
          status: msg.peers === 0 ? 'waiting_peer' : away ? 'peer_away' : 'ready',
          // We don't know how long ago they dropped, so show the full window.
          awayUntil: away ? Date.now() + msg.grace : null,
        });
        this.listener.onEvent({
          type: 'welcome',
          role: msg.role,
          peers: msg.peers,
          online: msg.online,
          rejoined: msg.rejoined,
        });
        return;
      }
      case 'peer_joined':
        this.set({ status: 'ready', awayUntil: null });
        this.listener.onEvent({ type: 'peer_joined' });
        return;
      case 'peer_away':
        this.set({ status: 'peer_away', awayUntil: Date.now() + msg.grace });
        this.listener.onEvent({ type: 'peer_away' });
        return;
      case 'peer_back':
        this.set({ status: 'ready', awayUntil: null });
        this.listener.onEvent({ type: 'peer_back' });
        return;
    }
  }

  private end(reason: EndReason): void {
    this.active = false;
    this.reconnectDeadline = null;
    this.set({ status: 'ended', endReason: reason, awayUntil: null });
    this.listener.onEvent({ type: 'ended', reason });
  }

  /** The socket is gone (closed, or presumed dead). Decide what happens next. */
  private drop(ws: WebSocket, code: number): void {
    this.clearPing();
    if (this.ws === ws) this.ws = null;
    this.detach(ws);
    if (!this.active) return;

    switch (code) {
      case CLOSE_PEER_GONE:
        this.end('peer_left');
        return;
      case CLOSE_ROOM_FULL:
        this.active = false;
        this.set({ status: 'error', error: '房间已满' });
        return;
      case CLOSE_REPLACED:
        this.active = false;
        this.set({ status: 'error', error: '已在另一个标签页或窗口中继续对局' });
        return;
      case CLOSE_NOT_FOUND:
        if (this.welcomed) {
          // Our seat expired before we made it back.
          this.end('lost');
        } else {
          this.active = false;
          this.set({ status: 'error', error: '房间不存在' });
        }
        return;
    }

    if (!this.welcomed) {
      this.active = false;
      this.set({ status: 'error', error: '无法连接服务器' });
      return;
    }

    // Network drop, proxy restart, ...: retry while the relay holds our seat.
    const now = Date.now();
    if (this.reconnectDeadline === null) this.reconnectDeadline = now + this.grace;
    if (now >= this.reconnectDeadline) {
      this.end('lost');
      return;
    }
    if (this.state.status !== 'reconnecting') this.set({ status: 'reconnecting' });
    const delay = Math.min(MAX_RETRY_DELAY_MS, 500 * 2 ** Math.min(this.retries, 4));
    this.retries += 1;
    this.clearRetry();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }
}
