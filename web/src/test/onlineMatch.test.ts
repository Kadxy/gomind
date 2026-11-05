import { clockView } from '@/game/online';
import type { SyncMsg } from '@/game/peer-protocol';
import { gameFromHistory, playMove } from '@/hooks/useGame';
import { type MatchState, initialMatch, matchReducer, syncFromState } from '@/hooks/useOnlineMatch';
import { describe, expect, it } from 'vitest';

const tc = { main: 60_000, perMove: 20_000 };

function started(now = 0): MatchState {
  return matchReducer(
    matchReducer(initialMatch, { type: 'configure', hostSide: 2, timeControl: tc }),
    { type: 'start', now },
  );
}

describe('gameFromHistory / playMove', () => {
  it('replays a win and ignores trailing moves after it', () => {
    const g = gameFromHistory([
      [0, 0],
      [1, 1],
      [0, 1],
      [2, 2],
      [0, 2],
      [3, 3],
      [0, 3],
      [4, 4],
      [0, 4],
      [9, 9],
    ]);
    expect(g.winner).toBe(1);
    expect(g.history.length).toBe(9);
    expect(g.winLine?.length).toBe(5);
  });
  it('rejects occupied and out-of-range squares', () => {
    const g = playMove(gameFromHistory([[7, 7]]), 7, 7);
    expect(g.history.length).toBe(1);
    expect(playMove(g, 15, 0)).toBe(g);
  });
});

describe('matchReducer', () => {
  it("start resets the board and runs black's clock", () => {
    const s = started(1000);
    expect(s.started).toBe(true);
    expect(s.hostSide).toBe(2);
    expect(s.clock.active).toBe(1);
    expect(clockView(s.clock, 6000).main[1]).toBe(55_000);
  });

  it('move charges the mover and hands the clock over', () => {
    let s = started(0);
    s = matchReducer(s, { type: 'move', x: 7, y: 7, now: 3000 });
    expect(s.game.history).toEqual([[7, 7]]);
    expect(s.clock.active).toBe(2);
    expect(s.clock.main[1]).toBe(57_000);
    // Remote move carrying the mover's own figure wins over local timing.
    s = matchReducer(s, { type: 'move', x: 8, y: 8, now: 9000, reportedClock: 58_123 });
    expect(s.clock.main[2]).toBe(58_123);
    expect(s.clock.active).toBe(1);
  });

  it('a five stops the clock and records the result', () => {
    let s = started(0);
    const moves: [number, number][] = [
      [0, 0],
      [1, 1],
      [0, 1],
      [2, 2],
      [0, 2],
      [3, 3],
      [0, 3],
      [4, 4],
      [0, 4],
    ];
    moves.forEach(([x, y], i) => {
      s = matchReducer(s, { type: 'move', x, y, now: i * 1000 });
    });
    expect(s.result).toEqual({ kind: 'five', winner: 1 });
    expect(s.clock.active).toBe(0);
    // Further moves are ignored.
    expect(matchReducer(s, { type: 'move', x: 9, y: 9, now: 99_000 })).toBe(s);
  });

  it('undoTo rewinds and restarts the right clock', () => {
    let s = started(0);
    s = matchReducer(s, { type: 'move', x: 7, y: 7, now: 1000 });
    s = matchReducer(s, { type: 'move', x: 8, y: 8, now: 2000 });
    s = matchReducer(s, { type: 'move', x: 9, y: 9, now: 3000 });
    s = matchReducer(s, { type: 'undoTo', to: 1, now: 4000 });
    expect(s.game.history).toEqual([[7, 7]]);
    expect(s.game.toMove).toBe(2);
    expect(s.clock.active).toBe(2);
    expect(s.result).toBeNull();
  });

  it('pause/resume freeze the active clock', () => {
    let s = started(0);
    s = matchReducer(s, { type: 'pause', now: 2000 });
    s = matchReducer(s, { type: 'resume', now: 50_000 });
    expect(clockView(s.clock, 51_000).main[1]).toBe(57_000);
  });

  it('finish is idempotent and clears pending requests', () => {
    let s = started(0);
    s = matchReducer(s, { type: 'pendingSet', pending: { kind: 'draw', dir: 'out' } });
    s = matchReducer(s, { type: 'finish', result: { kind: 'resign', winner: 2 } });
    expect(s.pending).toBeNull();
    const again = matchReducer(s, { type: 'finish', result: { kind: 'draw', winner: 0 } });
    expect(again.result).toEqual({ kind: 'resign', winner: 2 });
  });

  it('sync round-trips the full state to a fresh peer', () => {
    let a = started(0);
    a = matchReducer(a, { type: 'move', x: 7, y: 7, now: 4000 });
    a = matchReducer(a, { type: 'move', x: 8, y: 8, now: 10_000 });
    const msg: SyncMsg = { ...syncFromState(a, 12_000), v: 2, ts: 12_000 };
    // Black has been thinking for 2s at snapshot time.
    expect(msg.clocks).toEqual({ black: 54_000, white: 54_000, moveLeft: 18_000 });

    const b = matchReducer(initialMatch, { type: 'adoptSync', msg, now: 500_000 });
    expect(b.started).toBe(true);
    expect(b.hostSide).toBe(2);
    expect(b.game.history).toEqual(a.game.history);
    expect(b.game.toMove).toBe(1);
    const v = clockView(b.clock, 500_000);
    expect(v.main).toEqual({ 1: 54_000, 2: 54_000 });
    expect(v.moveLeft).toBe(18_000);
  });

  it('sync of a finished game stops the clock', () => {
    let a = started(0);
    a = matchReducer(a, { type: 'finish', result: { kind: 'draw', winner: 0 } });
    const msg: SyncMsg = { ...syncFromState(a, 1000), v: 2, ts: 1000 };
    const b = matchReducer(initialMatch, { type: 'adoptSync', msg, now: 2000 });
    expect(b.result).toEqual({ kind: 'draw', winner: 0 });
    expect(b.clock.active).toBe(0);
  });

  it('newGame applies a new time control', () => {
    const s = matchReducer(started(0), {
      type: 'newGame',
      timeControl: { main: null, perMove: 30_000 },
      now: 100,
    });
    expect(s.game.history).toEqual([]);
    expect(s.clock.tc).toEqual({ main: null, perMove: 30_000 });
    expect(clockView(s.clock, 10_100).moveLeft).toBe(20_000);
  });
});
