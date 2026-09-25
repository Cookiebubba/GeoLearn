import type { WebSocket } from 'ws';
import { z } from 'zod';
import { isPuzzleId } from '@geolearn/shared/puzzles';
import { validModes } from '@geolearn/shared/game/rules';
import type { RoomSettings } from '@geolearn/shared/game/types';
import { normalizeRoomCode, type ErrorCode, type ServerMsg } from '@geolearn/shared/protocol';
import type { PlayerDirectory } from '../players';
import type { RoomManager } from './manager';
import { RoomError, type Room } from './room';

const num = z.number().finite().min(-1e5).max(1e5);

const settingsSchema = z
  .object({
    puzzleId: z.string().refine(isPuzzleId, 'unknown puzzle'),
    mode: z.enum(['coop', 'versus', 'teams']),
    partySize: z.union([z.literal(1), z.literal(2), z.literal(4)]),
    isPublic: z.boolean(),
  })
  .refine((s) => validModes(s.partySize).includes(s.mode), 'mode not available for this party size');

const identity = { name: z.string().max(64), token: z.string().min(16).max(128) };

const clientMsg = z.discriminatedUnion('t', [
  z.object({ t: z.literal('create'), ...identity, settings: settingsSchema }),
  z.object({ t: z.literal('join'), ...identity, code: z.string().max(12), session: z.string().max(64).optional() }),
  z.object({ t: z.literal('leave') }),
  z.object({ t: z.literal('settings'), settings: settingsSchema }),
  z.object({ t: z.literal('start') }),
  z.object({ t: z.literal('rematch') }),
  z.object({ t: z.literal('kick'), id: z.string().max(40) }),
  z.object({ t: z.literal('team'), id: z.string().max(40), team: z.number().int().min(0).max(1) }),
  z.object({ t: z.literal('grab'), p: z.string().max(8), m: z.enum(['lift', 'slide']) }),
  z.object({ t: z.literal('move'), p: z.string().max(8), x: num, y: num }),
  z.object({ t: z.literal('drop'), p: z.string().max(8), x: num, y: num, z: z.number().finite().min(0).max(1000) }),
  z.object({ t: z.literal('cursor'), x: num.nullable(), y: num.nullable() }),
  z.object({ t: z.literal('ping'), c: z.number().finite() }),
]);

type ClientMsg = z.infer<typeof clientMsg>;

/** Token bucket: sustained `rate` messages per second, bursts up to `burst`. */
class Bucket {
  private tokens: number;
  private last = Date.now();
  constructor(
    private readonly rate: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export interface ConnectionDeps {
  rooms: RoomManager;
  players: PlayerDirectory | null;
  now: () => number;
  log: { warn: (o: object, m?: string) => void };
}

/** Wires one WebSocket to the room it creates or joins. */
export function handleConnection(socket: WebSocket, deps: ConnectionDeps) {
  let seat: { room: Room; playerId: string } | null = null;
  let queue: Promise<void> = Promise.resolve();
  const bucket = new Bucket(90, 180);
  let alive = true;

  const send = (msg: ServerMsg) => {
    if (socket.readyState === 1) socket.send(JSON.stringify(msg));
  };
  const fail = (code: ErrorCode, message: string) => send({ t: 'error', code, message });

  socket.on('pong', () => (alive = true));
  const heartbeat = setInterval(() => {
    if (!alive) {
      socket.terminate();
      return;
    }
    alive = false;
    try {
      socket.ping();
    } catch {
      /* socket already closing */
    }
  }, 20_000);

  async function identify(name: string, token: string): Promise<{ name: string; dbId: string | null } | null> {
    if (!deps.players) return { name: name.trim().slice(0, 20), dbId: null };
    const claim = await deps.players.claim(name, token);
    if (!claim.ok) {
      fail(claim.code, claim.message);
      return null;
    }
    return { name: claim.name, dbId: claim.id };
  }

  async function handle(msg: ClientMsg) {
    switch (msg.t) {
      case 'ping':
        send({ t: 'pong', c: msg.c, s: deps.now() });
        return;
      case 'create': {
        const who = await identify(msg.name, msg.token);
        if (!who) return;
        if (seat) seat.room.leave(seat.playerId);
        const settings: RoomSettings = { ...(msg.settings as RoomSettings) };
        if (settings.partySize === 1) settings.isPublic = false;
        const room = deps.rooms.create(settings);
        const slot = room.addPlayer(who.name, who.dbId, socket);
        seat = { room, playerId: slot.info.id };
        return;
      }
      case 'join': {
        const who = await identify(msg.name, msg.token);
        if (!who) return;
        const room = deps.rooms.get(normalizeRoomCode(msg.code));
        if (!room) {
          fail('room-not-found', 'No room with that code');
          return;
        }
        if (seat && seat.room !== room) seat.room.leave(seat.playerId);
        const existing = room.findSlotForReconnect(msg.session, who.dbId);
        if (existing) {
          room.reattach(existing, socket, who.name);
          seat = { room, playerId: existing.info.id };
        } else {
          const slot = room.addPlayer(who.name, who.dbId, socket);
          seat = { room, playerId: slot.info.id };
        }
        return;
      }
    }

    if (!seat) {
      fail('bad-request', 'Join a room first');
      return;
    }
    const { room, playerId } = seat;
    switch (msg.t) {
      case 'leave':
        room.leave(playerId);
        seat = null;
        return;
      case 'settings':
        room.updateSettings(playerId, msg.settings as RoomSettings);
        return;
      case 'start':
        room.start(playerId);
        return;
      case 'rematch':
        room.rematch(playerId);
        return;
      case 'kick':
        room.kick(playerId, msg.id);
        return;
      case 'team':
        room.setTeam(playerId, msg.id, msg.team);
        return;
      case 'grab':
        room.grab(playerId, msg.p, msg.m);
        return;
      case 'move':
        room.move(playerId, msg.p, msg.x, msg.y);
        return;
      case 'drop':
        room.drop(playerId, msg.p, msg.x, msg.y, msg.z);
        return;
      case 'cursor':
        room.cursor(playerId, msg.x, msg.y);
        return;
    }
  }

  socket.on('message', (raw: Buffer, isBinary: boolean) => {
    if (isBinary) return;
    if (!bucket.take()) return;
    let msg: ClientMsg;
    try {
      msg = clientMsg.parse(JSON.parse(raw.toString('utf8')));
    } catch {
      fail('bad-request', 'Malformed message');
      return;
    }
    queue = queue
      .then(() => handle(msg))
      .catch((err: unknown) => {
        if (err instanceof RoomError) fail(err.code, err.message);
        else {
          deps.log.warn({ err }, 'message handling failed');
          fail('server', 'Something went wrong');
        }
      });
  });

  socket.on('close', () => {
    clearInterval(heartbeat);
    if (seat) seat.room.disconnect(seat.playerId, socket);
    seat = null;
  });
  socket.on('error', () => socket.terminate());
}
