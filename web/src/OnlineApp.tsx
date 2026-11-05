import { Board } from '@/components/Board';
import { OnlineGate } from '@/components/OnlineGate';
import { OnlineActions } from '@/components/online/OnlineActions';
import { type NoticeSpec, OnlineNotice } from '@/components/online/OnlineNotice';
import { PlayerBar, type Presence } from '@/components/online/PlayerBar';
import {
  clockFromSnapshot,
  clockView,
  describeResult,
  describeTimeControl,
  newClock,
  snapshotClock,
  undoTarget,
} from '@/game/online';
import {
  type PeerMsg,
  type RequestKind,
  type TimeControl,
  isValidRoomId,
} from '@/game/peer-protocol';
import type { Stone } from '@/game/types';
import { gameFromHistory } from '@/hooks/useGame';
import { type MatchState, syncFromState, useOnlineMatch } from '@/hooks/useOnlineMatch';
import { type RoomEvent, type RoomRole, useRemoteRoom } from '@/hooks/useRemoteRoom';
import {
  type SavedSession,
  clearSession,
  loadSession,
  saveCreatePrefs,
  saveSession,
} from '@/lib/onlineStorage';
import { useCallback, useEffect, useRef, useState } from 'react';

const other = (s: Stone): Stone => (s === 1 ? 2 : 1);
const sideOf = (role: RoomRole | null, hostSide: Stone): Stone =>
  role === null ? 0 : role === 'host' ? hostSide : other(hostSide);

// The waiting side only claims the opponent's timeout this far past zero,
// leaving room for a last-second move that's still in flight. The flagged
// side's own client claims at zero.
const FLAG_LATENCY_ALLOWANCE_MS = 1500;
const FLASH_MS = 3500;

const REQ_NAME: Record<RequestKind, string> = { undo: '悔棋', draw: '和棋', reset: '重开' };

function roomFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const r = new URLSearchParams(window.location.search).get('room');
  return r && isValidRoomId(r) ? r : null;
}

function setUrlRoom(id: string | null) {
  const url = id ? `/online?room=${id}` : '/online';
  if (window.location.pathname + window.location.search !== url) {
    window.history.replaceState(null, '', url);
  }
}

function restoredMatch(s: SavedSession, now: number): Omit<MatchState, 'pending'> {
  const game = gameFromHistory(s.history);
  const clock = s.started
    ? clockFromSnapshot(s.timeControl, s.clocks, s.result ? 0 : game.toMove, now)
    : newClock(s.timeControl);
  return {
    hostSide: s.hostSide,
    timeControl: s.timeControl,
    started: s.started,
    game,
    clock: s.result ? { ...clock, active: 0, turnStartedAt: null, pausedAt: null } : clock,
    result: s.result,
  };
}

type Flash = { text: string; tone: NoticeSpec['tone'] };

