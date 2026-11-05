// End-to-end test of the relay's room/seat semantics. Run with:
//   bun test relay/test
import { afterAll, beforeAll, expect, test } from 'bun:test';

const PORT = 18765;
const GRACE_MS = 600;
const BASE = `http://localhost:${PORT}`;
let proc;

beforeAll(async () => {
  proc = Bun.spawn(['bun', 'run', 'relay/server.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      GRACE_MS: String(GRACE_MS),
      CLAIM_MS: '800',
    },
    stdout: 'ignore',
    stderr: 'inherit',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error('relay did not start');
});
afterAll(() => proc?.kill());

const sleep = (ms) => Bun.sleep(ms);

async function createRoom(peer) {
  const r = await fetch(`${BASE}/rooms`, { method: 'POST', body: JSON.stringify({ peer }) });
  expect(r.ok).toBe(true);
  return (await r.json()).id;
}

/** Connect and collect messages/close into arrays for assertions. */
function connect(roomId, peer) {
  const ws = new WebSocket(`ws://localhost:${PORT}/room/${roomId}?peer=${peer}`);
  const c = { ws, msgs: [], closed: null, opened: false };
  ws.onopen = () => {
    c.opened = true;
  };
  ws.onmessage = (e) => c.msgs.push(JSON.parse(e.data));
  ws.onclose = (e) => {
    c.closed = { code: e.code, reason: e.reason };
  };
  return c;
}

async function until(fn, timeout = 2000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > timeout) throw new Error('timeout waiting');
    await sleep(10);
  }
}

test('create allocates a 4-digit room and host gets a welcome', async () => {
  const id = await createRoom('hostpeer0001');
  expect(id).toMatch(/^\d{4}$/);
  const host = connect(id, 'hostpeer0001');
  await until(() => host.msgs.length >= 1);
  expect(host.msgs[0]).toMatchObject({
    type: 'welcome',
    role: 'host',
    peers: 0,
    online: 0,
    rejoined: false,
  });
  host.ws.close(4000, 'leave');
  await until(() => host.closed);
});

test('rejects bad peer ids and unknown rooms', async () => {
  const r = await fetch(`${BASE}/rooms`, { method: 'POST', body: JSON.stringify({ peer: 'x' }) });
  expect(r.status).toBe(400);
  const ghost = connect('0000', 'ghostpeer001');
  await until(() => ghost.closed);
  expect(ghost.closed.code).toBe(4004);
});

test('guest joins, messages relay, third peer is rejected', async () => {
  const id = await createRoom('hostpeer0002');
  const host = connect(id, 'hostpeer0002');
  await until(() => host.msgs.length >= 1);
  const guest = connect(id, 'guestpeer002');
  await until(() => guest.msgs.length >= 1 && host.msgs.length >= 2);
  expect(guest.msgs[0]).toMatchObject({ type: 'welcome', role: 'guest', peers: 1, online: 1 });
  expect(host.msgs[1]).toEqual({ type: 'peer_joined' });

  host.ws.send(JSON.stringify({ t: 'sync', v: 2, ts: 1, history: [] }));
  guest.ws.send(JSON.stringify({ t: 'ping', v: 2, ts: 1 }));
  guest.ws.send(JSON.stringify({ t: 'move', v: 2, ts: 1, x: 7, y: 7, n: 1 }));
  await until(() => guest.msgs.length >= 3 && host.msgs.length >= 3);
  expect(guest.msgs[1]).toMatchObject({ t: 'sync' });
  expect(guest.msgs[2]).toEqual({ type: 'pong' }); // ping answered, not forwarded
  expect(host.msgs[2]).toMatchObject({ t: 'move', x: 7 });
  expect(host.msgs.length).toBe(3);

  const third = connect(id, 'thirdpeer003');
  await until(() => third.closed);
  expect(third.closed.code).toBe(4002);

  guest.ws.close(4000, 'leave');
  await until(() => host.closed);
  expect(host.closed.code).toBe(4001);
  const late = connect(id, 'latepeer0004');
  await until(() => late.closed);
  expect(late.closed.code).toBe(4004); // room number freed
});

test('a dropped seat is held for the grace window and can be reclaimed', async () => {
  const id = await createRoom('hostpeer0003');
  const host = connect(id, 'hostpeer0003');
  await until(() => host.msgs.length >= 1);
  const guest = connect(id, 'guestpeer003');
  await until(() => host.msgs.length >= 2 && guest.msgs.length >= 1);

  // Guest "refreshes": a non-4000 close keeps the seat.
  guest.ws.close(1000);
  await until(() => host.msgs.length >= 3);
  expect(host.msgs[2]).toEqual({ type: 'peer_away', grace: GRACE_MS });

  // Someone else trying the code during the grace window is still refused.
  const intruder = connect(id, 'intruder0003');
  await until(() => intruder.closed);
  expect(intruder.closed.code).toBe(4002);

  const guest2 = connect(id, 'guestpeer003');
  await until(() => guest2.msgs.length >= 1 && host.msgs.length >= 4);
  expect(guest2.msgs[0]).toMatchObject({
    type: 'welcome',
    role: 'guest',
    rejoined: true,
    online: 1,
  });
  expect(host.msgs[3]).toEqual({ type: 'peer_back' });
  expect(host.closed).toBeNull();

  host.ws.close(4000, 'leave');
  await until(() => guest2.closed);
});

test('grace expiry tears the room down for the survivor', async () => {
  const id = await createRoom('hostpeer0004');
  const host = connect(id, 'hostpeer0004');
  await until(() => host.msgs.length >= 1);
  const guest = connect(id, 'guestpeer004');
  await until(() => host.msgs.length >= 2 && guest.msgs.length >= 1);
  guest.ws.close(1001);
  await until(() => host.closed, GRACE_MS + 1500);
  expect(host.closed.code).toBe(4001);
});

