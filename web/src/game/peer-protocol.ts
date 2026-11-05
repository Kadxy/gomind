import type { Stone } from '@/game/types';

export const PROTOCOL_VERSION = 2;

/** Dual-limit time control. `null` means unlimited for that component. */
export interface TimeControl {
  /** Total thinking time per player, ms. */
  main: number | null;
  /** Maximum time for any single move, ms. */
  perMove: number | null;
}

export type ResultKind =
  | 'five' // five in a row
  | 'full' // board full, draw
  | 'resign'
  | 'draw' // agreed
  | 'timeout'
  | 'abandon'; // opponent left / never came back

export interface GameResult {
  kind: ResultKind;
  /** 0 for draws and abandonment. */
  winner: Stone;
}

/** Remaining time snapshot carried in `sync`, taken while clocks are paused. */
export interface ClockSnapshot {
  black: number | null;
  white: number | null;
  /** Remaining per-move time for the side to move, ms (null = unlimited). */
  moveLeft: number | null;
}

export type RequestKind = 'undo' | 'reset' | 'draw';

// Base fields stamped on every outgoing message by useRemoteRoom.send.
// The relay forwards JSON verbatim to the other peer and never echoes it
// back to the sender, so no `from` field is needed.
interface BaseMsg {
  v: typeof PROTOCOL_VERSION;
  ts: number;
}

/**
 * Full game state. Sent by the host when the guest first joins (replaces
 * the old `assign`), and by whichever peer stayed online when the other
 * one reconnects. The receiver adopts it wholesale: the sender is, by
 * construction, the side that saw every move.
 */
export interface SyncMsg extends BaseMsg {
  t: 'sync';
  hostSide: Stone;
  timeControl: TimeControl;
  history: [number, number][];
  clocks: ClockSnapshot;
  result: GameResult | null;
}

/** A stone was placed. `n` is the 1-based move index (desync guard). */
export interface MoveMsg extends BaseMsg {
  t: 'move';
  x: number;
  y: number;
  n: number;
  /** Mover's remaining main time after this move, so the receiver resyncs. */
  clock: number | null;
}

// Consent requests. One may be pending at a time. Accepts (`ok: true`) are
// self-contained and always applied by the receiver, so both boards converge
// even if the asker withdrew the request while the answer was in flight.

/** Take back moves so that `to` moves remain. */
export interface UndoReqMsg extends BaseMsg {
  t: 'undo_req';
  to: number;
}
export interface UndoAckMsg extends BaseMsg {
  t: 'undo_ack';
  to: number;
  ok: boolean;
}

/** Start a fresh game, optionally with a new time control. */
export interface ResetReqMsg extends BaseMsg {
  t: 'reset_req';
  timeControl: TimeControl;
}
export interface ResetAckMsg extends BaseMsg {
  t: 'reset_ack';
  ok: boolean;
  /** Echoed so an accept is self-contained, even if the asker cancelled meanwhile. */
  timeControl: TimeControl;
}

export interface DrawReqMsg extends BaseMsg {
  t: 'draw_req';
}
export interface DrawAckMsg extends BaseMsg {
  t: 'draw_ack';
  ok: boolean;
}

/** Requester withdrew a pending undo/reset/draw request. */
export interface ReqCancelMsg extends BaseMsg {
  t: 'req_cancel';
  kind: RequestKind;
}

/** `n` = moves on the resigner's board; the receiver trims any in-flight move. */
export interface ResignMsg extends BaseMsg {
  t: 'resign';
  n: number;
}

/**
 * `side` ran out of time. Either peer may claim it; the claim is final.
 * `n` = moves on the claimer's board; a move that crossed the claim in
 * flight is trimmed so both boards end identical.
 */
export interface FlagMsg extends BaseMsg {
  t: 'flag';
  side: Stone;
  n: number;
}

/** Ask the other peer for a full `sync` (e.g. after an out-of-order move). */
export interface SyncReqMsg extends BaseMsg {
  t: 'sync_req';
}

/** Client -> server heartbeat; the relay eats it. */
export interface PingMsg extends BaseMsg {
  t: 'ping';
}

export type PeerMsg =
  | SyncMsg
  | SyncReqMsg
  | MoveMsg
  | UndoReqMsg
  | UndoAckMsg
  | ResetReqMsg
  | ResetAckMsg
  | DrawReqMsg
  | DrawAckMsg
  | ReqCancelMsg
  | ResignMsg
  | FlagMsg
  | PingMsg;

// Room numbers are exactly 4 digits, allocated by the relay on create.
const ROOM_RE = /^\d{4}$/;

export function isValidRoomId(s: string): boolean {
  return ROOM_RE.test(s);
}
