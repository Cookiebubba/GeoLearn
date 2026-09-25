import { randomInt } from 'node:crypto';
import type { OpenRoomSummary, RoomSettings } from '@geolearn/shared/game/types';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@geolearn/shared/protocol';
import { Room, type RoomDeps } from './room';

/** Rooms with nobody connected are closed after this long. */
const EMPTY_ROOM_TTL_MS = 3 * 60_000;
/** Any room idle this long is closed. */
const IDLE_ROOM_TTL_MS = 2 * 60 * 60_000;

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(private readonly deps: RoomDeps) {
    this.timer = setInterval(() => this.sweep(), 10_000);
    this.timer.unref?.();
  }

  create(settings: RoomSettings): Room {
    let code = '';
    do {
      code = Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const room = new Room(code, settings, this.deps);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  get size(): number {
    return this.rooms.size;
  }

  onlinePlayers(): number {
    let n = 0;
    for (const r of this.rooms.values()) n += r.connectedCount;
    return n;
  }

  openRooms(): OpenRoomSummary[] {
    const out: OpenRoomSummary[] = [];
    for (const r of this.rooms.values()) {
      if (!r.settings.isPublic || r.settings.partySize === 1) continue;
      if (r.status === 'finished') continue;
      if (r.slots.size >= r.settings.partySize || r.connectedCount === 0) continue;
      out.push({
        code: r.code,
        puzzleId: r.settings.puzzleId,
        mode: r.settings.mode,
        partySize: r.settings.partySize,
        players: r.slots.size,
        host: r.host?.info.name ?? '',
        status: r.status,
      });
    }
    return out.sort((a, b) => (a.status === 'lobby' ? 0 : 1) - (b.status === 'lobby' ? 0 : 1));
  }

  sweep(now = this.deps.now()) {
    for (const [code, room] of this.rooms) {
      room.sweep(now);
      const empty = room.connectedCount === 0 && now - room.lastActivity > EMPTY_ROOM_TTL_MS;
      const stale = now - room.lastActivity > IDLE_ROOM_TTL_MS;
      if (room.slots.size === 0 || empty || stale) {
        room.dispose();
        this.rooms.delete(code);
      }
    }
  }

  close() {
    clearInterval(this.timer);
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
  }
}
