import {
  buildPuzzleModel,
  emptyStats,
  GameEngine,
  type ClientMsg,
  type PlayerInfo,
  type PuzzleModel,
  type RoomSettings,
  type RoomSnapshot,
  type RoomStatus,
  type ServerMsg,
} from '@geolearn/shared';
import { loadPuzzle } from '../app/api';

const COUNTDOWN_MS = 3000;

/**
 * A tiny in-browser stand-in for the game server, used for solo play when the
 * server can't be reached. Same messages, same rules (shared GameEngine).
 */
export class LocalServer {
  private readonly player: PlayerInfo;
  private status: RoomStatus = 'lobby';
  private engine: GameEngine | null = null;
  private model: PuzzleModel | null = null;
  private startedAt: number | null = null;
  private finishedAt: number | null = null;
  private countdownEndsAt: number | null = null;
  private results: RoomSnapshot['results'] = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private queue: ClientMsg[] = [];
  private disposed = false;

  constructor(
    name: string,
    private readonly settings: RoomSettings,
    private readonly deliver: (msg: ServerMsg) => void,
    private readonly aspect?: number,
  ) {
    this.player = { id: 'local', name, color: 0, team: 0, connected: true, host: true, stats: emptyStats() };
    void loadPuzzle(settings.puzzleId).then((data) => {
      if (this.disposed) return;
      this.model = buildPuzzleModel(data);
      for (const m of this.queue.splice(0)) this.handle(m);
    });
  }

  dispose() {
    this.disposed = true;
    for (const t of this.timers) clearTimeout(t);
  }

  private emit(msg: ServerMsg) {
    // Async, like a network, so callers never re-enter themselves.
    queueMicrotask(() => {
      if (!this.disposed) this.deliver(msg);
    });
  }

  private snapshot(): RoomSnapshot {
    return {
      code: 'SOLO',
      settings: this.settings,
      status: this.status,
      players: [{ ...this.player }],
      game: this.engine ? this.engine.snapshot(this.startedAt, this.finishedAt) : null,
      countdownEndsAt: this.countdownEndsAt,
      results: this.results,
    };
  }

  handle(msg: ClientMsg) {
    if (msg.t === 'ping') {
      this.emit({ t: 'pong', c: msg.c, s: Date.now() });
      return;
    }
    if (!this.model) {
      this.queue.push(msg);
      return;
    }
    const me = this.player.id;
    switch (msg.t) {
      case 'create':
      case 'join':
        this.emit({ t: 'welcome', you: me, session: 'local', room: this.snapshot(), now: Date.now() });
        break;
      case 'start':
      case 'rematch': {
        this.engine = new GameEngine(this.model, this.settings, (Math.random() * 2 ** 32) >>> 0, this.aspect);
        this.engine.ensurePlayer(me, 0);
        this.player.stats = emptyStats();
        this.results = null;
        this.startedAt = null;
        this.finishedAt = null;
        this.status = 'countdown';
        this.countdownEndsAt = Date.now() + COUNTDOWN_MS;
        this.emit({ t: 'room', room: this.snapshot(), now: Date.now() });
        this.timers.push(
          setTimeout(() => {
            this.status = 'playing';
            this.startedAt = Date.now();
            this.countdownEndsAt = null;
            this.emit({ t: 'room', room: this.snapshot(), now: Date.now() });
          }, COUNTDOWN_MS),
        );
        break;
      }
      case 'grab':
        if (this.status !== 'playing' || !this.engine) return;
        if (this.engine.grab(me, msg.p, msg.m)) this.emit({ t: 'grabbed', p: msg.p, by: me, m: msg.m });
        else this.emit({ t: 'denied', p: msg.p });
        break;
      case 'move':
        this.engine?.move(me, msg.p, msg.x, msg.y);
        break;
      case 'drop': {
        if (this.status !== 'playing' || !this.engine) return;
        const out = this.engine.drop(me, msg.p, msg.x, msg.y, msg.z);
        if (!out) return;
        this.emit({ t: 'dropped', p: msg.p, x: out.x, y: out.y, z: out.z, by: me, placed: out.placed, miss: out.miss, points: out.points });
        if (out.placed || out.miss) {
          this.player.stats = { ...this.engine.stats.get(me)! };
          this.emit({ t: 'players', players: [{ ...this.player }] });
        }
        if (this.engine.complete) {
          this.status = 'finished';
          this.finishedAt = Date.now();
          this.results = this.engine.results([{ ...this.player }], this.finishedAt - (this.startedAt ?? this.finishedAt));
          this.emit({ t: 'finished', results: this.results, now: Date.now() });
        }
        break;
      }
      default:
        break;
    }
  }
}
