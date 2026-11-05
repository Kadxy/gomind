import { Board } from '@/components/Board';
import {
  CreateForm,
  JoinForm,
  type LobbyView,
  OnlineChoose,
  WaitingRoom,
} from '@/components/OnlineGate';
import { type DockAction, type DockSpec, OnlineDock } from '@/components/online/OnlineDock';
import { PlayerBar, type Presence } from '@/components/online/PlayerBar';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Toast } from '@/components/ui/Toast';
import {
  clockFromSnapshot,
  clockView,
  describeResult,
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
import { Flag, Handshake, LogOut, RotateCcw, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

const other = (s: Stone): Stone => (s === 1 ? 2 : 1);
const sideOf = (role: RoomRole | null, hostSide: Stone): Stone =>
  role === null ? 0 : role === 'host' ? hostSide : other(hostSide);

// The waiting side only claims the opponent's timeout this far past zero,
// leaving room for a last-second move that's still in flight. The flagged
// side's own client claims at zero.
const FLAG_LATENCY_ALLOWANCE_MS = 1500;
const FLASH_MS = 2500;
const TOAST_MS = 3000;

const REQ_NAME: Record<RequestKind, string> = { undo: '悔棋', draw: '求和', reset: '重开' };

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

export function OnlineApp({ onExit }: { onExit: () => void }) {
  const { state: match, stateRef, apply } = useOnlineMatch();

  // Role is known from the relay's welcome; before that (right after a
  // refresh) we trust the saved session so the board renders immediately.
  const [savedRole, setSavedRole] = useState<RoomRole | null>(null);
  const roleRef = useRef<RoomRole | null>(null);
  // We pressed 离开 (or the room closed under us): keep the board on screen.
  const [left, setLeft] = useState(false);
  // Lobby state lives here so a deep link can prefill and submit the join form.
  const [view, setView] = useState<LobbyView>('choose');
  const [code, setCode] = useState('');
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Lobby errors (房间不存在 ...) show as a toast, not a reserved form line.
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );
  // A lobby message belongs to the screen it was raised on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: view is a trigger
  useEffect(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
  }, [view]);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFlash = useCallback((text: string) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash(text);
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
        }
        // Otherwise wait: whoever was already here sends us a sync.
        return;
      }
      case 'peer_joined':
      case 'peer_back': {
        if (roleRef.current === 'host' && !s.started) {
          apply({ type: 'start', now });
          sendSync();
        } else if (s.started) {
          // We stayed; we're the source of truth. Resume clocks, then send
          // everything so the returning side's board matches ours exactly.
          apply({ type: 'resume', now });
          sendSync();
          if (ev.type === 'peer_back') showFlash('对方已重新连接');
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
      case 'sync':
        apply({ type: 'adoptSync', msg, now });
        return;
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
          if (kind === 'undo') showFlash('对方已同意悔棋');
        } else {
          if (s.pending?.dir === 'out' && s.pending.kind === kind) apply({ type: 'pendingClear' });
          showFlash(`对方拒绝了${REQ_NAME[kind]}请求`);
        }
        return;
      }
      case 'req_cancel':
        if (s.pending?.dir === 'in' && s.pending.kind === msg.kind) {
          apply({ type: 'pendingClear' });
          showFlash(`对方撤回了${REQ_NAME[msg.kind]}请求`);
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

  /** Resigning settles whatever request is open first. */
  function settlePending() {
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
      handleJoin(urlRoom);
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
    setConfirmLeave(false);
    setCode('');
    setView('choose');
    setUrlRoom(null);
  };

  const handleCreate = async (side: Stone, tc: TimeControl) => {
    saveCreatePrefs({ side, timeControl: tc });
    apply({ type: 'clear' });
    apply({ type: 'configure', hostSide: side, timeControl: tc });
    roleRef.current = 'host';
    setSavedRole('host');
    setLeft(false);
    setView('create');
    const id = await room.create();
    if (id) setUrlRoom(id);
  };

  const handleJoin = (id: string) => {
    apply({ type: 'clear' });
    roleRef.current = null;
    setSavedRole(null);
    setLeft(false);
    setView('join');
    setCode(id);
    clearSession();
    room.join(id);
  };

  // A join / create that fails before any game started: say why and hand the
  // form back. (Once a game has started the board stays up; see the dock.)
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires on status only
  useEffect(() => {
    if (match.started || left) return;
    if (room.status !== 'error' && room.status !== 'ended') return;
    showToast(room.status === 'error' ? (room.error ?? '无法进入房间') : '房间已关闭');
    room.leave();
    apply({ type: 'clear' });
    roleRef.current = null;
    setSavedRole(null);
    setUrlRoom(null);
    clearSession();
  }, [room.status]);

  // Lobby navigation. Picking 加入 / 创建 pushes a history entry (same URL)
  // so the browser's back gesture returns to the choice, like the in-card
  // back button. In a waiting room or a game, back does nothing here.
  const lobbyRef = useRef(true);
  const roomRef = useRef(room);
  roomRef.current = room;
  const exitForm = () => {
    if (roomRef.current.status !== 'idle') roomRef.current.leave();
    apply({ type: 'clear' });
    roleRef.current = null;
    setSavedRole(null);
    setUrlRoom(null);
    setView('choose');
  };
  const pickView = (v: 'join' | 'create') => {
    window.history.pushState({ onlineView: v }, '', window.location.href);
    setView(v);
  };
  const backFromForm = () => {
    if (window.history.state?.onlineView) window.history.back();
    else exitForm();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: reads refs only
  useEffect(() => {
    const onPop = () => {
      if (!lobbyRef.current) return;
      const v = window.history.state?.onlineView as LobbyView | undefined;
      if (v) setView(v);
      else exitForm();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

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
    if (s.game.toMove !== me || s.clock.pausedAt !== null || s.pending) return;
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
    if (s.pending) settlePending();
    apply({ type: 'finish', result: { kind: 'resign', winner: other(mySide()) } });
    room.send({ t: 'resign', n: s.game.history.length });
  };

  // ------------------------------------------------------------ render

  const role = room.role ?? savedRole;
  const me = sideOf(role, match.hostSide);
  const closed = left || room.status === 'ended' || room.status === 'error';
  const st = room.status;

  const inWaitingRoom =
    !match.started &&
    !left &&
    role === 'host' &&
    !!room.roomId &&
    st !== 'idle' &&
    st !== 'error' &&
    st !== 'ended' &&
    !(st === 'connecting' && view === 'create');
  lobbyRef.current = !match.started && !left && !inWaitingRoom;

  if (inWaitingRoom && room.roomId) {
    return (
      <WaitingRoom
        roomId={room.roomId}
        hostSide={match.hostSide}
        timeControl={match.timeControl}
        peerDropped={st === 'peer_away'}
        onCancel={backToLobby}
      />
    );
  }

  if (!match.started && !left) {
    // Guest: the join button keeps spinning until the host's sync arrives.
    const busy = st !== 'idle' && st !== 'error' && st !== 'ended';
    const hostOffline = role !== 'host' && st === 'peer_away';
    return (
      <>
        {view === 'join' ? (
          <JoinForm
            code={code}
            onCode={setCode}
            busy={busy}
            onJoin={handleJoin}
            onBack={backFromForm}
          />
        ) : view === 'create' ? (
          <CreateForm busy={busy} onCreate={handleCreate} onBack={backFromForm} />
        ) : (
          <OnlineChoose onPick={pickView} onBack={onExit} />
        )}
        <Toast
          message={hostOffline ? '房主暂时离线，重新连接后将自动开始' : (toast?.text ?? null)}
          id={toast?.id}
        />
      </>
    );
  }

  const live = st === 'ready' && !closed && match.clock.pausedAt === null;
  const presence: Presence = closed ? 'gone' : st === 'ready' ? 'online' : 'away';
  const { game, result, pending } = match;
  const canPlay = live && !result && !pending && me !== 0 && game.toMove === me;
  const undoTo = me !== 0 ? undoTarget(game.history.length, game.toMove, me) : null;
  const inProgress = !result && !closed;

  const leave: DockAction = {
    key: 'leave',
    label: '离开',
    icon: <LogOut className={ICON} />,
    variant: 'ghost',
    onClick: () => (inProgress ? setConfirmLeave(true) : handleLeaveGame()),
  };

  let dock: DockSpec;
  if (closed) {
    const title =
      result && result.kind !== 'abandon' ? describeResult(result, me || null).title : undefined;
    dock = {
      kind: 'message',
      strong: title,
      text: left
        ? '你已离开房间'
        : st === 'error'
          ? (room.error ?? '房间已关闭')
          : room.endReason === 'lost'
            ? '连接已断开'
            : '对方已离开房间',
      tone: title ? 'default' : 'muted',
      actions: [{ key: 'back', label: '返回大厅', variant: 'default', onClick: backToLobby }],
    };
  } else if (st === 'connecting' || st === 'reconnecting') {
    dock = {
      kind: 'message',
      tone: 'muted',
      text: st === 'reconnecting' ? '连接中断，正在重新连接' : '正在连接',
      actions: [leave],
    };
  } else if (st === 'peer_away') {
    dock = {
      kind: 'message',
      tone: 'warn',
      text: '对方连接中断，计时已暂停',
      countdownTo: room.awayUntil,
      actions: [leave],
    };
  } else if (pending?.dir === 'in') {
    const back = pending.to !== undefined ? game.history.length - pending.to : 0;
    dock = {
      kind: 'message',
      text:
        pending.kind === 'undo'
          ? `对方请求悔棋${back > 1 ? `（撤回 ${back} 手）` : ''}`
          : pending.kind === 'draw'
            ? '对方提议和棋'
            : result
              ? '对方请求再来一局'
              : '对方请求重开',
      actions: [
        {
          key: 'accept',
          label: '同意',
          variant: 'default',
          onClick: () => acceptRequest(pending),
        },
        {
          key: 'decline',
          label: '拒绝',
          onClick: () => {
            declineRequest(pending.kind, pending.to);
            apply({ type: 'pendingClear' });
          },
        },
      ],
    };
  } else if (pending?.dir === 'out') {
    const what =
      pending.kind === 'undo'
        ? '悔棋'
        : pending.kind === 'draw'
          ? '求和'
          : result
            ? '再来一局'
            : '重开';
    dock = {
      kind: 'message',
      tone: 'muted',
      text: `已发出${what}请求，等待对方回应`,
      actions: [
        {
          key: 'withdraw',
          label: '撤回',
          onClick: () => {
            room.send({ t: 'req_cancel', kind: pending.kind });
            apply({ type: 'pendingClear' });
          },
        },
      ],
    };
  } else if (flash) {
    dock = { kind: 'message', tone: 'muted', text: flash };
  } else if (result) {
    const { title, detail } = describeResult(result, me || null);
    dock = {
      kind: 'message',
      strong: title,
      text: detail,
      actions: [
        {
          key: 'rematch',
          label: '再来一局',
          variant: 'default',
          disabled: !live,
          onClick: () => request('reset'),
        },
        leave,
      ],
    };
  } else {
    dock = {
      kind: 'actions',
      actions: [
        {
          key: 'undo',
          label: '悔棋',
          icon: <Undo2 className={ICON} />,
          disabled: !live || undoTo === null,
          onClick: () => request('undo'),
          confirm: { label: '确认悔棋' },
        },
        {
          key: 'draw',
          label: '求和',
          icon: <Handshake className={ICON} />,
          disabled: !live || game.history.length === 0,
          onClick: () => request('draw'),
          confirm: { label: '确认求和' },
        },
        {
          key: 'resign',
          label: '认输',
          icon: <Flag className={ICON} />,
          disabled: !live,
          onClick: resign,
          confirm: { label: '确认认输', destructive: true },
        },
        {
          key: 'reset',
          label: '重开',
          icon: <RotateCcw className={ICON} />,
          disabled: !live || game.history.length === 0,
          onClick: () => request('reset'),
          confirm: { label: '确认重开' },
        },
      ],
      trailing: [leave],
    };
  }

  return (
    <main className="flex-1 min-h-0 flex flex-col items-center gap-3 p-3 sm:p-5">
      <PlayerBar
        clock={match.clock}
        mySide={me === 0 ? 1 : me}
        toMove={game.toMove}
        started={match.started}
        result={result}
        live={live}
        opponent={presence}
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
      <OnlineDock
        spec={dock}
        resetKey={`${game.history.length}|${pending?.kind ?? ''}|${st}|${result ? 1 : 0}`}
      />
      <ConfirmDialog
        open={confirmLeave && inProgress}
        title="离开房间？"
        description="对局尚未结束。离开后房间将关闭，对局无法继续。"
        cancelLabel="继续对局"
        confirmLabel="离开房间"
        destructive
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => {
          setConfirmLeave(false);
          handleLeaveGame();
        }}
      />
    </main>
  );
}

const ICON = 'size-4 hidden sm:block';
