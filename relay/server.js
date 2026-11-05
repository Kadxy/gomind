// WebSocket relay for Gomind remote play, plus optional static hosting of the
// built frontend so the whole app runs as ONE process.
//
// The relay never parses game messages; it fans every client message out to
// the other peer in the same room. What it does track is *seats*: who is in
// a room, keyed by a per-browser peer id, so a refresh or a dropped network
// can come back to the same seat within a grace window.
//
// HTTP:
//   POST /rooms  {peer}      -> {id, grace}  allocate a free 4-digit room,
//                              reserving the host seat for `peer` (CORS-enabled
//                              for ALLOWED_ORIGINS)
//   GET  /health             -> {ok, rooms}
//   GET  /room/<ID>?peer=ID  WebSocket (upgrade)
//
// Server -> client control messages (JSON, `type` field):
//   welcome     {role, peers, online, rejoined, grace}
//   peer_joined                a new peer took the other seat
//   peer_away   {grace}        the other peer dropped; seat held for `grace` ms
//   peer_back                  the other peer reconnected to their seat
//   pong                       reply to a client {t:'ping'}
//
// Close codes:
//   4000 (client -> server)  explicit leave: room is torn down at once
//   4001  peer disconnected: the other seat left or its grace expired
//   4002  room full          4003  replaced by a newer connection with the
//   4004  room not found           same peer id (e.g. a second tab)
//
// Env:
//   PORT             listen port (default 8000)
//   ALLOWED_ORIGINS  comma-separated Origin allowlist; '*' = any
//   STATIC_DIR       serve this directory (web/dist) with SPA fallback
//   GRACE_MS         how long a dropped seat is held (default 90000)
//   CLAIM_MS         how long a created room waits for its host (default 20000)
//   MAX_UNCLAIMED    cap on created-but-unjoined rooms (default 200)

import { stat } from 'node:fs/promises';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 8000);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const STATIC_DIR = process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : null;
const GRACE_MS = Number(process.env.GRACE_MS ?? 90_000);
// A room created over POST whose host never connects is dropped after this.
const CLAIM_MS = Number(process.env.CLAIM_MS ?? 20_000);
// Rooms created over POST but not yet joined. Creation is unauthenticated,
// so this bounds how much of the 4-digit space a script can squat on.
const MAX_UNCLAIMED = Number(process.env.MAX_UNCLAIMED ?? 200);
// Requests and frames are tiny (a full-board sync is ~3 KB).
const MAX_BODY_BYTES = 16 * 1024;
const MAX_FRAME_BYTES = 64 * 1024;
const ROOM_CAP = 2;
// A socket we've heard nothing from (no message, no pong) for this long is
// presumed dead: its seat enters the grace window and the opponent's clock
// pauses. Bun's own idleTimeout can't do this, because our pings count as
// activity for it. We ping at a third of that, so a live client answers
// at least twice before the deadline.
const DEAD_AFTER_MS = Number(process.env.DEAD_AFTER_MS ?? 15_000);
const SERVER_PING_INTERVAL_MS = Math.min(5_000, Math.floor(DEAD_AFTER_MS / 3));

const CLOSE_LEAVE = 4000;
const CLOSE_PEER_GONE = 4001;
const CLOSE_ROOM_FULL = 4002;
const CLOSE_REPLACED = 4003;
const CLOSE_NOT_FOUND = 4004;

// Cross-origin isolation headers expose SharedArrayBuffer, which the
// threaded Rapfi build probes for. Mirrors vite.config.ts.
const COI_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/**
 * @typedef {{ ws: any | null, role: 'host' | 'guest', connectedOnce: boolean,
 *             awayTimer: ReturnType<typeof setTimeout> | null }} Seat
 * @typedef {{ id: string, seats: Map<string, Seat>,
 *             claimTimer: ReturnType<typeof setTimeout> | null }} Room
 */
/** @type {Map<string, Room>} */
const rooms = new Map();

const ROOM_RE = /^\/room\/(\d{4})$/;
const PEER_RE = /^[A-Za-z0-9_-]{8,64}$/;

function originAllowed(origin) {
  if (ALLOWED_ORIGINS.length === 1 && ALLOWED_ORIGINS[0] === '*') return true;
  if (!origin) return false;
  return ALLOWED_ORIGINS.some((a) => {
    if (a === origin) return true;
    if (a.includes('*')) {
      const re = new RegExp(`^${a.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')}$`);
      return re.test(origin);
    }
    return false;
  });
}

/**
 * CORS for POST /rooms, so a frontend hosted on another origin (see
 * VITE_RELAY_WS_URL) can create rooms. WebSocket upgrades don't use CORS;
 * they are checked against ALLOWED_ORIGINS directly.
 */
function corsHeaders(origin) {
  if (!origin || !originAllowed(origin)) return {};
  const any = ALLOWED_ORIGINS.length === 1 && ALLOWED_ORIGINS[0] === '*';
  return {
    'Access-Control-Allow-Origin': any ? '*' : origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    ...(any ? {} : { Vary: 'Origin' }),
  };
}

