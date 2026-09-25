import type {
  GameResults,
  GrabMode,
  PlayerInfo,
  RoomSettings,
  RoomSnapshot,
} from './game/types';

export const PROTOCOL_VERSION = 1;

/** Messages the browser sends over the WebSocket. */
export type ClientMsg =
  | { t: 'create'; name: string; token: string; settings: RoomSettings }
  | { t: 'join'; name: string; token: string; code: string; session?: string }
  | { t: 'leave' }
  | { t: 'settings'; settings: RoomSettings }
  | { t: 'start' }
  | { t: 'rematch' }
  | { t: 'kick'; id: string }
  | { t: 'team'; id: string; team: number }
  | { t: 'grab'; p: string; m: GrabMode }
  | { t: 'move'; p: string; x: number; y: number }
  | { t: 'drop'; p: string; x: number; y: number; z: number }
  | { t: 'cursor'; x: number | null; y: number | null }
  | { t: 'ping'; c: number };

/** Messages the server sends. */
export type ServerMsg =
  | { t: 'welcome'; you: string; session: string; room: RoomSnapshot; now: number }
  | { t: 'room'; room: RoomSnapshot; now: number }
  | { t: 'players'; players: PlayerInfo[] }
  | { t: 'grabbed'; p: string; by: string; m: GrabMode }
  | { t: 'denied'; p: string }
  | { t: 'moved'; p: string; x: number; y: number; by: string }
  | {
      t: 'dropped';
      p: string;
      x: number;
      y: number;
      z: number;
      by: string;
      placed: boolean;
      miss: boolean;
      points: number;
    }
  | { t: 'cursor'; id: string; x: number | null; y: number | null }
  | { t: 'finished'; results: GameResults; now: number }
  | { t: 'pong'; c: number; s: number }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'left'; reason: 'kicked' | 'closed' };

export type ErrorCode =
  | 'bad-request'
  | 'name-taken'
  | 'name-invalid'
  | 'room-not-found'
  | 'room-full'
  | 'not-host'
  | 'not-allowed'
  | 'rate-limited'
  | 'server';

export const NAME_RULES = {
  min: 2,
  max: 20,
  pattern: /^[\p{L}\p{N}_\-. ]+$/u,
};

export function normalizeName(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export function validateName(raw: string): string | null {
  const name = normalizeName(raw);
  if (name.length < NAME_RULES.min) return `At least ${NAME_RULES.min} characters`;
  if (name.length > NAME_RULES.max) return `At most ${NAME_RULES.max} characters`;
  if (!NAME_RULES.pattern.test(name)) return 'Letters, numbers, spaces, - _ . only';
  return null;
}

/** Room codes avoid easily-confused characters (no 0/O, 1/I/L). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;

export function normalizeRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH);
}
