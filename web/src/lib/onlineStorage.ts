// Browser-local identity and game persistence for online play.
//
// The relay keys room seats by `peerId`, a random 128-bit token minted once
// per browser and kept in localStorage. That is what lets a refresh, a
// dropped network, or closing the tab and reopening the invite link land
// back in the same seat. It is not an account: another browser or device
// is another player, and two tabs of one browser are the same player (the
// newer tab takes over the seat).

import type { ClockSnapshot, GameResult, TimeControl } from '@/game/peer-protocol';
import type { Stone } from '@/game/types';

const PEER_KEY = 'gomind.peerId';
const SESSION_KEY = 'gomind.online.session';
const CREATE_PREFS_KEY = 'gomind.online.createPrefs';
// The relay holds a dropped seat for 90s, so anything older is certainly gone.
const SESSION_MAX_AGE_MS = 3 * 60_000;

const store = (): Storage | null => (typeof window === 'undefined' ? null : window.localStorage);

export function getPeerId(): string {
  const s = store();
  if (!s) return 'ssr-placeholder';
  let id = s.getItem(PEER_KEY);
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = crypto.randomUUID().replace(/-/g, '');
    s.setItem(PEER_KEY, id);
  }
  return id;
}

/** Everything needed to redraw the game after a refresh, before the opponent's sync. */
export interface SavedSession {
  roomId: string;
  role: 'host' | 'guest' | null;
  hostSide: Stone;
  timeControl: TimeControl;
  started: boolean;
  history: [number, number][];
  clocks: ClockSnapshot;
  result: GameResult | null;
}

export function saveSession(sess: SavedSession): void {
  try {
    store()?.setItem(SESSION_KEY, JSON.stringify({ ...sess, savedAt: Date.now() }));
  } catch {
    // Storage full or disabled: persistence is best-effort.
  }
}

/** The last game this browser was in, if it may still be running. */
export function loadSession(): SavedSession | null {
  try {
    const raw = store()?.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedSession & { savedAt?: number };
    if (!s || typeof s.roomId !== 'string' || !Array.isArray(s.history)) return null;
    if (!s.savedAt || Date.now() - s.savedAt > SESSION_MAX_AGE_MS) {
      clearSession();
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  store()?.removeItem(SESSION_KEY);
}

/** Last settings used on the create-room card. */
export interface CreatePrefs {
  side: Stone;
  timeControl: TimeControl;
}

export function loadCreatePrefs(): CreatePrefs | null {
  try {
    const raw = store()?.getItem(CREATE_PREFS_KEY);
    return raw ? (JSON.parse(raw) as CreatePrefs) : null;
  } catch {
    return null;
  }
}

export function saveCreatePrefs(p: CreatePrefs): void {
  try {
    store()?.setItem(CREATE_PREFS_KEY, JSON.stringify(p));
  } catch {}
}
