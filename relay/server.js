// Minimal WebSocket relay for Gomind remote play, plus optional static
// hosting of the built frontend so the whole app runs as ONE process.
//
// One room = one URL path. Server never parses game messages; it just
// fans out every client message to the other peer(s) in the same room.
//
// URL: wss://host/room/<ID>  where ID is exactly 4 digits.
//
// Behavior ("人满为患"):
//   - Max 2 peers per room; 3rd is rejected with close(4002, 'room full').
//   - If ANY peer disconnects, the room is torn down for everyone — the
//     remaining peer(s) get close(4001, 'peer disconnected'), the room
//     map entry is deleted, and the number becomes reusable immediately.
//   - Clients send {t:'ping'} every ~30s as an app-level heartbeat; we
//     eat those here (don't forward) — the read alone resets idleTimeout.
//
// Env:
//   PORT             listen port (default 8000)
//   ALLOWED_ORIGINS  comma-separated Origin allowlist for WS upgrades; '*' = any
//   STATIC_DIR       if set, serve this directory (the Vite build, web/dist)
//                    for every non-room path, with SPA fallback to index.html

import { stat } from 'node:fs/promises';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 8000);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ROOM_CAP = 2;
const STATIC_DIR = process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : null;

// Cross-origin isolation headers expose SharedArrayBuffer, which the
// threaded Rapfi build probes for. Mirrors vite.config.ts; the
// single-threaded build ignores them harmlessly.
const COI_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/** @type {Map<string, Set<any>>} */
const rooms = new Map();

function originAllowed(origin) {
  if (ALLOWED_ORIGINS.length === 1 && ALLOWED_ORIGINS[0] === '*') return true;
  if (!origin) return false;
  return ALLOWED_ORIGINS.some((a) => {
    if (a === origin) return true;
    if (a.includes('*')) {
      const re = new RegExp(
        '^' + a.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*') + '$',
      );
      return re.test(origin);
    }
    return false;
  });
}

function cacheControlFor(pathname) {
  // Vite hashes everything under /assets, so those can be cached forever.
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  // Engine WASM + weights (~40MB) aren't hashed but change rarely.
  if (pathname.startsWith('/rapfi/')) return 'public, max-age=86400';
  // index.html and everything else: always revalidate so deploys show up.
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
  // Resolve against STATIC_DIR and refuse anything that escapes it.
  let abs = path.normalize(path.join(STATIC_DIR, rel));
  if (abs !== STATIC_DIR && !abs.startsWith(STATIC_DIR + path.sep)) return notFound();

  let s = await stat(abs).catch(() => null);
  if (s?.isDirectory()) {
    abs = path.join(abs, 'index.html');
    s = await stat(abs).catch(() => null);
  }
  if (!s?.isFile()) {
    // SPA fallback: client-side routes (/local, /online) get index.html.
    // Paths that look like files (have an extension) are real 404s.
    if (path.extname(rel)) return notFound();
    abs = path.join(STATIC_DIR, 'index.html');
    s = await stat(abs).catch(() => null);
    if (!s?.isFile()) return notFound();
  }
  return new Response(Bun.file(abs), {
    headers: { ...COI_HEADERS, 'Cache-Control': cacheControlFor(pathname) },
  });
}

const ROOM_RE = /^\/room\/(\d{4})$/;

const server = Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  async fetch(req, srv) {
    const url = new URL(req.url);

    if (url.pathname === '/health') {
      return Response.json({ ok: true, rooms: rooms.size });
    }

    const m = url.pathname.match(ROOM_RE);
    if (m) {
      const origin = req.headers.get('origin');
      if (!originAllowed(origin)) {
        return new Response('origin not allowed', { status: 403 });
      }
      const roomId = m[1];
      if (srv.upgrade(req, { data: { roomId } })) return;
      return new Response('upgrade failed', { status: 400 });
    }

    if (STATIC_DIR) return serveStatic(url.pathname);
    return notFound();
  },
  websocket: {
    // Idle sockets (no bytes in either direction) get auto-closed after
    // this many seconds. Clients heartbeat every 30s so active games
    // never trip it; this just reaps zombies from abrupt browser kills.
    idleTimeout: 120,
    open(ws) {
      const { roomId } = ws.data;
      let peers = rooms.get(roomId);
      if (peers && peers.size >= ROOM_CAP) {
        ws.close(4002, 'room full');
        return;
      }
      if (!peers) {
        peers = new Set();
        rooms.set(roomId, peers);
      }
      peers.add(ws);

      ws.send(JSON.stringify({ type: 'welcome', peers: peers.size - 1 }));

      for (const p of peers) {
        if (p !== ws && p.readyState === 1) {
          p.send(JSON.stringify({ type: 'peer_joined' }));
        }
      }

      console.log(`[room ${roomId}] open (${peers.size}/${ROOM_CAP})`);
    },
    message(ws, data) {
      const { roomId } = ws.data;
      const peers = rooms.get(roomId);
      if (!peers) return;
      const payload = typeof data === 'string' ? data : new TextDecoder().decode(data);
      // Eat heartbeat pings. Cheap length check first to avoid JSON.parse
      // on every move payload.
      if (payload.length < 64) {
        try {
          const m = JSON.parse(payload);
          if (m && m.t === 'ping') return;
        } catch {
          // non-JSON — just fall through to forward
        }
      }
      for (const p of peers) {
        if (p !== ws && p.readyState === 1) p.send(payload);
      }
    },
    close(ws) {
      const { roomId } = ws.data;
      const peers = rooms.get(roomId);
      if (!peers) return;
      peers.delete(ws);
      // Kick everyone else: any disconnect ends the match. This frees the
      // 4-digit room number immediately for reuse.
      for (const p of peers) {
        if (p.readyState === 1) p.close(4001, 'peer disconnected');
      }
      rooms.delete(roomId);
      console.log(`[room ${roomId}] closed`);
    },
  },
});

// Server→client heartbeat. Reverse proxies drop WebSockets that stay silent
// in the upstream→client direction (nginx proxy_read_timeout defaults to
// 60s), and a player waiting on the opponent's move receives nothing for as
// long as the opponent thinks. Protocol-level pings are answered by the
// browser automatically, so this also keeps the client→server direction
// alive when a background tab throttles the app-level ping timer.
const SERVER_PING_INTERVAL_MS = 25_000;
setInterval(() => {
  for (const peers of rooms.values()) {
    for (const ws of peers) {
      if (ws.readyState === 1) ws.ping();
    }
  }
}, SERVER_PING_INTERVAL_MS);

console.log(`listening on :${server.port}`);
console.log(`allowed origins: ${ALLOWED_ORIGINS.join(', ') || '(none)'}`);
if (STATIC_DIR) console.log(`serving static files from ${STATIC_DIR}`);
