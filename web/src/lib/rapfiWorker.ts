/// <reference lib="webworker" />
//
// Rapfi engine worker: wraps the Rapfi Gomoku engine (C++ → WASM) and
// translates our request/response protocol into Piskvork stdin commands +
// stdout parsing.
//
// Classic worker (no ES modules) because Emscripten's generated Rapfi JS
// registers itself via IIFE on the global scope — dynamic ES import in a
// module worker doesn't pick it up. `importScripts` handles it.
//
// Input protocol: { id, cmd: 'init' | 'bestMove' | 'topCandidates' |
// 'evaluate' | 'benchmark', ...payload }.

import { RAPFI_ASSETS } from '@/lib/rapfiAssets';

interface RapfiOpts {
  locateFile: (url: string) => string;
  onReceiveStdout: (line: string) => void;
  onReceiveStderr: (line: string) => void;
  onExit: (code: number) => void;
  setStatus: (s: string) => void;
  // Emscripten's file packager calls this before fetching the data package;
  // returning the bytes skips its own download (we fetch with progress and
  // a persistent cache instead).
  getPreloadedPackage?: (name: string, size: number) => ArrayBuffer;
  wasmMemory?: WebAssembly.Memory;
  // Absolute URL (or Blob) of the Rapfi glue script. Emscripten's pthread
  // build spawns worker threads via `new Worker(_scriptName, ...)`, where
  // `_scriptName` is `document.currentScript?.src`. In a Web Worker there
  // is no `document`, so `_scriptName` is `undefined` and the pthread
  // spawn throws silently — init then hangs forever. Passing this option
  // is the documented fix.
  mainScriptUrlOrBlob?: string | Blob;
}

interface RapfiInstance {
  sendCommand: (cmd: string) => void;
  terminate?: () => void;
}

type RapfiFactory = (opts: RapfiOpts) => Promise<RapfiInstance>;

// Bag of globals we poke on the worker scope. Using a bag avoids redeclaring
// the built-in `self` which DOM lib already types.
const workerGlobal = self as unknown as {
  Rapfi?: RapfiFactory;
  importScripts: (url: string) => void;
  navigator: { hardwareConcurrency?: number };
  postMessage: (data: unknown) => void;
};

type Req =
  | { id: number; cmd: 'init' }
  | {
      id: number;
      cmd: 'bestMove';
      moves: [number, number][];
      maxDepth: number;
      timeMs: number;
    }
  | {
      id: number;
      cmd: 'topCandidates';
      moves: [number, number][];
      n: number;
      depth: number;
      timeMs: number;
    }
  | { id: number; cmd: 'evaluate'; moves: [number, number][] }
  | {
      id: number;
      cmd: 'benchmark';
      moves: [number, number][];
      maxDepth: number;
      timeMs: number;
    };

type Res = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

let rapfi: RapfiInstance | null = null;
let threadCount = 1;

// At most one in-flight engine search at a time. Everything else queues.
interface Pending {
  id: number;
  kind: 'bestMove' | 'topCandidates';
  wantN: number;
  startTime: number;
  depth: number;
  scoreFromEval: number;
  nodes: number;
  // Accumulated candidates. For bestMove this ends up with just the one
  // final move. For topCandidates we seed from PV progress lines during
  // the search (see recordCandidate in onStdout) — typically 1-3 unique
  // distinct first-PV moves across iterative-deepening layers. The final
  // x,y answer is always promoted to index 0 in finalizePending.
  candidates: { x: number; y: number; score: number }[];
  // Set by preempt() when a newer request arrives. The search will still
  // finish (quickly, thanks to YXSTOP) and emit an x,y; finalizePending
  // posts an 'aborted' error instead of the result so the stale main-
  // thread promise can be rejected cleanly and the next queued request
  // can run.
  aborted: boolean;
}

let pending: Pending | null = null;
const queue: Req[] = [];
let processing = false;

function post(res: Res) {
  workerGlobal.postMessage(res);
}

function sendCmd(cmd: string) {
  if (!rapfi) {
    console.warn('[rapfi] sendCmd before init:', cmd);
    return;
  }
  console.log(`[rapfi] → ${cmd.replace(/\n/g, ' | ')}`);
  rapfi.sendCommand(cmd);
}

