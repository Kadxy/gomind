import { useCallback, useEffect, useRef, useState } from 'react';
import { Board } from '@/components/Board';
import { Controls } from '@/components/Controls';
import { OnlineGate } from '@/components/OnlineGate';
import { RemotePanel } from '@/components/RemotePanel';
import { RemoteTurnBadge } from '@/components/TurnBadge';
import { type PeerMsg, isValidRoomId } from '@/game/peer-protocol';
import type { Stone } from '@/game/types';
import { useGame } from '@/hooks/useGame';
import { type UseRemoteRoomReturn, useRemoteRoom } from '@/hooks/useRemoteRoom';

function readRoomFromUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const r = new URLSearchParams(window.location.search).get('room');
  if (r && isValidRoomId(r)) return r;
  return undefined;
}

export function OnlineApp({ onExit }: { onExit: () => void }) {
  const { state, play, reset } = useGame();

  const [mySide, setMySide] = useState<Stone | null>(null);
  // Locked at first render. OnlineGate's SetupCard auto-submits it once on
  // mount, so nothing here calls connect() for it — a second connect would
  // open and immediately abort a stray socket, and the relay tears the
  // whole room down on any disconnect.
  const [initialRoomId] = useState<string | undefined>(readRoomFromUrl);

  // Only the first peer to arrive rolls the side assignment; track via
  // a ref so the effect fires exactly once per connection.
  const assignSentRef = useRef(false);

  // Forward ref + ref'd handler so onMessage can call room.send without
  // a declaration cycle, and always see fresh closures.
  const roomRef = useRef<UseRemoteRoomReturn | null>(null);
  const handleMsgRef = useRef<(msg: PeerMsg) => void>(() => {});

  const room = useRemoteRoom({
    onMessage: (msg) => handleMsgRef.current(msg),
  });
  roomRef.current = room;

  useEffect(() => {
    handleMsgRef.current = (msg: PeerMsg) => {
      switch (msg.t) {
        case 'assign':
          setMySide(msg.yourSide);
          reset();
          break;
        case 'move': {
          // `n` is a sequence guard. Drop moves that don't line up with
          // our local history length instead of applying out-of-order.
          if (msg.n !== state.history.length + 1) {
            console.warn('[remote] move out of sequence', {
              got: msg.n,
              expected: state.history.length + 1,
            });
            return;
          }
          play(msg.x, msg.y);
          break;
        }
        case 'reset_req': {
          // Batch 1: auto-accept restarts. Batch 2 will turn this into
          // a negotiation banner with the other side.
          reset();
          roomRef.current?.send({ t: 'reset_ack', ok: true });
          break;
        }
        case 'reset_ack':
          if (msg.ok) reset();
          break;
        case 'undo_req':
        case 'undo_ack':
        case 'ping':
          break;
      }
    };
  });

  // Side assignment: the peer who was alone at welcome time ("first")
  // rolls a 50/50 once the other arrives, keeps one side for themselves,
  // and tells the other over the wire.
  useEffect(() => {
    if (!room.isFirst) return;
    if (room.status !== 'ready') return;
    if (assignSentRef.current) return;
    assignSentRef.current = true;

    const myRoll: Stone = Math.random() < 0.5 ? 1 : 2;
    const opponentSide: Stone = myRoll === 1 ? 2 : 1;
    setMySide(myRoll);
    reset();
    room.send({ t: 'assign', yourSide: opponentSide });
  }, [room.isFirst, room.status, room.send, reset]);

  const handleEnterRoom = useCallback(
    (id: string) => {
      setMySide(null);
      assignSentRef.current = false;
      reset();
      room.connect(id);
    },
    [room, reset],
  );

  const handleLeave = useCallback(() => {
    room.leave();
    setMySide(null);
    assignSentRef.current = false;
    reset();
    // Actually navigate back to home — clearing the `?room=` bit alone
    // isn't enough, the user expects to see the homepage.
    onExit();
  }, [room, reset, onExit]);

  const handleRetry = useCallback(() => {
    if (room.roomId) {
      handleEnterRoom(room.roomId);
    } else {
      handleLeave();
    }
  }, [room.roomId, handleEnterRoom, handleLeave]);

  const handlePlay = useCallback(
    (x: number, y: number) => {
      if (mySide === null) return;
      if (state.toMove !== mySide) return;
      if (state.winner !== 0) return;
      play(x, y);
      room.send({ t: 'move', x, y, n: state.history.length + 1 });
    },
    [mySide, state.toMove, state.winner, state.history.length, play, room],
  );

  const handleReset = useCallback(() => {
    if (room.status === 'ready') {
      room.send({ t: 'reset_req' });
    }
    reset();
  }, [room, reset]);

  const inGame = room.status === 'ready' && mySide !== null;

  if (!inGame) {
    return (
      <OnlineGate
        status={room.status}
        error={room.error}
        roomId={room.roomId}
        initialRoomId={initialRoomId}
        onEnter={handleEnterRoom}
        onLeave={handleLeave}
        onRetry={handleRetry}
      />
    );
  }

  const canPlay = state.toMove === mySide && state.winner === 0;

  return (
    <main className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[1fr_360px] gap-3 lg:gap-6 p-3 lg:p-6">
      <section className="flex flex-col items-center gap-3 min-h-0 min-w-0 flex-1">
        <RemoteTurnBadge
          winner={state.winner}
          toMove={state.toMove}
          moveCount={state.history.length}
          mySide={mySide}
          status={room.status}
        />
        <div className="flex-1 min-h-0 w-full flex items-center justify-center">
          <div
            className="aspect-square"
            style={{ height: '100%', maxWidth: '100%', maxHeight: '100%' }}
          >
            <Board
              board={state.board}
              lastMove={state.history.length ? state.history[state.history.length - 1] : null}
              winLine={state.winLine}
              candidates={[]}
              hoverColor={state.toMove}
              onPlay={handlePlay}
              disabled={!canPlay}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Controls onReset={handleReset} onUndo={() => {}} canUndo={false} />
        </div>
      </section>
      <aside className="flex flex-col gap-2.5 min-h-0 min-w-0 overflow-y-auto max-h-[42dvh] lg:max-h-none shrink-0">
        <RemotePanel roomId={room.roomId} mySide={mySide} onLeave={handleLeave} />
      </aside>
    </main>
  );
}
