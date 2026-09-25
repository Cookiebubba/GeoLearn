import { create } from 'zustand';
import type { ClientMsg, GameResults, GrabMode, RoomSettings, RoomSnapshot, ServerMsg } from '@geolearn/shared';
import { LocalServer } from './localServer';

export type ConnState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface RoomStoreState {
  conn: ConnState;
  you: string | null;
  room: RoomSnapshot | null;
  error: { code: string; message: string; at: number } | null;
  left: 'kicked' | 'closed' | null;
  offline: boolean;
  /** Bumps whenever the game snapshot is replaced wholesale (start, reconnect). */
  gameEpoch: number;
}

export const useRoomStore = create<RoomStoreState>(() => ({
  conn: 'idle',
  you: null,
  room: null,
  error: null,
  left: null,
  offline: false,
  gameEpoch: 0,
}));

/** Real-time game events, delivered straight to the puzzle engine (not React). */
export interface GameListener {
  onGrabbed(p: string, by: string, m: GrabMode): void;
  onDenied(p: string): void;
  onMoved(p: string, x: number, y: number, by: string): void;
  onDropped(p: string, x: number, y: number, z: number, by: string, placed: boolean, miss: boolean, points: number): void;
  onCursor(id: string, x: number | null, y: number | null): void;
  onFinished?(results: GameResults): void;
}

const SESSION_KEY = (code: string) => `geolearn.session.${code}`;

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

/** The usable screen shape; the server lays the table out to suit it. */
function screenAspect(): number {
  const w = window.innerWidth || 1;
  const h = Math.max(1, (window.innerHeight || 1) - 70);
  return Math.round((w / h) * 1000) / 1000;
}

