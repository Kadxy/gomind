import {
  clockFromSnapshot,
  clockView,
  commitMove,
  describeTimeControl,
  formatClock,
  newClock,
  pauseClock,
  resumeClock,
  snapshotClock,
  startTurn,
  undoTarget,
} from '@/game/online';
import { describe, expect, it } from 'vitest';

describe('formatClock', () => {
  it('formats minutes and seconds, rounding up', () => {
    expect(formatClock(600_000)).toBe('10:00');
    expect(formatClock(59_001)).toBe('1:00');
    expect(formatClock(9_400)).toBe('0:10');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(-5)).toBe('0:00');
    expect(formatClock(3_600_000 + 61_000)).toBe('1:01:01');
  });
});

describe('describeTimeControl', () => {
  it('labels each combination', () => {
    expect(describeTimeControl({ main: null, perMove: null })).toBe('不限时');
    expect(describeTimeControl({ main: 600_000, perMove: null })).toBe('局时 10 分');
    expect(describeTimeControl({ main: null, perMove: 30_000 })).toBe('步时 30 秒');
    expect(describeTimeControl({ main: 300_000, perMove: 120_000 })).toBe('局时 5 分 · 步时 2 分');
  });
});

describe('undoTarget', () => {
  it('takes back one move when the opponent has not replied yet', () => {
    expect(undoTarget(3, 2, 1)).toBe(2);
  });
  it('takes back two moves when it is my turn again', () => {
    expect(undoTarget(4, 1, 1)).toBe(2);
  });
  it('returns null when I have nothing to take back', () => {
    expect(undoTarget(0, 1, 1)).toBeNull();
    expect(undoTarget(1, 2, 2)).toBeNull();
  });
});

describe('clock', () => {
  const tc = { main: 60_000, perMove: 10_000 };

  it('charges only the active side and hands over on move', () => {
    let cs = startTurn(newClock(tc), 1, 1000);
    let v = clockView(cs, 4000);
    expect(v.main[1]).toBe(57_000);
    expect(v.main[2]).toBe(60_000);
    expect(v.moveLeft).toBe(7_000);
    expect(v.flagged).toBe(0);

    cs = commitMove(cs, 4000);
    expect(cs.active).toBe(2);
    expect(cs.main[1]).toBe(57_000);
    v = clockView(cs, 6000);
    expect(v.main[2]).toBe(58_000);
    expect(v.moveLeft).toBe(8_000);
  });

  it("trusts the mover's reported remaining time", () => {
    const cs = commitMove(startTurn(newClock(tc), 1, 0), 5000, 55_500);
    expect(cs.main[1]).toBe(55_500);
  });

  it('flags on per-move and main-time exhaustion', () => {
    const cs = startTurn(newClock(tc), 2, 0);
    expect(clockView(cs, 10_000).flagged).toBe(2);
    const cs2 = startTurn(newClock({ main: 5_000, perMove: null }), 1, 0);
    expect(clockView(cs2, 4_999).flagged).toBe(0);
    expect(clockView(cs2, 5_000).flagged).toBe(1);
  });

  it('pause freezes time and resume continues from the same point', () => {
    let cs = startTurn(newClock(tc), 1, 0);
    cs = pauseClock(cs, 3000);
    expect(clockView(cs, 50_000).main[1]).toBe(57_000);
    cs = resumeClock(cs, 50_000);
    expect(clockView(cs, 52_000).main[1]).toBe(55_000);
    expect(clockView(cs, 52_000).moveLeft).toBe(5_000);
  });

  it('round-trips through a snapshot keeping the per-move remainder', () => {
    const cs = pauseClock(startTurn(newClock(tc), 2, 0), 4000);
    const snap = snapshotClock(cs, 9000);
    expect(snap).toEqual({ black: 60_000, white: 56_000, moveLeft: 6_000 });
    const back = clockFromSnapshot(tc, snap, 2, 100_000);
    const v = clockView(back, 100_000);
    expect(v.main[2]).toBe(56_000);
    expect(v.moveLeft).toBe(6_000);
    expect(clockView(back, 106_000).flagged).toBe(2);
  });

  it('handles unlimited controls', () => {
    const cs = startTurn(newClock({ main: null, perMove: null }), 1, 0);
    const v = clockView(cs, 999_999);
    expect(v.main[1]).toBeNull();
    expect(v.moveLeft).toBeNull();
    expect(v.flagged).toBe(0);
  });
});
