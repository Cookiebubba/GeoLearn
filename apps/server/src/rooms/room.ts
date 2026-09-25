import type { WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import { GameEngine } from '@geolearn/shared/game/engine';
import { validModes } from '@geolearn/shared/game/rules';
import {
  emptyStats,
  type GameResults,
  type GrabMode,
  type PlayerInfo,
  type RoomSettings,
  type RoomSnapshot,
  type RoomStatus,
} from '@geolearn/shared/game/types';
import type { ErrorCode, ServerMsg } from '@geolearn/shared/protocol';
import type { PuzzleLibrary } from '../puzzles';
import type { ResultsStore } from '../results';

export const COUNTDOWN_MS = 3000;
/** How long a dropped connection keeps its seat. */
export const GRACE_LOBBY_MS = 45_000;
export const GRACE_GAME_MS = 180_000;

export interface Slot {
  info: PlayerInfo;
  dbId: string | null;
  session: string;
  socket: WebSocket | null;
  joinedAt: number;
  disconnectedAt: number | null;
  /** The player's screen shape (width / height), used to lay out the table. */
  aspect: number | null;
}

interface Participant {
  id: string;
  name: string;
  color: number;
  team: number;
  dbId: string | null;
}

export interface RoomDeps {
  puzzles: PuzzleLibrary;
  results: ResultsStore | null;
  log: { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void; error: (o: object, m?: string) => void };
  now: () => number;
}

export class RoomError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

let playerSeq = 0;
const newPlayerId = () => `p${(++playerSeq).toString(36)}${randomBytes(3).toString('hex')}`;

export class Room {
  status: RoomStatus = 'lobby';
  readonly slots = new Map<string, Slot>();
  engine: GameEngine | null = null;
  countdownEndsAt: number | null = null;
  startedAt: number | null = null;
  finishedAt: number | null = null;
  results: GameResults | null = null;
  lastActivity: number;
  readonly createdAt: number;
  private participants = new Map<string, Participant>();
  private readonly banned = new Set<string>();
  private countdownTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly code: string,
    public settings: RoomSettings,
    private readonly deps: RoomDeps,
  ) {
    this.createdAt = deps.now();
    this.lastActivity = this.createdAt;
  }

  // ── Membership ─────────────────────────────────────────────────────────

  get connectedCount(): number {
    let n = 0;
    for (const s of this.slots.values()) if (s.socket) n++;
    return n;
  }

  get host(): Slot | undefined {
    for (const s of this.slots.values()) if (s.info.host) return s;
    return undefined;
  }

  findSlotForReconnect(session: string | undefined, dbId: string | null): Slot | undefined {
    for (const s of this.slots.values()) {
      if (session && s.session === session) return s;
    }
    if (dbId) for (const s of this.slots.values()) if (s.dbId === dbId) return s;
    return undefined;
  }

  canJoin(dbId: string | null): void {
    if (dbId && this.banned.has(dbId)) throw new RoomError('not-allowed', 'You were removed from this room');
    if (this.slots.size >= this.settings.partySize) throw new RoomError('room-full', 'This room is full');
    if (this.status === 'finished') {
      // Joining a finished room drops you into the results → rematch lobby flow.
      return;
    }
  }

  addPlayer(name: string, dbId: string | null, socket: WebSocket, aspect?: number): Slot {
    this.canJoin(dbId);
    const usedColors = new Set([...this.slots.values()].map((s) => s.info.color));
    const color = [0, 1, 2, 3].find((c) => !usedColors.has(c)) ?? 0;
    const teamCounts = [0, 0];
    for (const s of this.slots.values()) teamCounts[s.info.team]++;
    const team = this.settings.mode === 'teams' ? (teamCounts[0] <= teamCounts[1] ? 0 : 1) : 0;
    const slot: Slot = {
      info: {
        id: newPlayerId(),
        name,
        color,
        team,
        connected: true,
        host: this.slots.size === 0,
        stats: emptyStats(),
      },
      dbId,
      session: randomBytes(16).toString('hex'),
      socket,
      joinedAt: this.deps.now(),
      disconnectedAt: null,
      aspect: aspect ?? null,
    };
    this.slots.set(slot.info.id, slot);
    if (this.engine && (this.status === 'playing' || this.status === 'countdown')) {
      this.engine.ensurePlayer(slot.info.id, team);
      this.participants.set(slot.info.id, { id: slot.info.id, name, color, team, dbId });
    }
    this.touch();
    this.sendWelcome(slot);
    this.broadcastRoom(slot.info.id);
    return slot;
  }

  reattach(slot: Slot, socket: WebSocket, name: string, aspect?: number) {
    const old = slot.socket;
    if (aspect) slot.aspect = aspect;
    slot.socket = socket;
    slot.disconnectedAt = null;
    slot.info.connected = true;
    slot.info.name = name;
    if (old && old !== socket) {
      this.sendTo(old, { t: 'left', reason: 'closed' });
      old.close(4000, 'replaced');
    }
    if (!this.host) slot.info.host = true;
    this.touch();
    this.sendWelcome(slot);
    this.broadcastRoom(slot.info.id);
  }

  /** Socket closed: keep the seat for a while, let go of any held piece. */
  disconnect(playerId: string, socket: WebSocket) {
    const slot = this.slots.get(playerId);
    if (!slot || slot.socket !== socket) return;
    slot.socket = null;
    slot.info.connected = false;
    slot.disconnectedAt = this.deps.now();
    this.releaseHeld(playerId);
    this.broadcast({ t: 'cursor', id: playerId, x: null, y: null }, playerId);
    if (slot.info.host) this.handOverHost(playerId);
    this.broadcastPlayers();
  }

  leave(playerId: string) {
    const slot = this.slots.get(playerId);
    if (!slot) return;
    this.releaseHeld(playerId);
    this.slots.delete(playerId);
    if (slot.socket) {
      this.sendTo(slot.socket, { t: 'left', reason: 'closed' });
    }
    if (slot.info.host) this.handOverHost(playerId);
    this.broadcast({ t: 'cursor', id: playerId, x: null, y: null });
    this.touch();
    this.broadcastRoom();
  }

  kick(byId: string, targetId: string) {
    this.requireHost(byId);
    if (byId === targetId) return;
    const slot = this.slots.get(targetId);
    if (!slot) return;
    if (slot.dbId) this.banned.add(slot.dbId);
    const socket = slot.socket;
    this.leave(targetId);
    if (socket) {
      this.sendTo(socket, { t: 'left', reason: 'kicked' });
      socket.close(4001, 'kicked');
    }
  }

  /** Removes seats whose owners have been gone longer than the grace period. */
  sweep(now: number) {
    const grace = this.status === 'lobby' || this.status === 'finished' ? GRACE_LOBBY_MS : GRACE_GAME_MS;
    for (const slot of [...this.slots.values()]) {
      if (!slot.socket && slot.disconnectedAt !== null && now - slot.disconnectedAt > grace) this.leave(slot.info.id);
    }
  }

  private handOverHost(fromId: string) {
    const from = this.slots.get(fromId);
    const candidates = [...this.slots.values()].filter((s) => s.info.id !== fromId).sort((a, b) => a.joinedAt - b.joinedAt);
    const next = candidates.find((s) => s.socket) ?? candidates[0];
    if (!next) return;
    if (from) from.info.host = false;
    next.info.host = true;
  }

  private requireHost(playerId: string) {
    if (!this.slots.get(playerId)?.info.host) throw new RoomError('not-host', 'Only the host can do that');
  }

  // ── Lobby ──────────────────────────────────────────────────────────────

  updateSettings(byId: string, settings: RoomSettings) {
    this.requireHost(byId);
    if (this.status !== 'lobby') throw new RoomError('not-allowed', 'Settings are locked during a game');
    if (settings.partySize < this.slots.size) throw new RoomError('not-allowed', 'Too many players for that party size');
    if (!validModes(settings.partySize).includes(settings.mode)) throw new RoomError('bad-request', 'That mode needs more players');
    const modeChanged = settings.mode !== this.settings.mode;
    this.settings = { ...settings };
    if (modeChanged) this.rebalanceTeams();
    this.touch();
    this.broadcastRoom();
  }

  setTeam(byId: string, targetId: string, team: number) {
    if (this.status !== 'lobby' || this.settings.mode !== 'teams') return;
    if (byId !== targetId) this.requireHost(byId);
    const slot = this.slots.get(targetId);
    if (!slot || (team !== 0 && team !== 1)) return;
    slot.info.team = team;
    this.broadcastRoom();
  }

  private rebalanceTeams() {
    const ordered = [...this.slots.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    ordered.forEach((s, i) => (s.info.team = this.settings.mode === 'teams' ? i % 2 : 0));
  }

  start(byId: string) {
    this.requireHost(byId);
    if (this.status !== 'lobby') throw new RoomError('not-allowed', 'The game has already started');
    const players = [...this.slots.values()];
    if (this.settings.mode !== 'coop' && players.length < 2) {
      throw new RoomError('not-allowed', 'Versus needs at least two players');
    }
    if (this.settings.mode === 'teams') {
      const teams = new Set(players.map((p) => p.info.team));
      if (teams.size < 2) throw new RoomError('not-allowed', 'Both teams need a player');
    }
    const model = this.deps.puzzles.get(this.settings.puzzleId);
    const seed = randomBytes(4).readUInt32LE(0);
    // Lay the table out for everyone's screens: geometric mean of their shapes.
    const aspects = players.map((p) => p.aspect).filter((a): a is number => !!a && a > 0);
    const aspect = aspects.length ? Math.exp(aspects.reduce((n, a) => n + Math.log(a), 0) / aspects.length) : undefined;
    this.engine = new GameEngine(model, this.settings, seed, aspect);
    this.participants = new Map();
    for (const s of players) {
      s.info.stats = emptyStats();
      this.engine.ensurePlayer(s.info.id, s.info.team);
      this.participants.set(s.info.id, { id: s.info.id, name: s.info.name, color: s.info.color, team: s.info.team, dbId: s.dbId });
    }
    this.results = null;
    this.finishedAt = null;
    this.startedAt = null;
    this.status = 'countdown';
    this.countdownEndsAt = this.deps.now() + COUNTDOWN_MS;
    this.touch();
    this.broadcastRoom();
    this.countdownTimer = setTimeout(() => {
      this.countdownTimer = null;
      if (this.status !== 'countdown') return;
      this.status = 'playing';
      this.startedAt = this.deps.now();
      this.countdownEndsAt = null;
      this.broadcastRoom();
    }, COUNTDOWN_MS);
    this.deps.log.info({ room: this.code, puzzle: this.settings.puzzleId, mode: this.settings.mode, players: players.length }, 'game started');
  }

  rematch(byId: string) {
    this.requireHost(byId);
    if (this.status !== 'finished') throw new RoomError('not-allowed', 'Finish this game first');
    this.status = 'lobby';
    this.engine = null;
    this.results = null;
    this.startedAt = null;
    this.finishedAt = null;
    for (const s of this.slots.values()) s.info.stats = emptyStats();
    this.touch();
    this.broadcastRoom();
  }

  // ── Play ───────────────────────────────────────────────────────────────

  private get playable(): GameEngine | null {
    return this.status === 'playing' ? this.engine : null;
  }

  grab(playerId: string, pieceId: string, mode: GrabMode) {
    const engine = this.playable;
    const slot = this.slots.get(playerId);
    if (!engine || !slot) return;
    const previous = engine.heldBy(playerId);
    if (engine.grab(playerId, pieceId, mode)) {
      if (previous && previous.id !== pieceId) {
        this.broadcast({ t: 'dropped', p: previous.id, x: previous.x, y: previous.y, z: previous.z, by: playerId, placed: false, miss: false, points: 0 });
      }
      this.broadcast({ t: 'grabbed', p: pieceId, by: playerId, m: mode });
      this.touch();
    } else if (slot.socket) {
      this.sendTo(slot.socket, { t: 'denied', p: pieceId });
    }
  }

  move(playerId: string, pieceId: string, x: number, y: number) {
    const engine = this.playable;
    if (!engine) return;
    const pos = engine.move(playerId, pieceId, x, y);
    if (pos) this.broadcast({ t: 'moved', p: pieceId, x: pos[0], y: pos[1], by: playerId }, playerId);
  }

  drop(playerId: string, pieceId: string, x: number, y: number, zoom: number) {
    const engine = this.playable;
    if (!engine) return;
    const out = engine.drop(playerId, pieceId, x, y, zoom);
    if (!out) return;
    this.touch();
    this.broadcast({ t: 'dropped', p: pieceId, x: out.x, y: out.y, z: out.z, by: playerId, placed: out.placed, miss: out.miss, points: out.points });
    if (out.placed || out.miss) {
      const slot = this.slots.get(playerId);
      const stats = engine.stats.get(playerId);
      if (slot && stats) slot.info.stats = { ...stats };
      this.broadcastPlayers();
    }
    if (engine.complete) void this.finish();
  }

  cursor(playerId: string, x: number | null, y: number | null) {
    if (this.status !== 'playing' && this.status !== 'countdown') return;
    this.broadcast({ t: 'cursor', id: playerId, x, y }, playerId);
  }

  private releaseHeld(playerId: string) {
    if (!this.engine) return;
    for (const p of this.engine.release(playerId)) {
      this.broadcast({ t: 'dropped', p: p.id, x: p.x, y: p.y, z: p.z, by: playerId, placed: false, miss: false, points: 0 });
    }
  }

  private async finish() {
    const engine = this.engine;
    if (!engine || this.status !== 'playing') return;
    this.status = 'finished';
    this.finishedAt = this.deps.now();
    const startedAt = this.startedAt ?? this.finishedAt;
    const players: PlayerInfo[] = [...this.participants.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      team: p.team,
      connected: this.slots.get(p.id)?.socket != null,
      host: this.slots.get(p.id)?.info.host ?? false,
      stats: engine.stats.get(p.id) ?? emptyStats(),
    }));
    const results = engine.results(players, this.finishedAt - startedAt);
    this.results = results;
    this.broadcast({ t: 'finished', results, now: this.deps.now() });
    this.deps.log.info({ room: this.code, puzzle: results.puzzleId, ms: results.durationMs, players: results.playerCount }, 'game finished');
    if (this.deps.results) {
      try {
        const placements = await this.deps.results.save(
          this.code,
          results,
          startedAt,
          [...this.participants.values()].map((p) => ({ playerId: p.dbId, name: p.name })),
        );
        if (this.results === results) {
          results.leaderboard = placements;
          this.broadcastRoom();
        }
      } catch (err) {
        this.deps.log.error({ err, room: this.code }, 'failed to save results');
      }
    }
  }

  // ── Snapshots & messaging ──────────────────────────────────────────────

  snapshot(): RoomSnapshot {
    return {
      code: this.code,
      settings: this.settings,
      status: this.status,
      players: [...this.slots.values()].sort((a, b) => a.joinedAt - b.joinedAt).map((s) => ({ ...s.info })),
      game: this.engine ? this.engine.snapshot(this.startedAt, this.finishedAt) : null,
      countdownEndsAt: this.countdownEndsAt,
      results: this.results,
    };
  }

  private sendWelcome(slot: Slot) {
    if (!slot.socket) return;
    this.sendTo(slot.socket, { t: 'welcome', you: slot.info.id, session: slot.session, room: this.snapshot(), now: this.deps.now() });
  }

  broadcastRoom(exceptId?: string) {
    const room = this.snapshot();
    this.broadcast({ t: 'room', room, now: this.deps.now() }, exceptId);
  }

  broadcastPlayers() {
    const players = [...this.slots.values()].sort((a, b) => a.joinedAt - b.joinedAt).map((s) => ({ ...s.info }));
    this.broadcast({ t: 'players', players });
  }

  broadcast(msg: ServerMsg, exceptId?: string) {
    const data = JSON.stringify(msg);
    for (const s of this.slots.values()) {
      if (s.info.id === exceptId || !s.socket) continue;
      if (s.socket.readyState === 1) s.socket.send(data);
    }
  }

  sendTo(socket: WebSocket, msg: ServerMsg) {
    if (socket.readyState === 1) socket.send(JSON.stringify(msg));
  }

  touch() {
    this.lastActivity = this.deps.now();
  }

  dispose() {
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    for (const s of this.slots.values()) {
      if (s.socket) {
        this.sendTo(s.socket, { t: 'left', reason: 'closed' });
        s.socket.close(4002, 'room closed');
      }
    }
    this.slots.clear();
  }
}