export function OnlineApp() {
  const { state: match, stateRef, apply } = useOnlineMatch();

  // Role is known from the relay's welcome; before that (right after a
  // refresh) we trust the saved session so the board renders immediately.
  const [savedRole, setSavedRole] = useState<RoomRole | null>(null);
  const roleRef = useRef<RoomRole | null>(null);
  // We pressed 离开 (or the room closed under us): keep the board on screen.
  const [left, setLeft] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFlash = useCallback((text: string, tone: Flash['tone'] = 'info') => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash({ text, tone });
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
  }, []);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  // Handlers below are attached once; they read live values through refs.
  const sendRef = useRef<(m: Parameters<typeof room.send>[0]) => void>(() => {});
  const mySide = () => sideOf(roleRef.current, stateRef.current.hostSide);
  const sendSync = () => sendRef.current(syncFromState(stateRef.current, Date.now()));

  const onEvent = (ev: RoomEvent) => {
    const now = Date.now();
    const s = stateRef.current;
    switch (ev.type) {
      case 'welcome': {
        roleRef.current = ev.role;
        setSavedRole(ev.role);
        // Host arriving after the guest (or first connect with a guest
        // already seated): start the game and hand it over.
        if (ev.role === 'host' && ev.online > 0 && !s.started) {
          apply({ type: 'start', now });
          sendSync();
          showFlash(`对局开始，你执${mySide() === 1 ? '黑先行' : '白后行'}`, 'success');
        }
        // Otherwise wait: whoever was already here sends us a sync.
        return;
      }
      case 'peer_joined':
      case 'peer_back': {
        if (roleRef.current === 'host' && !s.started) {
          apply({ type: 'start', now });
          sendSync();
          showFlash(`对局开始，你执${mySide() === 1 ? '黑先行' : '白后行'}`, 'success');
        } else if (s.started) {
          // We stayed; we're the source of truth. Resume clocks, then send
          // everything so the returning side's board matches ours exactly.
          apply({ type: 'resume', now });
          sendSync();
          if (ev.type === 'peer_back') showFlash('对方已重新连接', 'success');
        }
        return;
      }
      case 'peer_away':
        apply({ type: 'pause', now });
        apply({ type: 'pendingClear' });
        return;
      case 'ended':
        if (s.started && !s.result)
          apply({ type: 'finish', result: { kind: 'abandon', winner: 0 } });
        clearSession();
        return;
    }
  };

  const onMessage = (msg: PeerMsg) => {
    const now = Date.now();
    const s = stateRef.current;
    const me = mySide();
    switch (msg.t) {
      case 'sync': {
        const wasStarted = s.started;
        apply({ type: 'adoptSync', msg, now });
        if (!wasStarted) {
          const side = sideOf(roleRef.current, msg.hostSide);
          showFlash(`对局开始，你执${side === 1 ? '黑先行' : '白后行'}`, 'success');
        }
        return;
      }
      case 'sync_req':
        if (s.started) sendSync();
        return;
      case 'move': {
        if (s.result) return;
        const len = s.game.history.length;
        if (s.started && msg.n === len + 1 && s.game.toMove === other(me)) {
          apply({ type: 'move', x: msg.x, y: msg.y, now, reportedClock: msg.clock });
          return;
        }
        const prev = s.game.history[msg.n - 1];
        if (prev && prev[0] === msg.x && prev[1] === msg.y) return; // duplicate
        console.warn('[online] move out of sequence; resyncing', { got: msg.n, have: len });
        sendRef.current({ t: 'sync_req' });
        return;
      }
      case 'resign':
      case 'flag': {
        if (s.result) return;
        if (s.game.history.length > msg.n) apply({ type: 'undoTo', to: msg.n, now });
        const winner = msg.t === 'resign' ? me : other(msg.side);
        apply({
          type: 'finish',
          result: { kind: msg.t === 'resign' ? 'resign' : 'timeout', winner },
        });
        return;
      }
      case 'undo_req':
      case 'draw_req':
      case 'reset_req': {
        const kind: RequestKind =
          msg.t === 'undo_req' ? 'undo' : msg.t === 'draw_req' ? 'draw' : 'reset';
        const p = s.pending;
        if (p && p.dir === 'out') {
          // Both asked at once. Same draw/reset wish = agreement; else decline theirs.
          if (p.kind === kind && kind !== 'undo') {
            acceptRequest({ kind, dir: 'in', timeControl: s.timeControl });
          } else {
            declineRequest(kind, msg.t === 'undo_req' ? msg.to : undefined);
          }
          return;
        }
        apply({
          type: 'pendingSet',
          pending: {
            kind,
            dir: 'in',
            to: msg.t === 'undo_req' ? msg.to : undefined,
            timeControl: msg.t === 'reset_req' ? msg.timeControl : undefined,
          },
        });
        return;
      }
      case 'undo_ack':
      case 'draw_ack':
      case 'reset_ack': {
        const kind: RequestKind =
          msg.t === 'undo_ack' ? 'undo' : msg.t === 'draw_ack' ? 'draw' : 'reset';
        if (msg.ok) {
          if (msg.t === 'undo_ack') apply({ type: 'undoTo', to: msg.to, now });
          else if (msg.t === 'reset_ack')
            apply({ type: 'newGame', timeControl: msg.timeControl, now });
          else apply({ type: 'finish', result: { kind: 'draw', winner: 0 } });
          showFlash(
            kind === 'draw' ? '对方同意和棋' : `对方同意${REQ_NAME[kind]}`,
            kind === 'reset' ? 'success' : 'info',
          );
        } else {
          if (s.pending?.dir === 'out' && s.pending.kind === kind) apply({ type: 'pendingClear' });
          showFlash(`对方拒绝了${REQ_NAME[kind]}请求`, 'muted');
        }
        return;
      }
      case 'req_cancel':
        if (s.pending?.dir === 'in' && s.pending.kind === msg.kind) {
          apply({ type: 'pendingClear' });
          showFlash(`对方撤回了${REQ_NAME[msg.kind]}请求`, 'muted');
        }
        return;
      case 'ping':
        return;
    }
  };

  const room = useRemoteRoom({ onMessage, onEvent });
  sendRef.current = room.send;

  // ------------------------------------------------------------ requests

  function acceptRequest(p: NonNullable<MatchState['pending']>) {
    const now = Date.now();
    const s = stateRef.current;
    if (p.kind === 'undo') {
      const to = p.to ?? s.game.history.length;
      sendRef.current({ t: 'undo_ack', ok: true, to });
      apply({ type: 'undoTo', to, now });
    } else if (p.kind === 'draw') {
      sendRef.current({ t: 'draw_ack', ok: true });
      apply({ type: 'finish', result: { kind: 'draw', winner: 0 } });
    } else {
      const tc = p.timeControl ?? s.timeControl;
      sendRef.current({ t: 'reset_ack', ok: true, timeControl: tc });
      apply({ type: 'newGame', timeControl: tc, now });
    }
  }

  function declineRequest(kind: RequestKind, to?: number) {
    const s = stateRef.current;
    if (kind === 'undo') sendRef.current({ t: 'undo_ack', ok: false, to: to ?? 0 });
    else if (kind === 'draw') sendRef.current({ t: 'draw_ack', ok: false });
    else sendRef.current({ t: 'reset_ack', ok: false, timeControl: s.timeControl });
  }

  /** Our move declines anything they asked and withdraws anything we asked. */
  function settlePendingBeforeMove() {
    const p = stateRef.current.pending;
    if (!p) return;
    if (p.dir === 'in') declineRequest(p.kind, p.to);
    else room.send({ t: 'req_cancel', kind: p.kind });
    apply({ type: 'pendingClear' });
  }

  // ------------------------------------------------------------ lifecycle

  // Mount: rejoin the room this tab was in (refresh), or follow ?room=.
  const bootedRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    const urlRoom = roomFromUrl();
    const saved = loadSession();
    // A saved session only survives an abrupt exit (reload, tab closed,
    // crash): in-app navigation clears it. So if there is one, resume it,
    // whether we came back by reload, the invite link, or the home page.
    if (saved && (!urlRoom || urlRoom === saved.roomId)) {
      apply({ type: 'restore', state: restoredMatch(saved, Date.now()), now: Date.now() });
      roleRef.current = saved.role;
      setSavedRole(saved.role);
      setUrlRoom(saved.roomId);
      room.join(saved.roomId);
    } else if (urlRoom) {
      clearSession();
      room.join(urlRoom);
    }
  }, []);

  // Pause clocks and drop pending requests whenever the link isn't live.
  useEffect(() => {
    if (room.status === 'reconnecting' || room.status === 'connecting') {
      apply({ type: 'pause', now: Date.now() });
      apply({ type: 'pendingClear' });
    }
    if (room.status === 'error') {
      const s = stateRef.current;
      if (s.started && !s.result) apply({ type: 'finish', result: { kind: 'abandon', winner: 0 } });
      if (s.started) clearSession();
    }
  }, [room.status, apply, stateRef]);

  // In-app navigation away leaves the room (useRemoteRoom); forget it too.
  // Deferred for the same StrictMode reason as there.
  const forgetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (forgetTimer.current) {
      clearTimeout(forgetTimer.current);
      forgetTimer.current = null;
    }
    return () => {
      forgetTimer.current = setTimeout(clearSession, 0);
    };
  }, []);

  // Persist enough to redraw the board after a refresh.
  const persistRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onHide = () => persistRef.current();
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);
  // `match` is the trigger (save on every change); persist() reads stateRef.
  // biome-ignore lint/correctness/useExhaustiveDependencies: match is a trigger
  useEffect(() => {
    const persist = () => {
      if (!room.roomId || left) return;
      if (room.status === 'ended' || room.status === 'error' || room.status === 'idle') return;
      const m = stateRef.current;
      saveSession({
        roomId: room.roomId,
        role: room.role ?? savedRole,
        hostSide: m.hostSide,
        timeControl: m.timeControl,
        started: m.started,
        history: m.game.history,
        clocks: snapshotClock(m.clock, Date.now()),
        result: m.result,
      });
    };
    persistRef.current = persist;
    persist();
  }, [match, room.roomId, room.role, room.status, savedRole, left, stateRef]);

  // Keep the URL shareable while in a room.
  useEffect(() => {
    if (room.roomId && (room.status === 'waiting_peer' || room.status === 'ready')) {
      setUrlRoom(room.roomId);
    }
  }, [room.roomId, room.status]);

  // Timeout watch. Runs off the reducer's clock, independent of rendering.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reads refs; room.send/apply are stable
  useEffect(() => {
    if (room.status !== 'ready' || !match.started || match.result) return;
    const t = setInterval(() => {
      const s = stateRef.current;
      if (s.result || !s.started || s.clock.active === 0 || s.clock.pausedAt !== null) return;
      const now = Date.now();
      const v = clockView(s.clock, now);
      if (!v.flagged) return;
      const side = v.flagged;
      if (side !== mySide()) {
        const remaining = Math.min(
          v.main[side] ?? Number.POSITIVE_INFINITY,
          v.moveLeft ?? Number.POSITIVE_INFINITY,
        );
        if (remaining > -FLAG_LATENCY_ALLOWANCE_MS) return;
      }
      apply({ type: 'finish', result: { kind: 'timeout', winner: other(side) } });
      room.send({ t: 'flag', side, n: s.game.history.length });
    }, 200);
    return () => clearInterval(t);
  }, [room.status, match.started, match.result]);

  // ------------------------------------------------------------ UI actions

  const backToLobby = () => {
    room.leave();
    apply({ type: 'clear' });
    clearSession();
    roleRef.current = null;
    setSavedRole(null);
    setLeft(false);
    setFlash(null);
    setUrlRoom(null);
  };

  const handleCreate = async (side: Stone, tc: TimeControl) => {
    saveCreatePrefs({ side, timeControl: tc });
    apply({ type: 'clear' });
    apply({ type: 'configure', hostSide: side, timeControl: tc });
    roleRef.current = 'host';
    setSavedRole('host');
    setLeft(false);
    const id = await room.create();
    if (id) setUrlRoom(id);
  };

  const handleJoin = (id: string) => {
    apply({ type: 'clear' });
    roleRef.current = null;
    setSavedRole(null);
    setLeft(false);
    clearSession();
    room.join(id);
  };

  const handleRetry = () => {
    const id = room.roomId;
    if (id) handleJoin(id);
    else backToLobby();
  };

  const handleLeaveGame = () => {
    const s = stateRef.current;
    room.leave();
    clearSession();
    if (s.started && !s.result) apply({ type: 'finish', result: { kind: 'abandon', winner: 0 } });
    setLeft(true);
  };

  const handlePlay = (x: number, y: number) => {
    const s = stateRef.current;
    const me = mySide();
    if (room.status !== 'ready' || !s.started || s.result) return;
    if (s.game.toMove !== me || s.clock.pausedAt !== null) return;
    settlePendingBeforeMove();
    const before = s.game.history.length;
    const next = apply({ type: 'move', x, y, now: Date.now() });
    if (next.game.history.length === before) return;
    room.send({ t: 'move', x, y, n: before + 1, clock: next.clock.main[me as 1 | 2] });
  };

  const request = (kind: RequestKind) => {
    const s = stateRef.current;
    if (s.pending) return;
    if (kind === 'undo') {
      const to = undoTarget(s.game.history.length, s.game.toMove, mySide());
      if (to === null) return;
      room.send({ t: 'undo_req', to });
      apply({ type: 'pendingSet', pending: { kind, dir: 'out', to } });
    } else if (kind === 'draw') {
      room.send({ t: 'draw_req' });
      apply({ type: 'pendingSet', pending: { kind, dir: 'out' } });
    } else {
      room.send({ t: 'reset_req', timeControl: s.timeControl });
      apply({ type: 'pendingSet', pending: { kind, dir: 'out', timeControl: s.timeControl } });
    }
  };

  const resign = () => {
    const s = stateRef.current;
    if (s.result || !s.started) return;
    if (s.pending) settlePendingBeforeMove();
    apply({ type: 'finish', result: { kind: 'resign', winner: other(mySide()) } });
    room.send({ t: 'resign', n: s.game.history.length });
  };

  // ------------------------------------------------------------ render

  const role = room.role ?? savedRole;
  const me = sideOf(role, match.hostSide);
  const closed = left || room.status === 'ended' || room.status === 'error';

  if (!match.started && !left) {
    return (
      <OnlineGate
        status={room.status}
        error={room.error}
        roomId={room.roomId}
        isHost={role === 'host'}
        hostSide={match.hostSide}
        timeControl={match.timeControl}
        awayUntil={room.awayUntil}
        endedText={room.endReason === 'lost' ? '连接已断开' : '对方已离开房间'}
        onCreate={handleCreate}
        onJoin={handleJoin}
        onBack={backToLobby}
        onRetry={handleRetry}
      />
    );
  }

  const live = room.status === 'ready' && !closed && match.clock.pausedAt === null;
  const presence: Presence = closed ? 'gone' : room.status === 'ready' ? 'online' : 'away';
  const { game, result, pending } = match;
  const canPlay = live && !result && me !== 0 && game.toMove === me;
  const undoTo = me !== 0 ? undoTarget(game.history.length, game.toMove, me) : null;
  const act = live && !pending;

  const notice = pickNotice({
    closed,
    left,
    status: room.status,
    endReason: room.endReason,
    error: room.error,
    awayUntil: room.awayUntil,
    pending,
    flash,
    result,
    me,
    onAccept: () => pending && acceptRequest(pending),
    onDecline: () => {
      if (!pending) return;
      declineRequest(pending.kind, pending.to);
      apply({ type: 'pendingClear' });
    },
    onCancel: () => {
      if (!pending) return;
      room.send({ t: 'req_cancel', kind: pending.kind });
      apply({ type: 'pendingClear' });
    },
  });

  return (
    <main className="flex-1 min-h-0 flex flex-col items-center gap-2 sm:gap-3 p-3 sm:p-5">
      <PlayerBar
        clock={match.clock}
        mySide={me === 0 ? 1 : me}
        toMove={game.toMove}
        started={match.started}
        result={result}
        live={live}
        opponent={presence}
      />
      <OnlineNotice
        notice={notice}
        fallback={
          room.roomId ? (
            <>
              房间 <span className="font-mono">{room.roomId}</span> ·{' '}
              {describeTimeControl(match.timeControl)} · 第 {game.history.length} 手
            </>
          ) : null
        }
      />
      <div
        className="flex-1 min-h-0 w-full flex items-center justify-center"
        style={{ containerType: 'size' }}
      >
        <div style={{ width: 'min(100cqw, 100cqh)', height: 'min(100cqw, 100cqh)' }}>
          <Board
            board={game.board}
            lastMove={game.history.length ? game.history[game.history.length - 1] : null}
            winLine={game.winLine}
            candidates={[]}
            hoverColor={me === 0 ? 1 : me}
            onPlay={handlePlay}
            disabled={!canPlay}
          />
        </div>
      </div>
      <OnlineActions
        canUndo={act && !result && undoTo !== null}
        canDraw={act && !result && game.history.length > 0}
        canResign={live && !result}
        canReset={act}
        finished={result !== null}
        confirmLeave={!closed && !result}
        closed={closed}
        onUndo={() => request('undo')}
        onDraw={() => request('draw')}
        onResign={resign}
        onReset={() => request('reset')}
        onLeave={closed ? backToLobby : handleLeaveGame}
      />
    </main>
  );
}