/**
 * Send the full move history to Rapfi using the Piskvork BOARD command.
 *
 * Piskvork convention: each move is labeled `1` if it belongs to the engine
 * and `2` if it belongs to the opponent. "Engine" = the side to move next.
 * So: if history.length is even → black moves next → black is engine (1);
 * else white moves next → white is engine (1).
 *
 * BOARD + all coords + DONE must be a SINGLE sendCommand call. Each
 * sendCommand drives one gomocupLoopOnce() iteration in Emscripten;
 * splitting across calls leaves the BOARD parser facing empty stdin and
 * it exits on EOF with an empty stone list.
 *
 * For empty history we also use BOARD (with no coords) rather than BEGIN,
 * since BEGIN leaves residual state that subsequent BOARDs don't fully
 * clear in a reused engine instance.
 */
function sendBoard(history: [number, number][]) {
  const N = history.length;
  if (N === 0) {
    sendCmd('BOARD\nDONE');
    return;
  }
  const lines = ['BOARD'];
  for (let i = 0; i < N; i++) {
    const [x, y] = history[i];
    const label = i % 2 === N % 2 ? 1 : 2;
    lines.push(`${x},${y},${label}`);
  }
  lines.push('DONE');
  sendCmd(lines.join('\n'));
}

function finalizePending() {
  if (!pending) return;
  const p = pending;
  pending = null;
  const base = {
    time_ms: Date.now() - p.startTime,
    nodes: p.nodes,
    timed_out: false,
    completed_depth: p.depth,
  };
  console.log(
    `[rapfi] resolve kind=${p.kind} id=${p.id} cands=${p.candidates.length} depth=${p.depth} nodes=${p.nodes} time=${base.time_ms}ms${p.aborted ? ' [ABORTED]' : ''}`,
  );
  if (p.aborted) {
    post({ id: p.id, ok: false, error: 'aborted' });
  } else if (p.kind === 'bestMove') {
    const best = p.candidates[0] ?? { x: 7, y: 7, score: p.scoreFromEval };
    post({
      id: p.id,
      ok: true,
      result: { x: best.x, y: best.y, score: best.score, ...base },
    });
  } else {
    const cands = p.candidates.slice(0, p.wantN);
    post({
      id: p.id,
      ok: true,
      result: {
        candidates: cands,
        processed: cands.length,
        total: p.candidates.length,
        ...base,
      },
    });
  }
  processing = false;
  processNext();
}

function recordCandidate(x: number, y: number, score: number) {
  if (!pending) return;
  const idx = pending.candidates.findIndex((c) => c.x === x && c.y === y);
  if (idx < 0) {
    pending.candidates.push({ x, y, score });
  } else if (pending.candidates[idx].score === 0 && score !== 0) {
    // Backfill a better score if we initially recorded this candidate
    // from a PV line before we had the summary eval.
    pending.candidates[idx].score = score;
  }
}

function onStdout(raw: string) {
  const line = raw.trim();
  if (!line) return;
  console.log(`[rapfi] ← ${line}`);
  if (!pending) {
    // Rapfi chatters during startup (load config, set evaluator, OK from
    // START) before any query is in flight. That's expected — don't warn.
    return;
  }

  // A bare "x,y" is the engine's final answer for this search. For both
  // bestMove and topCandidates we resolve immediately — the candidates
  // list has already been populated from PV progress lines during the
  // search. Promote the final answer to the front so index 0 is always
  // the true best (PV-seeding ordering is by iteration, not by final
  // strength, so the engine may have changed its mind mid-search).
  if (/^\d+,\d+$/.test(line)) {
    const [x, y] = line.split(',').map(Number);
    const idx = pending.candidates.findIndex((c) => c.x === x && c.y === y);
    if (idx >= 0) pending.candidates.splice(idx, 1);
    pending.candidates.unshift({ x, y, score: pending.scoreFromEval });
    finalizePending();
    return;
  }

  // Rapfi emits MESSAGE-prefixed progress lines. We parse two formats:
  //
  //   MESSAGE Depth X-Y | Eval Z | Time T(ms|s) | PV...
  //   MESSAGE Speed N | Depth X-Y | Eval E | Node Nk | Time T(ms|s)
  //
  // Time comes in `123ms` for short searches and `12s` once searches get
  // long (we don't actually use the value — nodes+walltime in resolve do
  // that — but the regex still has to accept both so the rest of the
  // summary (nodes, depth) is captured).
  //
  // Evals may be "123" or "+M39" (forced mate); we only take the numeric
  // form — mates are terminal-level scores and our UI treats them as ±∞.
  if (line.startsWith('MESSAGE ')) {
    const msg = line.substring(8);

    const sum = msg.match(
      /Speed (\d+) \| Depth (\d+)-\d+ \| Eval ([+-]?(?:M\d+|\d+)) \| Node ([\d.]+)([kKmMgG]?) \| Time \d+(?:ms|s)/,
    );
    if (sum) {
      pending.depth = Number.parseInt(sum[2], 10);
      const evalStr = sum[3];
      if (/^[+-]?\d+$/.test(evalStr)) {
        pending.scoreFromEval = Number.parseInt(evalStr, 10);
      } else if (evalStr.startsWith('-M')) {
        pending.scoreFromEval = -1_000_000; // terminal loss
      } else if (evalStr.startsWith('+M') || evalStr.startsWith('M')) {
        pending.scoreFromEval = 1_000_000; // terminal win
      }
      const unit = sum[5].toLowerCase();
      const mult = unit === 'g' ? 1e9 : unit === 'm' ? 1e6 : unit === 'k' ? 1e3 : 1;
      pending.nodes = Math.round(Number.parseFloat(sum[4]) * mult);
      return;
    }

    const depth = msg.match(
      /^Depth (\d+)-\d+ \| Eval ([+-]?(?:M\d+|\d+)) \| Time \d+(?:ms|s) \| (.+)/,
    );
    if (depth) {
      pending.depth = Number.parseInt(depth[1], 10);
      const evalStr = depth[2];
      if (/^[+-]?\d+$/.test(evalStr)) {
        pending.scoreFromEval = Number.parseInt(evalStr, 10);
      }
      // Seed candidates from each iteration's first PV move. Typically
      // the same move dominates across depths so this yields 1-3 unique
      // entries for the analysis panel — zero extra search cost.
      if (pending.kind === 'topCandidates') {
        const firstPv = depth[3].trim().split(/\s+/)[0];
        const coord = parseAlgebraic(firstPv);
        if (coord) recordCandidate(coord.x, coord.y, pending.scoreFromEval);
      }
      return;
    }
  }
}