function allocRoomId() {
  if (rooms.size >= 9000) return null;
  for (let i = 0; i < 64; i++) {
    const id = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    if (!rooms.has(id)) return id;
  }
  for (let n = 0; n < 10000; n++) {
    const id = String(n).padStart(4, '0');
    if (!rooms.has(id)) return id;
  }
  return null;
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function others(room, peerId) {
  return [...room.seats.entries()].filter(([id]) => id !== peerId).map(([, s]) => s);
}

function destroyRoom(room, code, reason) {
  if (!rooms.delete(room.id)) return;
  if (room.claimTimer) {
    clearTimeout(room.claimTimer);
    room.claimTimer = null;
    unclaimed -= 1;
  }
  for (const seat of room.seats.values()) {
    if (seat.awayTimer) clearTimeout(seat.awayTimer);
    const ws = seat.ws;
    seat.ws = null;
    if (ws) {
      ws.data.seat = null;
      ws.close(code, reason);
    }
  }
  console.log(`[room ${room.id}] destroyed (${reason})`);
}

let unclaimed = 0;

function createRoom(hostPeer) {
  if (unclaimed >= MAX_UNCLAIMED) return null;
  const id = allocRoomId();
  if (!id) return null;
  /** @type {Room} */
  const room = { id, seats: new Map(), claimTimer: null };
  room.seats.set(hostPeer, { ws: null, role: 'host', connectedOnce: false, awayTimer: null });
  unclaimed += 1;
  room.claimTimer = setTimeout(() => {
    room.claimTimer = null;
    unclaimed -= 1;
    const anyOnline = [...room.seats.values()].some((s) => s.ws);
    if (!anyOnline) destroyRoom(room, CLOSE_PEER_GONE, 'unclaimed');
  }, CLAIM_MS);
  rooms.set(id, room);
  console.log(`[room ${id}] created`);
  return room;
}

// ---------------------------------------------------------------- static

function cacheControlFor(pathname) {
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (pathname.startsWith('/rapfi/')) return 'public, max-age=86400';
  return 'no-cache';
}

const notFound = () => new Response('not found', { status: 404 });

async function serveStatic(pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return new Response('bad request', { status: 400 });
  }
  let abs = path.normalize(path.join(STATIC_DIR, rel));
  if (abs !== STATIC_DIR && !abs.startsWith(STATIC_DIR + path.sep)) return notFound();

  let s = await stat(abs).catch(() => null);
  if (s?.isDirectory()) {
    abs = path.join(abs, 'index.html');
    s = await stat(abs).catch(() => null);
  }
  if (!s?.isFile()) {
    if (path.extname(rel)) return notFound();
    abs = path.join(STATIC_DIR, 'index.html');
    s = await stat(abs).catch(() => null);
    if (!s?.isFile()) return notFound();
  }
  return new Response(Bun.file(abs), {
    headers: {
      ...COI_HEADERS,
      'Cache-Control': cacheControlFor(pathname),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  });
}

// ---------------------------------------------------------------- server

const server = Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  maxRequestBodySize: MAX_BODY_BYTES,
  async fetch(req, srv) {
    const url = new URL(req.url);

    if (url.pathname === '/health') {
      return Response.json({ ok: true, rooms: rooms.size });
    }

    if (url.pathname === '/rooms') {
      const origin = req.headers.get('origin');
      const cors = corsHeaders(origin);
      // Same-origin requests may omit Origin; cross-origin ones must match.
      if (origin && !originAllowed(origin)) {
        return new Response('origin not allowed', { status: 403 });
      }
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (req.method !== 'POST') {
        return new Response('method not allowed', {
          status: 405,
          headers: { Allow: 'POST, OPTIONS' },
        });
      }
      let body;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: 'bad json' }, { status: 400, headers: cors });
      }
      const peer = typeof body?.peer === 'string' ? body.peer : '';
      if (!PEER_RE.test(peer)) {
        return Response.json({ error: 'bad peer id' }, { status: 400, headers: cors });
      }
      const room = createRoom(peer);
      if (!room) return Response.json({ error: 'busy' }, { status: 503, headers: cors });
      return Response.json({ id: room.id, grace: GRACE_MS }, { headers: cors });
    }

    const m = url.pathname.match(ROOM_RE);
    if (m) {
      if (!originAllowed(req.headers.get('origin'))) {
        return new Response('origin not allowed', { status: 403 });
      }
      const peerId = url.searchParams.get('peer') ?? '';
      if (!PEER_RE.test(peerId)) return new Response('bad peer id', { status: 400 });
      if (srv.upgrade(req, { data: { roomId: m[1], peerId, seat: null } })) return;
      return new Response('upgrade failed', { status: 400 });
    }

    if (STATIC_DIR) return serveStatic(url.pathname);
    return notFound();
  },
  websocket: {
    // Backstop only; liveness is tracked via lastSeen (see the ping loop).
    idleTimeout: 120,
    maxPayloadLength: MAX_FRAME_BYTES,
    open(ws) {
      ws.data.lastSeen = Date.now();
      const { roomId, peerId } = ws.data;
      const room = rooms.get(roomId);
      if (!room) {
        ws.close(CLOSE_NOT_FOUND, 'room not found');
        return;
      }
      let seat = room.seats.get(peerId);
      if (seat) {
        if (seat.awayTimer) {
          clearTimeout(seat.awayTimer);
          seat.awayTimer = null;
        }
        if (seat.ws) {
          // Same browser opened a second connection (another tab, or a
          // reconnect racing the old socket's close). Newest wins.
          const old = seat.ws;
          seat.ws = null;
          old.data.seat = null;
          old.close(CLOSE_REPLACED, 'replaced');
        }
      } else {
        if (room.seats.size >= ROOM_CAP) {
          ws.close(CLOSE_ROOM_FULL, 'room full');
          return;
        }
        seat = { ws: null, role: 'guest', connectedOnce: false, awayTimer: null };
        room.seats.set(peerId, seat);
      }
      if (room.claimTimer) {
        clearTimeout(room.claimTimer);
        room.claimTimer = null;
        unclaimed -= 1;
      }

      const rejoined = seat.connectedOnce;
      seat.connectedOnce = true;
      seat.ws = ws;
      ws.data.seat = seat;

      const rest = others(room, peerId);
      send(ws, {
        type: 'welcome',
        role: seat.role,
        peers: rest.length,
        online: rest.filter((s) => s.ws).length,
        rejoined,
        grace: GRACE_MS,
      });
      for (const s of rest) send(s.ws, { type: rejoined ? 'peer_back' : 'peer_joined' });
      console.log(
        `[room ${roomId}] ${seat.role} ${rejoined ? 'back' : 'joined'} (${room.seats.size}/${ROOM_CAP})`,
      );
    },
    pong(ws) {
      ws.data.lastSeen = Date.now();
    },
    message(ws, data) {
      ws.data.lastSeen = Date.now();
      const { roomId, peerId, seat } = ws.data;
      const room = rooms.get(roomId);
      if (!room || !seat) return;
      const payload = typeof data === 'string' ? data : new TextDecoder().decode(data);
      // Eat heartbeat pings. Cheap length check first to avoid JSON.parse
      // on every move payload.
      // Answer app-level pings (browsers can't see protocol pings, so this
      // is how a client notices a dead connection). Cheap length check
      // first to avoid JSON.parse on every move payload.
      if (payload.length < 64) {
        try {
          const m = JSON.parse(payload);
          if (m && m.t === 'ping') {
            ws.send('{"type":"pong"}');
            return;
          }
        } catch {
          // non-JSON — just fall through to forward
        }
      }
      for (const s of others(room, peerId)) {
        if (s.ws && s.ws.readyState === 1) s.ws.send(payload);
      }
    },
    close(ws, code) {
      const { roomId, peerId, seat } = ws.data;
      const room = rooms.get(roomId);
      // Rejected, replaced, or already torn down: nothing to do.
      if (!room || !seat || seat.ws !== ws) return;
      seat.ws = null;

      if (code === CLOSE_LEAVE) {
        destroyRoom(room, CLOSE_PEER_GONE, 'peer disconnected');
        return;
      }

      // Refresh, tab close, network drop: hold the seat and let the other
      // side know. If nobody comes back in time the room is torn down.
      seat.awayTimer = setTimeout(() => {
        seat.awayTimer = null;
        destroyRoom(room, CLOSE_PEER_GONE, 'peer disconnected');
      }, GRACE_MS);
      for (const s of others(room, peerId)) send(s.ws, { type: 'peer_away', grace: GRACE_MS });
      console.log(`[room ${roomId}] ${seat.role} away (code ${code})`);
    },
  },
});

// Protocol-level pings: browsers answer them even in throttled background
// tabs, so a live client always resets idleTimeout, and reverse proxies
// (nginx proxy_read_timeout) never see a silent connection.
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const seat of room.seats.values()) {
      const ws = seat.ws;
      if (!ws) continue;
      if (now - ws.data.lastSeen > DEAD_AFTER_MS) {
        // terminate() fires close() right away; a polite close() would wait
        // on a close handshake the dead peer will never answer.
        ws.terminate();
      } else if (ws.readyState === 1) {
        ws.ping();
      }
    }
  }
}, SERVER_PING_INTERVAL_MS);

console.log(`listening on :${server.port}`);
console.log(`allowed origins: ${ALLOWED_ORIGINS.join(', ') || '(none)'}`);
console.log(`seat grace: ${GRACE_MS}ms`);
if (STATIC_DIR) console.log(`serving static files from ${STATIC_DIR}`);
