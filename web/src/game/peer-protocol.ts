import type { Stone } from '@/game/types';

export const PROTOCOL_VERSION = 1;

// Base fields stamped on every outgoing message by useRemoteRoom.send.
// Server relays JSON verbatim to the other peer; no `from` field needed
// because the relay doesn't echo messages back to their sender.
interface BaseMsg {
  v: typeof PROTOCOL_VERSION;
  ts: number;
}

// Sent by the first peer (whoever arrives first) once the second peer
// joins. Tells the second peer which side they got. The first peer has
// already rolled their own side locally before sending.
export interface AssignMsg extends BaseMsg {
  t: 'assign';
  yourSide: Stone; // 1 or 2
}

// A stone was placed. `n` is 1-based move index; receivers drop messages
// where `n` doesn't match their expected next move (desync guard).
export interface MoveMsg extends BaseMsg {
  t: 'move';
  x: number;
  y: number;
  n: number;
}

// Two-phase undo: request → ack(ok|reject). Both sides rewind on ok.
// (Wired up in Batch 2 — currently undo is disabled UI-side.)
export interface UndoReqMsg extends BaseMsg {
  t: 'undo_req';
  n: number;
}
export interface UndoAckMsg extends BaseMsg {
  t: 'undo_ack';
  n: number;
  ok: boolean;
}

// Restart current game. Batch 2 will swap this for draw/rematch with
// mutual consent. For now, one side's reset auto-accepts on the other.
export interface ResetReqMsg extends BaseMsg {
  t: 'reset_req';
}
export interface ResetAckMsg extends BaseMsg {
  t: 'reset_ack';
  ok: boolean;
}

// Client → server heartbeat. Relay eats it (doesn't forward); it only
// exists to reset the relay's idleTimeout so browsers that suspend
// background tabs don't get their WS garbage-collected on the server.
export interface PingMsg extends BaseMsg {
  t: 'ping';
}

export type PeerMsg =
  | AssignMsg
  | MoveMsg
  | UndoReqMsg
  | UndoAckMsg
  | ResetReqMsg
  | ResetAckMsg
  | PingMsg;

// Room numbers are exactly 4 digits — WeChat-style. Users pick their own
// and share by voice/text; there's no identity, just the number.
const ROOM_RE = /^\d{4}$/;

export function isValidRoomId(s: string): boolean {
  return ROOM_RE.test(s);
}