/**
 * Rapfi prints PV moves in algebraic notation: column letter A-O (with I
 * skipped in some gomoku conventions but Rapfi uses straight A-O), row
 * number 1-15. Board is 15x15 so columns A..O map to x=0..14; row 1 is the
 * bottom, row 15 the top in Rapfi's orientation — but the returned x,y
 * from BOARD protocol is already in our 0-indexed coords, so here we just
 * need to handle the algebraic → x,y mapping consistently.
 *
 * Empirically: Rapfi returns the SAME coord in two notations — "H8" and
 * "7,7" both refer to center. So column A=0 (x=0), row 1 = y=0, row 15 =
 * y=14. (Actually testing shows "H8" = x=7 y=7, so row 1 = y=0.)
 */
function parseAlgebraic(s: string): { x: number; y: number } | null {
  const m = s.match(/^([A-Oa-o])(\d+)$/);
  if (!m) return null;
  const col = m[1].toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
  const row = Number.parseInt(m[2], 10) - 1;
  if (col < 0 || col >= 15 || row < 0 || row >= 15) return null;
  return { x: col, y: row };
}

// Cache Storage keeps the ~10 MB data package across visits, independent of
// the HTTP cache (which evicts large entries readily on mobile). The file
// name carries a content hash, so a new package is a new key.
const DATA_CACHE = 'gomind-rapfi';
const PROGRESS_INTERVAL_MS = 100;

function postProgress(loaded: number, total: number) {
  workerGlobal.postMessage({ type: 'progress', loaded, total });
}

async function openDataCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null; // insecure context
  try {
    return await caches.open(DATA_CACHE);
  } catch {
    return null; // e.g. storage disabled
  }
}

async function loadDataPackage(url: string, size: number): Promise<ArrayBuffer> {
  const cache = await openDataCache();
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) {
        const buf = await hit.arrayBuffer();
        if (buf.byteLength === size) {
          postProgress(size, size);
          return buf;
        }
      }
    } catch {
      // Fall through to the network.
    }
  }

  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`engine data: HTTP ${res.status}`);
  const out = new Uint8Array(size);
  const reader = res.body.getReader();
  let loaded = 0;
  let lastPost = 0;
  postProgress(0, size);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.byteLength > size) throw new Error('engine data larger than expected');
    out.set(value, loaded);
    loaded += value.byteLength;
    const now = performance.now();
    if (now - lastPost >= PROGRESS_INTERVAL_MS) {
      lastPost = now;
      postProgress(loaded, size);
    }
  }
  if (loaded !== size) throw new Error(`engine data truncated (${loaded}/${size} bytes)`);
  postProgress(size, size);

  if (cache) {
    // Response() copies the bytes, so `out` stays ours. Drop older packages.
    cache
      .put(url, new Response(out, { headers: { 'Content-Type': 'application/octet-stream' } }))
      .then(async () => {
        for (const req of await cache.keys()) if (req.url !== url) await cache.delete(req);
      })
      .catch(() => {});
  }
  return out.buffer;
}