// ---------------------------------------------------------------- notices

function pickNotice(o: {
  closed: boolean;
  left: boolean;
  status: string;
  endReason: string | null;
  error: string | null;
  awayUntil: number | null;
  pending: MatchState['pending'];
  flash: Flash | null;
  result: MatchState['result'];
  me: Stone;
  onAccept: () => void;
  onDecline: () => void;
  onCancel: () => void;
}): NoticeSpec | null {
  if (o.closed) {
    const text = o.left
      ? '你已离开房间'
      : o.status === 'error'
        ? (o.error ?? '房间已关闭')
        : o.endReason === 'lost'
          ? '连接已断开，房间已关闭'
          : '对方已离开房间';
    return { tone: 'muted', text: resultPrefix(o.result, o.me) + text };
  }
  if (o.status === 'reconnecting') return { tone: 'warn', text: '连接中断，正在重连… 计时已暂停' };
  if (o.status === 'connecting') return { tone: 'info', text: '正在连接房间…' };
  if (o.status === 'peer_away') {
    return { tone: 'warn', text: '对方连接中断，计时已暂停 · 等待重连', countdownTo: o.awayUntil };
  }
  const p = o.pending;
  if (p?.dir === 'in') {
    const what =
      p.kind === 'undo'
        ? `对方请求悔棋${p.to !== undefined ? `（退回到第 ${p.to} 手）` : ''}`
        : p.kind === 'draw'
          ? '对方提议和棋'
          : o.result
            ? '对方想再来一局'
            : '对方请求重开';
    return {
      tone: 'info',
      text: what,
      actions: [
        { label: '同意', onClick: o.onAccept, primary: true },
        { label: '拒绝', onClick: o.onDecline },
      ],
    };
  }
  if (p?.dir === 'out') {
    const what =
      p.kind === 'undo' ? '悔棋' : p.kind === 'draw' ? '和棋' : o.result ? '再来一局' : '重开';
    return {
      tone: 'muted',
      text: `已请求${what}，等待对方回应…`,
      actions: [{ label: '撤回', onClick: o.onCancel }],
    };
  }
  if (o.flash) return { tone: o.flash.tone, text: o.flash.text };
  if (o.result) {
    const { title, detail } = describeResult(o.result, o.me || null);
    const won = o.result.winner !== 0 && o.result.winner === o.me;
    return { tone: won ? 'success' : 'muted', text: `${title} · ${detail}` };
  }
  return null;
}

function resultPrefix(result: MatchState['result'], me: Stone): string {
  if (!result || result.kind === 'abandon') return '';
  const { title } = describeResult(result, me || null);
  return `${title} · `;
}
