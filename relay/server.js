// Minimal WebSocket relay for Gomind remote play.
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

const PORT = Number(process.env.PORT ?? 8000);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ROOM_CAP = 2;

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

const ROOM_RE = /^\/room\/(\d{4})$/;

const server = Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  fetch(req, srv) {
    const url = new URL(req.url);

    if (url.pathname === '/health') {
      return Response.json({ ok: true, rooms: rooms.size });
    }

    const m = url.pathname.match(ROOM_RE);
    if (!m) return new Response('not found', { status: 404 });

    const origin = req.headers.get('origin');
    if (!originAllowed(origin)) {
      return new Response('origin not allowed', { status: 403 });
    }

    const roomId = m[1];
    if (srv.upgrade(req, { data: { roomId } })) return;
    return new Response('upgrade failed', { status: 400 });
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

console.log(`relay listening on :${server.port}`);
console.log(`allowed origins: ${ALLOWED_ORIGINS.join(', ') || '(none)'}`);