async function initRapfi(): Promise<{ size: number; threads: number }> {
  // Threaded variant needs SharedArrayBuffer (requires COOP/COEP headers).
  const hasThreads =
    typeof SharedArrayBuffer !== 'undefined' && typeof WebAssembly.Memory === 'function';
  const scriptName = hasThreads ? RAPFI_ASSETS.multi : RAPFI_ASSETS.single;
  const engineDir = '/rapfi/';
  // Absolute URL is required for pthread spawning — `new Worker(url)` inside
  // a Worker resolves relative paths against the worker's own script URL,
  // not the page, which lands in the wrong place.
  const scriptUrl = new URL(`${engineDir}${scriptName}`, self.location.href).href;
  const dataUrl = new URL(`${engineDir}${RAPFI_ASSETS.data}`, self.location.href).href;

  // Start the big download first; the loader script is small.
  const dataPromise = loadDataPackage(dataUrl, RAPFI_ASSETS.dataSize);
  workerGlobal.importScripts(scriptUrl);
  const data = await dataPromise;

  const opts: RapfiOpts = {
    // The loaders ask for "rapfi-<variant>.data"; both share one package.
    locateFile: (u: string) => engineDir + (u.endsWith('.data') ? RAPFI_ASSETS.data : u),
    getPreloadedPackage: () => data,
    onReceiveStdout: onStdout,
    onReceiveStderr: (o) => console.error('[rapfi.err]', o),
    onExit: (c) => console.log('[rapfi.exit]', c),
    setStatus: () => {},
  };

  if (hasThreads) {
    // Tell Emscripten where to find its own script so pthread workers can
    // re-execute it. Without this, `new Worker(undefined)` throws and init
    // hangs. See the comment on RapfiOpts.mainScriptUrlOrBlob.
    opts.mainScriptUrlOrBlob = scriptUrl;
    // TODO: pthread spawn hangs silently in some environments (confirmed in
    // Node 25 via worker_threads; symptom in browser is a bestMove request
    // that never returns). Keep single-threaded for now — the multi-simd128
    // WASM still gives us SIMD NNUE eval (10-20× speedup over the scalar
    // build), which is where most of the perf win is. Multi-threading is a
    // further 2-4× but not worth a hang. Re-enable after we diagnose why
    // Emscripten's pthread spawn silently fails here.
    threadCount = 1;
  }

  console.log(`[rapfi] init: script=${scriptUrl} threads=${threadCount} hasThreads=${hasThreads}`);

  const factory = workerGlobal.Rapfi;
  if (!factory) throw new Error('Rapfi global not found after importScripts');
  rapfi = await factory(opts);

  // Standard init sequence (Piskvork). We skip ABOUT (cosmetic noise) and
  // Yixin extensions (which cause double-searches in persistent instances).
  sendCmd('START 15');
  sendCmd('INFO rule 0'); // 0 = freestyle Gomoku
  sendCmd(`INFO thread_num ${threadCount}`);
  sendCmd('INFO hash_size 128'); // 128 MB TT
  sendCmd('INFO timeout_match 0');
  sendCmd('INFO max_node 0');

  return { size: 15, threads: threadCount };
}

function handleSearch(req: Req & { cmd: 'bestMove' | 'topCandidates' }) {
  const kind = req.cmd;
  const moves = req.moves ?? [];
  const maxDepth = kind === 'bestMove' ? req.maxDepth : req.depth;
  const timeMs = req.timeMs;
  const wantN = kind === 'topCandidates' ? Math.max(1, req.n ?? 5) : 1;

  console.log(
    `[rapfi] handleSearch kind=${kind} moves=${moves.length} depth=${maxDepth} time=${timeMs}ms wantN=${wantN}`,
  );

  pending = {
    id: req.id,
    kind,
    wantN,
    startTime: Date.now(),
    depth: 0,
    scoreFromEval: 0,
    nodes: 0,
    candidates: [],
    aborted: false,
  };

  // Search config. maxDepth 0 = Rapfi interprets as "depth 0 = no search,
  // static eval only" — NOT unlimited. Use a big number for "effectively
  // unlimited" when caller passes 0.
  const effDepth = maxDepth > 0 ? maxDepth : 30;
  sendCmd(`INFO max_depth ${effDepth}`);
  sendCmd(`INFO timeout_turn ${timeMs > 0 ? timeMs : 3_600_000}`);

  // Candidate generation strategy — intentionally NOT using YXNBEST.
  //
  // YXNBEST N forces multi-PV search: Rapfi explores the top N root moves
  // roughly evenly instead of aggressively pruning around the single best.
  // That's 2-3× slower AND empirically leaves the engine's BOARD parser in
  // a desynced state on the *following* query (first BOARD after a
  // YXNBEST-search works, next one reports "Unknown command" on coord
  // lines). Not worth the pain for an analysis panel.
  //
  // Instead we let the engine run a normal single-PV search and harvest
  // candidates from the "MESSAGE Depth X-Y | ... | PV ..." progress lines
  // in onStdout (see recordCandidate). Each iterative-deepening layer
  // emits its first PV move; we dedupe and collect whatever distinct
  // moves appear across depths. Typically yields 1-3 candidates — enough
  // for the analysis UI, at zero extra search cost.
  //
  // `wantN` is still honoured as a display cap in finalizePending.

  sendBoard(moves);
  // Resolution happens asynchronously in onStdout when engine outputs "x,y".
}

