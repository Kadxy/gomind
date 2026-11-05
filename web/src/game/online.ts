// Pure helpers for online play: time-control presets, clock arithmetic,
// undo targets and result labelling. No React, no sockets — unit-testable.

import type { ClockSnapshot, GameResult, TimeControl } from '@/game/peer-protocol';
import type { Stone } from '@/game/types';

export const MAIN_TIME_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: '不限' },
  { value: 5 * 60_000, label: '5 分' },
  { value: 10 * 60_000, label: '10 分' },
  { value: 20 * 60_000, label: '20 分' },
];

export const PER_MOVE_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: '不限' },
  { value: 15_000, label: '15 秒' },
  { value: 30_000, label: '30 秒' },
  { value: 60_000, label: '60 秒' },
];

/** Bounds for custom values on the create-room form. */
export const MAIN_MINUTES_RANGE = { min: 1, max: 120 } as const;
export const PER_MOVE_SECONDS_RANGE = { min: 5, max: 300 } as const;

export const UNLIMITED: TimeControl = { main: null, perMove: null };

export function isTimed(tc: TimeControl): boolean {
  return tc.main !== null || tc.perMove !== null;
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** "45 秒", "2 分", "1 分 30 秒". */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} 分 ${r} 秒` : `${m} 分`;
}

export function describeTimeControl(tc: TimeControl): string {
  const parts: string[] = [];
  if (tc.main !== null) parts.push(`局时 ${formatDuration(tc.main)}`);
  if (tc.perMove !== null) parts.push(`步时 ${formatDuration(tc.perMove)}`);
  return parts.length ? parts.join(' · ') : '不限时';
}

/** mm:ss, or h:mm:ss above an hour. Negative values clamp to 0:00. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/**
 * Number of moves that should remain after I take back my last move.
 * If it's my turn the opponent has already replied, so both their reply
 * and my move go. Returns null when I have nothing to take back.
 */
export function undoTarget(historyLen: number, toMove: Stone, mySide: Stone): number | null {
  const to = toMove === mySide ? historyLen - 2 : historyLen - 1;
  return to >= 0 ? to : null;
}

// ------------------------------------------------------------------ clocks
//
// Each side has a main-time budget; the side to move also has a per-move
// budget. Only the active side's clock runs. `turnStartedAt` is the wall
// time the current turn began, shifted forward by any pause, so remaining
// time is always `budget - (now - turnStartedAt)` while running.

export interface ClockState {
  tc: TimeControl;
  /** Main time left for each side as of the start of the current turn. */
  main: Record<1 | 2, number | null>;
  /** Side whose clock is running; 0 = stopped (no game, or game over). */
  active: Stone;
  turnStartedAt: number | null;
  pausedAt: number | null;
}

export function newClock(tc: TimeControl): ClockState {
  return { tc, main: { 1: tc.main, 2: tc.main }, active: 0, turnStartedAt: null, pausedAt: null };
}

function elapsed(cs: ClockState, now: number): number {
  if (cs.active === 0 || cs.turnStartedAt === null) return 0;
  const end = cs.pausedAt ?? now;
  return Math.max(0, end - cs.turnStartedAt);
}

export interface ClockView {
  main: Record<1 | 2, number | null>;
  /** Per-move time left for the active side; null if unlimited/inactive. */
  moveLeft: number | null;
  /** Side whose clock has hit zero, if any. */
  flagged: Stone;
}

export function clockView(cs: ClockState, now: number): ClockView {
  const e = elapsed(cs, now);
  const main: Record<1 | 2, number | null> = { ...cs.main };
  let moveLeft: number | null = null;
  let flagged: Stone = 0;
  if (cs.active !== 0) {
    const budget = cs.main[cs.active];
    if (budget !== null) {
      main[cs.active] = budget - e;
      if (budget - e <= 0) flagged = cs.active;
    }
    if (cs.tc.perMove !== null) {
      moveLeft = cs.tc.perMove - e;
      if (moveLeft <= 0) flagged = cs.active;
    }
  }
  return { main, moveLeft, flagged };
}

/** Start `side`'s clock now (game start, after undo, or after sync). */
export function startTurn(cs: ClockState, side: Stone, now: number): ClockState {
  return { ...cs, active: side, turnStartedAt: now, pausedAt: null };
}

/**
 * The active side moved: charge the elapsed time to their main budget (or
 * trust `reported`, the mover's own figure, when given) and hand the clock
 * to the other side.
 */
export function commitMove(cs: ClockState, now: number, reported?: number | null): ClockState {
  if (cs.active === 0) return cs;
  const side = cs.active;
  const main = { ...cs.main };
  if (main[side] !== null) {
    main[side] =
      reported !== undefined && reported !== null ? reported : main[side] - elapsed(cs, now);
  }
  const next: Stone = side === 1 ? 2 : 1;
  return { ...cs, main, active: next, turnStartedAt: now, pausedAt: null };
}

export function stopClock(cs: ClockState): ClockState {
  return { ...cs, active: 0, turnStartedAt: null, pausedAt: null };
}

export function pauseClock(cs: ClockState, now: number): ClockState {
  if (cs.active === 0 || cs.pausedAt !== null) return cs;
  return { ...cs, pausedAt: now };
}

export function resumeClock(cs: ClockState, now: number): ClockState {
  if (cs.pausedAt === null || cs.turnStartedAt === null) return cs;
  return { ...cs, turnStartedAt: cs.turnStartedAt + (now - cs.pausedAt), pausedAt: null };
}

/** Remaining times as of `now`, for a `sync` message or local persistence. */
export function snapshotClock(cs: ClockState, now: number): ClockSnapshot {
  const v = clockView(cs, now);
  return { black: v.main[1], white: v.main[2], moveLeft: v.moveLeft };
}

/** Rebuild a running clock from a snapshot, with `side` to move from `now`. */
export function clockFromSnapshot(
  tc: TimeControl,
  snap: ClockSnapshot,
  side: Stone,
  now: number,
): ClockState {
  const cs: ClockState = {
    tc,
    main: { 1: snap.black, 2: snap.white },
    active: side,
    turnStartedAt: now,
    pausedAt: null,
  };
  // Restore the partially used per-move budget by back-dating the turn start.
  if (side !== 0 && tc.perMove !== null && snap.moveLeft !== null) {
    const used = Math.max(0, tc.perMove - snap.moveLeft);
    cs.turnStartedAt = now - used;
    if (cs.main[side] !== null) cs.main[side] = (cs.main[side] as number) + used;
  }
  return cs;
}

// ----------------------------------------------------------------- results

export function describeResult(
  r: GameResult,
  mySide: Stone | null,
): { title: string; detail: string } {
  const sideName = (s: Stone) => (s === 1 ? '黑方' : '白方');
  const outcome =
    r.winner === 0 ? '' : mySide === null ? '' : r.winner === mySide ? '你赢了' : '你输了';
  switch (r.kind) {
    case 'five':
      return { title: outcome || `${sideName(r.winner)}胜`, detail: `${sideName(r.winner)}五连` };
    case 'full':
      return { title: '和棋', detail: '棋盘已满' };
    case 'resign':
      return {
        title: outcome || `${sideName(r.winner)}胜`,
        detail: `${sideName(r.winner === 1 ? 2 : 1)}认输`,
      };
    case 'draw':
      return { title: '和棋', detail: '双方同意' };
    case 'timeout':
      return {
        title: outcome || `${sideName(r.winner)}胜`,
        detail: `${sideName(r.winner === 1 ? 2 : 1)}超时`,
      };
    case 'abandon':
      return { title: '对局中止', detail: '对方已离开房间' };
  }
}