function readSession(code: string): string | undefined {
  try {
    return window.sessionStorage.getItem(SESSION_KEY(code)) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeSession(code: string, session: string) {
  try {
    window.sessionStorage.setItem(SESSION_KEY(code), session);
  } catch {
    /* private mode */
  }
}

/**
 * One connection to one room. Reconnects on its own (keeping your seat via a
 * session token), keeps a server clock estimate, and falls back to a local,
 * in-browser game for solo play when the server can't be reached.
 */
class RoomClient {
  private ws: WebSocket | null = null;
  private hello: ClientMsg | null = null;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private listener: GameListener | null = null;
  private offset = 0;
  private bestRtt = Infinity;
  private closedByUs = false;
  private local: LocalServer | null = null;
  private soloFallback: RoomSettings | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private outbox: ClientMsg[] = [];

  setListener(l: GameListener | null) {
    this.listener = l;
  }

  /** Estimated server clock (ms since epoch). */
  serverNow(): number {
    return Date.now() + this.offset;
  }

  get isOffline() {
    return !!this.local;
  }

  create(name: string, token: string, settings: RoomSettings) {
    this.reset();
    this.soloFallback = settings.partySize === 1 ? settings : null;
    this.open({ t: 'create', name, token, settings, aspect: screenAspect() });
  }

  join(name: string, token: string, code: string) {
    this.reset();
    this.open({ t: 'join', name, token, code, session: readSession(code), aspect: screenAspect() });
  }

  send(msg: ClientMsg) {
    if (this.local) {
      this.local.handle(msg);
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else if (msg.t !== 'move' && msg.t !== 'cursor' && msg.t !== 'ping') this.outbox.push(msg);
  }

  leave() {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'leave' } satisfies ClientMsg));
    this.reset();
    useRoomStore.setState({ conn: 'idle', you: null, room: null, error: null, left: null, offline: false });
  }

  private reset() {
    this.closedByUs = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.retryTimer = this.pingTimer = this.fallbackTimer = null;
    this.ws?.close();
    this.ws = null;
    this.local?.dispose();
    this.local = null;
    this.retries = 0;
    this.outbox = [];
    this.bestRtt = Infinity;
    useRoomStore.setState({ error: null, left: null, offline: false });
  }

  private open(hello: ClientMsg) {
    this.hello = hello;
    this.closedByUs = false;
    useRoomStore.setState({ conn: this.retries ? 'reconnecting' : 'connecting' });
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    if (this.soloFallback && !this.fallbackTimer) {
      // Solo games shouldn't wait on a server that isn't there.
      this.fallbackTimer = setTimeout(() => {
        if (useRoomStore.getState().conn !== 'open') this.goLocal();
      }, 3500);
    }
    ws.onopen = () => {
      if (this.ws !== ws) return;
      ws.send(JSON.stringify(this.hello));
      for (const m of this.outbox.splice(0)) ws.send(JSON.stringify(m));
      this.ping();
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.ping(), 4000);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      this.receive(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.closedByUs || this.local) return;
      this.scheduleRetry();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleRetry() {
    if (this.soloFallback && !useRoomStore.getState().room) {
      this.goLocal();
      return;
    }
    this.retries++;
    useRoomStore.setState({ conn: 'reconnecting' });
    const delay = Math.min(5000, 350 * 2 ** Math.min(this.retries, 5));
    this.retryTimer = setTimeout(() => {
      if (this.hello) this.open(this.hello);
    }, delay);
  }

  private goLocal() {
    const settings = this.soloFallback;
    const hello = this.hello;
    if (!settings || !hello || hello.t !== 'create' || this.local) return;
    this.closedByUs = true;
    this.ws?.close();
    this.ws = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.offset = 0;
    this.local = new LocalServer(hello.name, settings, (m) => this.receive(m), screenAspect());
    useRoomStore.setState({ offline: true });
    this.local.handle(hello);
  }

  private ping() {
    this.send({ t: 'ping', c: performance.now() });
  }

  private receive(msg: ServerMsg) {
    const store = useRoomStore;
    switch (msg.t) {
      case 'welcome': {
        this.retries = 0;
        if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
        this.fallbackTimer = null;
        if (!this.local) {
          writeSession(msg.room.code, msg.session);
          const h = this.hello;
          if (h && (h.t === 'create' || h.t === 'join')) {
            this.hello = { t: 'join', name: h.name, token: h.token, code: msg.room.code, session: msg.session, aspect: screenAspect() };
          }
        }
        this.syncClock(msg.now);
        store.setState((s) => ({ conn: 'open', you: msg.you, room: msg.room, error: null, gameEpoch: s.gameEpoch + 1 }));
        break;
      }
      case 'room': {
        const prev = store.getState().room;
        const newGame = !!msg.room.game && (!prev?.game || prev.game.seed !== msg.room.game.seed || prev.status !== msg.room.status);
        store.setState((s) => ({ room: msg.room, gameEpoch: newGame && msg.room.status !== 'playing' ? s.gameEpoch + 1 : s.gameEpoch }));
        break;
      }
      case 'players': {
        const room = store.getState().room;
        if (room) store.setState({ room: { ...room, players: msg.players } });
        break;
      }
      case 'grabbed':
        this.patchPiece(msg.p, (p) => {
          p.heldBy = msg.by;
          p.holdMode = msg.m;
        });
        this.listener?.onGrabbed(msg.p, msg.by, msg.m);
        break;
      case 'denied':
        this.listener?.onDenied(msg.p);
        break;
      case 'moved':
        this.patchPiece(msg.p, (p) => {
          p.x = msg.x;
          p.y = msg.y;
        });
        this.listener?.onMoved(msg.p, msg.x, msg.y, msg.by);
        break;
      case 'dropped':
        this.patchPiece(msg.p, (p) => {
          p.x = msg.x;
          p.y = msg.y;
          p.z = msg.z;
          p.heldBy = null;
          p.holdMode = null;
          if (msg.placed) {
            p.placed = true;
            p.by = msg.by;
          }
        });
        this.listener?.onDropped(msg.p, msg.x, msg.y, msg.z, msg.by, msg.placed, msg.miss, msg.points);
        break;
      case 'cursor':
        this.listener?.onCursor(msg.id, msg.x, msg.y);
        break;
      case 'finished': {
        const room = store.getState().room;
        if (room) store.setState({ room: { ...room, status: 'finished', results: msg.results } });
        this.listener?.onFinished?.(msg.results);
        break;
      }
      case 'pong': {
        const rtt = performance.now() - msg.c;
        if (rtt <= this.bestRtt * 1.3 + 5) {
          this.bestRtt = Math.min(this.bestRtt, rtt);
          this.offset = msg.s - (Date.now() - rtt / 2);
        }
        break;
      }
      case 'error':
        store.setState({ error: { code: msg.code, message: msg.message, at: Date.now() } });
        if (['room-not-found', 'room-full', 'name-taken', 'name-invalid', 'not-allowed'].includes(msg.code) && !store.getState().room) {
          this.closedByUs = true;
          this.ws?.close();
          store.setState({ conn: 'closed' });
        }
        break;
      case 'left':
        this.closedByUs = true;
        this.ws?.close();
        store.setState({ left: msg.reason, conn: 'closed' });
        break;
    }
  }

  private syncClock(serverNow: number) {
    if (this.bestRtt === Infinity) this.offset = serverNow - Date.now();
  }

  private patchPiece(id: string, fn: (p: NonNullable<RoomSnapshot['game']>['pieces'][number]) => void) {
    const game = useRoomStore.getState().room?.game;
    const p = game?.pieces.find((q) => q.id === id);
    if (p) fn(p);
  }
}

export const roomClient = new RoomClient();