test('second connection with the same peer id replaces the first', async () => {
  const id = await createRoom('hostpeer0005');
  const a = connect(id, 'hostpeer0005');
  await until(() => a.msgs.length >= 1);
  const b = connect(id, 'hostpeer0005');
  await until(() => a.closed && b.msgs.length >= 1);
  expect(a.closed.code).toBe(4003);
  expect(b.msgs[0]).toMatchObject({ type: 'welcome', role: 'host', rejoined: true });
  b.ws.close(4000);
  await until(() => b.closed);
});

test('an unclaimed room expires', async () => {
  const id = await createRoom('hostpeer0006');
  await sleep(1000);
  const h = connect(id, 'hostpeer0006');
  await until(() => h.closed);
  expect(h.closed.code).toBe(4004);
});

test('a guest arriving before the host connects is told the host is offline', async () => {
  const id = await createRoom('hostpeer0007');
  const guest = connect(id, 'guestpeer007');
  await until(() => guest.msgs.length >= 1);
  expect(guest.msgs[0]).toMatchObject({ type: 'welcome', role: 'guest', peers: 1, online: 0 });
  const host = connect(id, 'hostpeer0007');
  await until(() => host.msgs.length >= 1 && guest.msgs.length >= 2);
  expect(host.msgs[0]).toMatchObject({ type: 'welcome', role: 'host', peers: 1, online: 1 });
  expect(guest.msgs[1]).toEqual({ type: 'peer_joined' });
  host.ws.close(4000);
  await until(() => guest.closed);
});

test('a silently dead socket is reaped and its seat enters the grace window', async () => {
  // Spin a second relay with a short dead-peer threshold, and put a TCP
  // proxy in front of it that can freeze the guest's connection.
  const port = PORT + 1;
  const relay = Bun.spawn(['bun', 'run', 'relay/server.js'], {
    env: { ...process.env, PORT: String(port), GRACE_MS: '5000', DEAD_AFTER_MS: '2000' },
    stdout: 'ignore',
    stderr: 'inherit',
  });
  try {
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`http://localhost:${port}/health`)).ok) break;
      } catch {}
      await sleep(100);
    }
    let frozen = false;
    const proxy = Bun.listen({
      hostname: '127.0.0.1',
      port: 0,
      socket: {
        async open(client) {
          client.data = { buf: [] };
          client.data.up = await Bun.connect({
            hostname: '127.0.0.1',
            port,
            socket: {
              data(_u, d) {
                if (!frozen) client.write(d);
              },
              close() {},
              error() {},
            },
          });
          for (const d of client.data.buf) client.data.up.write(d);
        },
        data(client, d) {
          if (frozen) return;
          if (client.data.up) client.data.up.write(d);
          else client.data.buf.push(d);
        },
        close() {},
        error() {},
      },
    });
    const r = await fetch(`http://localhost:${port}/rooms`, {
      method: 'POST',
      body: JSON.stringify({ peer: 'hostpeer0008' }),
    });
    const { id } = await r.json();
    const host = new WebSocket(`ws://localhost:${port}/room/${id}?peer=hostpeer0008`);
    const hostMsgs = [];
    host.onmessage = (e) => hostMsgs.push(JSON.parse(e.data));
    await until(() => hostMsgs.length >= 1);
    const guest = new WebSocket(`ws://127.0.0.1:${proxy.port}/room/${id}?peer=guestpeer008`);
    await until(() => hostMsgs.length >= 2);
    expect(hostMsgs[1]).toEqual({ type: 'peer_joined' });

    frozen = true;
    const t0 = Date.now();
    await until(() => hostMsgs.length >= 3, 10_000);
    expect(hostMsgs[2]).toMatchObject({ type: 'peer_away' });
    const took = Date.now() - t0;
    expect(took).toBeGreaterThan(1500);
    expect(took).toBeLessThan(9000);
    guest.onclose = null;
    host.close(4000);
    proxy.stop(true);
  } finally {
    relay.kill();
  }
}, 20_000);

test('POST /rooms answers CORS preflight for allowed origins', async () => {
  const pre = await fetch(`${BASE}/rooms`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://app.example.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  expect(pre.status).toBe(204);
  expect(pre.headers.get('access-control-allow-origin')).toBe('*');
  expect(pre.headers.get('access-control-allow-headers')).toContain('Content-Type');
  const r = await fetch(`${BASE}/rooms`, {
    method: 'POST',
    headers: { Origin: 'https://app.example.com', 'Content-Type': 'application/json' },
    body: JSON.stringify({ peer: 'corspeer0001' }),
  });
  expect(r.status).toBe(200);
  expect(r.headers.get('access-control-allow-origin')).toBe('*');
});

test('CORS respects an ALLOWED_ORIGINS allowlist', async () => {
  const port = PORT + 2;
  const relay = Bun.spawn(['bun', 'run', 'relay/server.js'], {
    env: { ...process.env, PORT: String(port), ALLOWED_ORIGINS: 'https://a.example.com' },
    stdout: 'ignore',
    stderr: 'inherit',
  });
  try {
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`http://localhost:${port}/health`)).ok) break;
      } catch {}
      await sleep(100);
    }
    const preflight = (origin) =>
      fetch(`http://localhost:${port}/rooms`, {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
      });
    const ok = await preflight('https://a.example.com');
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://a.example.com');
    expect(ok.headers.get('vary')).toBe('Origin');
    const bad = await preflight('https://b.example.com');
    expect(bad.status).toBe(403);
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  } finally {
    relay.kill();
  }
});