function processNext() {
  if (processing || queue.length === 0) return;
  const req = queue.shift()!;
  processing = true;

  try {
    if (req.cmd === 'init') {
      initRapfi()
        .then((info) => {
          post({ id: req.id, ok: true, result: info });
          processing = false;
          processNext();
        })
        .catch((err) => {
          post({ id: req.id, ok: false, error: String(err) });
          processing = false;
          processNext();
        });
      return;
    }

    if (!rapfi) {
      post({ id: req.id, ok: false, error: 'rapfi not initialised' });
      processing = false;
      processNext();
      return;
    }

    if (req.cmd === 'bestMove' || req.cmd === 'topCandidates') {
      handleSearch(req);
      return;
    }

    if (req.cmd === 'evaluate') {
      post({ id: req.id, ok: true, result: 0 });
      processing = false;
      processNext();
      return;
    }

    if (req.cmd === 'benchmark') {
      post({ id: req.id, ok: true, result: [] });
      processing = false;
      processNext();
      return;
    }

    post({ id: (req as { id: number }).id, ok: false, error: 'unknown cmd' });
    processing = false;
    processNext();
  } catch (err) {
    post({ id: req.id, ok: false, error: String(err) });
    processing = false;
    processNext();
  }
}

/**
 * Called when a new search request arrives while one is already in flight.
 * Fires YXSTOP to tell Rapfi to stop iterative deepening early — the engine
 * will flush out the current best move as "x,y" within a few ms. That x,y
 * triggers finalizePending, which posts an 'aborted' error (because we
 * set `aborted=true` below) instead of the result, and then drains the
 * queue, running the superseding request next.
 *
 * Without this, a user playing moves during a long analysis or dragging
 * the depth slider would see the UI freeze for each queued request's full
 * search time (seconds) — the stale results just piled up.
 */
function preemptPending(reason: string) {
  if (!pending || pending.aborted) return;
  console.log(`[rapfi] preempt pending id=${pending.id} (${reason})`);
  pending.aborted = true;
  sendCmd('YXSTOP');
  // Safety net: some Rapfi build paths ignore YXSTOP when the search is
  // stuck in a deep tactical VCF. If no x,y arrives within 500ms, give up
  // and finalize anyway so the next request isn't blocked forever.
  setTimeout(() => {
    if (pending?.aborted) {
      console.warn('[rapfi] YXSTOP timeout, force-finalizing');
      finalizePending();
    }
  }, 500);
}

self.onmessage = (ev: MessageEvent<Req>) => {
  const req = ev.data;
  console.log(`[rapfi] onmessage id=${req.id} cmd=${req.cmd}`);

  // Searches preempt each other: a new request always wins. We also drop
  // any already-queued searches — by definition they're older than this
  // new one and would each require its own round of preemption on top of
  // the one we're about to fire. Non-search cmds (init/evaluate/benchmark)
  // still just queue.
  const isSearch = req.cmd === 'bestMove' || req.cmd === 'topCandidates';
  if (isSearch) {
    for (let i = queue.length - 1; i >= 0; i--) {
      const q = queue[i];
      if (q.cmd === 'bestMove' || q.cmd === 'topCandidates') {
        console.log(`[rapfi] drop queued stale search id=${q.id} cmd=${q.cmd}`);
        post({ id: q.id, ok: false, error: 'aborted' });
        queue.splice(i, 1);
      }
    }
    if (pending && !pending.aborted) {
      preemptPending(`superseded by id=${req.id}`);
    }
  }

  queue.push(req);
  processNext();
};
