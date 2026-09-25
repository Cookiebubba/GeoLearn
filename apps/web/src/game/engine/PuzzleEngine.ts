import {
  COUNTRY_BY_ID,
  isSnap,
  labelPoint,
  type GameSnapshot,
  type GrabMode,
  type PlayerInfo,
  type PuzzleDetailFile,
  type PuzzleModel,
  type TableBounds,
  PLAYER_COLORS,
} from '@geolearn/shared';
import type { SoundEngine } from './audio';
import { Camera, type Insets } from './camera';
import { Effects } from './effects';
import { PieceGeometry } from './geometry';
import { InputController } from './input';
import { clamp, easeOutCubic, springStep } from './math';
import { pieceColors, type Palette } from './palette';
import { haloRadius, HALO_BELOW, Renderer } from './renderer';
import type { EngineCallbacks, EnginePlayer, ScenePiece, Visibility } from './types';

export interface EngineOptions {
  model: PuzzleModel;
  you: string;
  palette: Palette;
  visibility: Visibility;
  callbacks: EngineCallbacks;
  sound: SoundEngine;
  haptics: boolean;
}

interface Hold {
  piece: ScenePiece;
  mode: GrabMode;
  /** Pointer position (screen) the piece follows. */
  sx: number;
  sy: number;
  /** Offset from pointer to anchor, in board units at grab time. */
  offX: number;
  offY: number;
  touch: boolean;
}

export interface PickResult {
  piece: ScenePiece;
  kind: 'loose' | 'busy' | 'placed';
}

const MOVE_INTERVAL = 33;
const CURSOR_INTERVAL = 66;

/**
 * The puzzle table: owns the camera, the scene, rendering and gestures, and
 * reconciles optimistic local actions with what the server says.
 */
export class PuzzleEngine {
  readonly camera = new Camera();
  readonly model: PuzzleModel;
  private readonly renderer: Renderer;
  private readonly effects = new Effects();
  private readonly input: InputController;
  private readonly pieces = new Map<string, ScenePiece>();
  private readonly list: ScenePiece[] = [];
  private readonly geoms: PieceGeometry[];
  private readonly players = new Map<string, EnginePlayer>();
  private readonly cursors = new Map<string, { x: number; y: number; t: number }>();
  private readonly ro: ResizeObserver;
  private palette: Palette;
  private visibility: Visibility;
  private callbacks: EngineCallbacks;
  private sound: SoundEngine;
  private haptics: boolean;
  private you: string;
  private interactive = false;
  private dpr = 1;
  private raf = 0;
  private lastT = 0;
  private detailLoaded = false;
  private placedCount = 0;
  private complete = false;
  private completeGlow = 0;
  private zCounter = 0;
  private table: TableBounds;
  private seed: number | null = null;
  private hold: Hold | null = null;
  private hovered: ScenePiece | null = null;
  private lastMoveSent = 0;
  private lastCursorSent = 0;
  private orderDirty = true;
  private staticVersion = 0;
  private placedList: ScenePiece[] = [];
  private looseList: ScenePiece[] = [];
  private heldList: ScenePiece[] = [];
  private settlingList: ScenePiece[] = [];
  private staticPlaced: ScenePiece[] = [];
  private staticLoose: ScenePiece[] = [];
  private pressingList: ScenePiece[] = [];
  private movingList: ScenePiece[] = [];
  private destroyed = false;
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private lastZoomReport = 0;

  readonly canvas: HTMLCanvasElement;

  constructor(
    layers: { staticCanvas: HTMLCanvasElement; dynamicCanvas: HTMLCanvasElement },
    opts: EngineOptions,
  ) {
    const canvas = layers.dynamicCanvas;
    this.canvas = canvas;
    this.model = opts.model;
    this.you = opts.you;
    this.palette = opts.palette;
    this.visibility = opts.visibility;
    this.callbacks = opts.callbacks;
    this.sound = opts.sound;
    this.haptics = opts.haptics;
    this.renderer = new Renderer(layers.staticCanvas, layers.dynamicCanvas);
    const lodCount = this.model.lodZoom.length;
    this.geoms = this.model.pieces.map((m) => new PieceGeometry(m, lodCount));
    this.renderer.setBoard(this.geoms, this.model.board);
    const W = this.model.board.width;
    const H = this.model.board.height;
    this.table = { x0: -W * 0.2, y0: -H * 0.2, x1: W * 1.2, y1: H * 1.2 };

    this.model.pieces.forEach((m, i) => {
      const info = COUNTRY_BY_ID.get(m.id)!;
      const p: ScenePiece = {
        id: m.id,
        model: m,
        geom: this.geoms[i],
        info,
        colors: pieceColors(this.palette, m.color, m.id),
        x: m.tx,
        y: m.ty,
        z: 0,
        placed: false,
        placedBy: null,
        heldBy: null,
        mode: null,
        rx: m.tx,
        ry: m.ty,
        vx: 0,
        vy: 0,
        lift: 0,
        liftV: 0,
        hover: 0,
        snap: null,
        press: -1,
        pressDelay: 0,
        pending: false,
        origin: null,
        float: 0,
        floatV: 0,
        floatTarget: 0,
        still: true,
      };
      this.pieces.set(m.id, p);
      this.list.push(p);
    });

    this.input = new InputController(this);
    this.input.attach(canvas);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.camera.setBounds(this.table, this.model.maxZoom);
    this.camera.fit(this.table, false, 0.02);
    // The board's inner shadow is a one-off render; do it after first paint.
    setTimeout(() => {
      if (this.destroyed) return;
      this.renderer.buildBoardShadow();
      this.requestFrame();
    }, 30);
    this.requestFrame();
  }

  // ── Setup & settings ──────────────────────────────────────────────────

  destroy() {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.input.detach();
    this.renderer.clearCaches();
  }

  setCallbacks(cb: EngineCallbacks) {
    this.callbacks = cb;
  }

  setYou(id: string) {
    this.you = id;
  }

  setPalette(p: Palette) {
    this.palette = p;
    for (const piece of this.list) piece.colors = pieceColors(p, piece.model.color, piece.id);
    this.staticVersion++;
    this.requestFrame();
  }

  setVisibility(v: Visibility) {
    this.visibility = v;
    this.requestFrame();
  }

  setHaptics(on: boolean) {
    this.haptics = on;
  }

  setInsets(insets: Insets) {
    this.insets = insets;
    this.resize();
  }

  setInteractive(on: boolean) {
    this.interactive = on;
    if (!on && this.hold) this.endHold(true);
    this.input.setEnabled(on);
    this.requestFrame();
  }

  get isInteractive() {
    return this.interactive;
  }

  setPlayers(players: PlayerInfo[]) {
    this.players.clear();
    for (const p of players) this.players.set(p.id, { id: p.id, name: p.name, color: PLAYER_COLORS[p.color % PLAYER_COLORS.length] });
    this.requestFrame();
  }

  loadDetail(detail: PuzzleDetailFile) {
    if (this.detailLoaded) return;
    for (const g of this.geoms) {
      const rings = detail.rings[g.model.id];
      if (rings) g.setLod(detail.lod, rings);
    }
    this.renderer.refreshLod(detail.lod);
    this.detailLoaded = true;
    this.requestFrame();
  }

  /** Full state from the server (game start, reconnect). */
  load(snap: GameSnapshot) {
    const fresh = snap.seed !== this.seed;
    this.seed = snap.seed;
    this.table = snap.table;
    this.camera.setBounds(this.table, this.model.maxZoom);
    if (fresh) this.camera.fit(this.table, false, 0.02);
    this.hold = null;
    this.placedCount = 0;
    for (const ps of snap.pieces) {
      const p = this.pieces.get(ps.id);
      if (!p) continue;
      p.x = ps.x;
      p.y = ps.y;
      p.rx = ps.x;
      p.ry = ps.y;
      p.vx = p.vy = 0;
      p.z = ps.z;
      p.placed = ps.placed;
      p.placedBy = ps.by;
      p.heldBy = ps.heldBy === this.you ? null : ps.heldBy;
      p.mode = p.heldBy ? ps.holdMode : null;
      p.lift = p.heldBy ? 1 : 0;
      p.liftV = 0;
      p.snap = null;
      p.press = -1;
      p.pending = false;
      p.origin = null;
      p.float = p.floatV = p.floatTarget = 0;
      p.still = !p.heldBy;
      p.hover = 0;
      p.pressDelay = 0;
      this.zCounter = Math.max(this.zCounter, ps.z);
      if (p.placed) this.placedCount++;
    }
    this.complete = this.placedCount === this.list.length;
    this.completeGlow = this.complete ? 1 : 0;
    this.effects.clear();
    this.orderDirty = true;
    this.callbacks.progress?.(this.placedCount, this.list.length);
    this.requestFrame();
  }

  fitTable(animate = true) {
    this.camera.fit(this.table, animate, 0.02);
    this.requestFrame();
  }

  fitBoard(animate = true) {
    const { width: W, height: H } = this.model.board;
    this.camera.fit({ x0: 0, y0: 0, x1: W, y1: H }, animate, 0.05, 1.1);
    this.requestFrame();
  }

  zoomBy(factor: number) {
    this.camera.zoomSmooth(this.camera.cx, this.camera.cy, factor);
    this.requestFrame();
  }

  // ── Network events ────────────────────────────────────────────────────

  onGrabbed(pieceId: string, by: string, mode: GrabMode) {
    const p = this.pieces.get(pieceId);
    if (!p || p.placed) return;
    if (by === this.you) return;
    if (this.hold?.piece === p) this.abortHold(false);
    this.input.cancelPendingFor(p);
    p.heldBy = by;
    p.mode = mode;
    p.z = ++this.zCounter;
    this.orderDirty = true;
    this.requestFrame();
  }

  onDenied(pieceId: string) {
    const p = this.pieces.get(pieceId);
    if (!p) return;
    if (this.hold?.piece === p) {
      this.abortHold(true);
      this.sound.deny();
    }
  }

  onMoved(pieceId: string, x: number, y: number, by: string) {
    const p = this.pieces.get(pieceId);
    if (!p || p.placed || by === this.you) return;
    if (this.hold?.piece === p) this.abortHold(false);
    if (p.heldBy !== by) {
      p.heldBy = by;
      p.mode = p.mode ?? 'lift';
      this.orderDirty = true;
    }
    p.x = x;
    p.y = y;
    this.cursors.set(by, { x: x + p.model.label[0], y: y + p.model.label[1], t: performance.now() });
    this.requestFrame();
  }

  onDropped(pieceId: string, x: number, y: number, z: number, by: string, placed: boolean, miss: boolean) {
    const p = this.pieces.get(pieceId);
    if (!p) return;
    this.zCounter = Math.max(this.zCounter, z);
    if (by === this.you && this.hold?.piece !== p) {
      // Our own drop, confirmed. Reconcile the optimistic prediction.
      p.z = z;
      p.pending = false;
      if (placed && !p.placed) this.place(p, by, false);
      else if (!placed && p.placed) {
        p.placed = false;
        p.placedBy = null;
        this.placedCount--;
        p.x = x;
        p.y = y;
        this.callbacks.progress?.(this.placedCount, this.list.length);
      } else if (!placed) {
        p.x = x;
        p.y = y;
      }
      this.orderDirty = true;
      this.requestFrame();
      return;
    }
    if (this.hold?.piece === p) this.abortHold(false);
    p.heldBy = null;
    p.mode = null;
    p.z = z;
    if (placed) {
      if (!p.placed) this.place(p, by, true);
    } else {
      p.x = x;
      p.y = y;
      const pan = this.panOf(p);
      if (miss) this.sound.miss(pan);
      else this.sound.drop(pan, this.isOnBoard(p));
    }
    this.orderDirty = true;
    this.requestFrame();
  }

  onCursor(id: string, x: number | null, y: number | null) {
    if (x === null || y === null) this.cursors.delete(id);
    else this.cursors.set(id, { x, y, t: performance.now() });
    this.requestFrame();
  }

  // ── Picking & holding (called by the input controller) ────────────────

  get lod(): number {
    const scale = this.camera.zoom * Math.min(this.dpr, 2.5) * 0.5;
    const z = this.model.lodZoom;
    if (this.detailLoaded && z.length > 2 && scale >= z[2]) return 2;
    return scale >= z[1] ? 1 : 0;
  }

  get holding(): Hold | null {
    return this.hold;
  }

  isOnBoard(p: ScenePiece): boolean {
    const { width: W, height: H } = this.model.board;
    return p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H;
  }

  pick(sx: number, sy: number, touch: boolean): PickResult | null {
    const wx = this.camera.toWorldX(sx);
    const wy = this.camera.toWorldY(sy);
    const zoom = this.camera.zoom;
    const lod = Math.max(this.lod, 1);
    this.sortIfNeeded();
    const candidates = [...this.heldList.filter((p) => p.heldBy !== this.you), ...this.looseList];
    // Exact hits, topmost first.
    for (let i = candidates.length - 1; i >= 0; i--) {
      const p = candidates[i];
      if (p.geom.contains(wx - p.rx, wy - p.ry, lod)) return { piece: p, kind: p.heldBy ? 'busy' : 'loose' };
    }
    // Forgiving hits for small pieces and fingers.
    const slop = touch ? 22 : 12;
    let best: ScenePiece | null = null;
    let bestD = Infinity;
    for (const p of candidates) {
      const screenSize = p.model.size * zoom;
      const [lx, ly] = labelPoint(p.model, p.rx, p.ry);
      const dLabel = Math.hypot(lx - wx, ly - wy) * zoom;
      const haloR = screenSize < HALO_BELOW ? haloRadius(screenSize) + (touch ? 12 : 5) : 0;
      let d = Infinity;
      if (haloR && dLabel <= haloR) d = dLabel * 0.5;
      else if (screenSize < 90) {
        const bd = p.geom.bboxDistance(wx - p.rx, wy - p.ry) * zoom;
        if (bd <= slop) d = bd + 4;
      }
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) return { piece: best, kind: best.heldBy ? 'busy' : 'loose' };
    // Pieces already home (for a quick "what is this?" peek).
    for (let i = this.placedList.length - 1; i >= 0; i--) {
      const p = this.placedList[i];
      if (p.geom.contains(wx - p.rx, wy - p.ry, lod)) return { piece: p, kind: 'placed' };
    }
    return null;
  }

  beginHold(p: ScenePiece, mode: GrabMode, sx: number, sy: number, touch: boolean) {
    if (!this.interactive || p.placed || (p.heldBy && p.heldBy !== this.you)) return false;
    if (this.hold) this.endHold(false);
    const wx = this.camera.toWorldX(sx);
    const wy = this.camera.toWorldY(sy);
    p.origin = [p.x, p.y];
    p.heldBy = this.you;
    p.mode = mode;
    p.z = ++this.zCounter;
    p.snap = null;
    // On touch screens small pieces float above the fingertip so you can see them.
    // Big pieces stay under the finger; small ones rise just clear of it.
    const screenH = (p.model.bbox[3] - p.model.bbox[1]) * this.camera.zoom;
    const k = clamp((120 - screenH) / 50, 0, 1);
    p.floatTarget = touch && mode === 'lift' ? k * (Math.min(screenH, 70) * 0.5 + 30) : 0;
    this.hold = { piece: p, mode, sx, sy, offX: wx - p.x, offY: wy - p.y, touch };
    this.orderDirty = true;
    this.callbacks.grab(p.id, mode);
    if (mode === 'lift') {
      this.sound.pickup(this.panOf(p));
      this.vibrate(8);
    } else this.sound.tap();
    this.requestFrame();
    return true;
  }

  moveHold(sx: number, sy: number) {
    const h = this.hold;
    if (!h) return;
    h.sx = sx;
    h.sy = sy;
    this.applyHold(true);
  }

  /** Keeps the held piece under the finger (also while the camera moves). */
  private applyHold(send: boolean) {
    const h = this.hold;
    if (!h) return;
    const p = h.piece;
    const zoom = this.camera.zoom;
    const nx = this.camera.toWorldX(h.sx) - h.offX;
    const ny = this.camera.toWorldY(h.sy) - h.offY - p.float / zoom;
    const moved = Math.abs(nx - p.x) + Math.abs(ny - p.y) > 1e-6;
    p.x = nx;
    p.y = ny;
    if (moved && send) {
      const now = performance.now();
      if (now - this.lastMoveSent >= MOVE_INTERVAL) {
        this.lastMoveSent = now;
        this.callbacks.move(p.id, round2(p.x), round2(p.y));
      }
    }
    this.requestFrame();
  }

  endHold(cancelled: boolean) {
    const h = this.hold;
    if (!h) return;
    this.hold = null;
    const p = h.piece;
    p.floatTarget = 0;
    p.heldBy = null;
    p.mode = null;
    p.origin = null;
    const zoom = this.camera.zoom;
    const x = round2(p.x);
    const y = round2(p.y);
    this.orderDirty = true;
    if (!cancelled && isSnap(p.model, x, y, zoom, this.model.maxZoom)) {
      p.pending = true;
      this.place(p, this.you, false);
    } else {
      const [lx, ly] = labelPoint(p.model, x, y);
      const onLand = this.model.silhouette.contains(lx, ly);
      if (onLand) this.sound.miss(this.panOf(p));
      else this.sound.drop(this.panOf(p), this.isOnBoard(p));
    }
    this.callbacks.drop(p.id, x, y, zoom);
    this.callbacks.cursor(null, null);
    this.requestFrame();
  }

  /** Server said no (or someone else got there first): put it back. */
  private abortHold(returnToOrigin: boolean) {
    const h = this.hold;
    if (!h) return;
    this.hold = null;
    this.input.releaseHoldPointer();
    const p = h.piece;
    p.floatTarget = 0;
    if (p.heldBy === this.you) {
      p.heldBy = null;
      p.mode = null;
    }
    if (returnToOrigin && p.origin) {
      p.x = p.origin[0];
      p.y = p.origin[1];
    }
    p.origin = null;
    this.orderDirty = true;
    this.requestFrame();
  }

  hover(sx: number | null, sy: number | null) {
    let next: ScenePiece | null = null;
    if (sx !== null && sy !== null && this.interactive && !this.hold) {
      const hit = this.pick(sx, sy, false);
      if (hit && hit.kind === 'loose') next = hit.piece;
      this.canvas.style.cursor = hit ? (hit.kind === 'loose' ? 'grab' : hit.kind === 'busy' ? 'not-allowed' : 'default') : 'default';
    }
    if (this.hold) this.canvas.style.cursor = 'grabbing';
    if (next !== this.hovered) {
      this.hovered = next;
      this.requestFrame();
    }
    this.sendCursor(sx, sy);
  }

  sendCursor(sx: number | null, sy: number | null) {
    const now = performance.now();
    if (sx === null || sy === null) return;
    if (now - this.lastCursorSent < CURSOR_INTERVAL) return;
    this.lastCursorSent = now;
    this.callbacks.cursor(round2(this.camera.toWorldX(sx)), round2(this.camera.toWorldY(sy)));
  }

  unlockAudio() {
    this.sound.unlock();
  }

  /** A tap (no drag, no hold) on a piece lying on the board. */
  tapPiece(p: ScenePiece | null) {
    if (!p) return;
    this.sound.tap();
    p.liftV += 2.2;
    this.requestFrame();
  }

  peek(p: ScenePiece) {
    const sub = p.info.capital ? p.info.capital : null;
    this.effects.toast(p, p.info.name, sub, 2.4);
    this.sound.tap();
    this.requestFrame();
  }

  // ── Placement ─────────────────────────────────────────────────────────

  private place(p: ScenePiece, by: string, remote: boolean) {
    p.placed = true;
    p.placedBy = by;
    p.heldBy = null;
    p.mode = null;
    p.snap = { t: 0, fx: p.rx, fy: p.ry };
    p.x = p.model.tx;
    p.y = p.model.ty;
    this.placedCount++;
    this.orderDirty = true;
    const pan = this.panOf(p);
    this.sound.snap(pan, remote);
    if (!remote) this.vibrate(14);
    this.effects.snap(p, this.camera.zoom, !remote);
    if (this.visibility.revealOnPlace) {
      const who = remote ? this.players.get(by)?.name : null;
      const sub = [p.info.capital, who ? `placed by ${who}` : null].filter(Boolean).join(' · ') || null;
      this.effects.toast(p, p.info.name, sub);
    }
    this.callbacks.placed?.(p.id, !remote);
    this.callbacks.progress?.(this.placedCount, this.list.length);
    if (this.placedCount === this.list.length && !this.complete) this.celebrate(p);
  }

  private celebrate(last: ScenePiece) {
    this.complete = true;
    const W = this.model.board.width;
    for (const p of this.list) {
      const d = Math.hypot(p.model.tx - last.model.tx, p.model.ty - last.model.ty);
      p.pressDelay = 0.35 + (d / W) * 0.9;
      p.press = -1;
    }
    setTimeout(() => {
      if (this.destroyed) return;
      this.effects.startSweep();
      this.sound.complete();
      this.fitBoard(true);
    }, 350);
    this.callbacks.complete?.();
  }

  // ── Frame loop ─────────────────────────────────────────────────────────

  requestFrame() {
    if (!this.raf && !this.destroyed) this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (t: number) => {
    this.raf = 0;
    if (this.destroyed) return;
    const dt = this.lastT ? clamp((t - this.lastT) / 1000, 0, 0.05) : 1 / 60;
    this.lastT = t;
    let animating = false;
    if (this.camera.update(dt)) animating = true;
    if (this.input.update(dt)) animating = true;
    if (this.hold) this.applyHold(true);
    if (this.updatePieces(dt)) animating = true;
    this.effects.update(dt);
    if (this.effects.active) animating = true;
    if (this.complete && this.completeGlow < 1) {
      this.completeGlow = Math.min(1, this.completeGlow + dt / 1.6);
      animating = true;
    }
    this.draw();
    this.reportZoom();
    if (this.cursors.size) animating = animating || [...this.cursors.values()].some((c) => performance.now() - c.t < 4200);
    if (animating || this.renderer.wantsFrame) {
      this.renderer.wantsFrame = false;
      this.requestFrame();
    } else this.lastT = 0;
  };

  private updatePieces(dt: number): boolean {
    let animating = false;
    for (const p of this.list) {
      // Lift: a lightly under-damped spring gives a small, satisfying pop.
      const liftTarget = p.heldBy ? (p.mode === 'lift' ? 1 : 0.28) : 0;
      if (Math.abs(p.lift - liftTarget) > 0.002 || Math.abs(p.liftV) > 0.01) {
        const steps = Math.ceil(dt / (1 / 120));
        const h = dt / steps;
        for (let i = 0; i < steps; i++) {
          const a = 420 * (liftTarget - p.lift) - 30 * p.liftV;
          p.liftV += a * h;
          p.lift += p.liftV * h;
        }
        animating = true;
      } else {
        p.lift = liftTarget;
        p.liftV = 0;
      }

      const hoverTarget = this.hovered === p ? 1 : 0;
      if (Math.abs(p.hover - hoverTarget) > 0.01) {
        p.hover += (hoverTarget - p.hover) * Math.min(1, dt * 14);
        animating = true;
      } else p.hover = hoverTarget;

      if (Math.abs(p.float - p.floatTarget) > 0.3 || Math.abs(p.floatV) > 1) {
        [p.float, p.floatV] = springStep(p.float, p.floatV, p.floatTarget, 26, dt);
        animating = true;
      } else {
        p.float = p.floatTarget;
        p.floatV = 0;
      }

      if (p.snap) {
        p.snap.t += dt / 0.22;
        const e = easeOutCubic(Math.min(1, p.snap.t));
        p.rx = p.snap.fx + (p.model.tx - p.snap.fx) * e;
        p.ry = p.snap.fy + (p.model.ty - p.snap.fy) * e;
        if (p.snap.t >= 1) {
          p.snap = null;
          p.rx = p.model.tx;
          p.ry = p.model.ty;
          p.press = 0;
          this.orderDirty = true;
        }
        animating = true;
      } else if (p.heldBy === this.you) {
        p.rx = p.x;
        p.ry = p.y;
        p.vx = p.vy = 0;
      } else if (Math.abs(p.rx - p.x) > 0.001 || Math.abs(p.ry - p.y) > 0.001 || Math.abs(p.vx) + Math.abs(p.vy) > 0.01) {
        const omega = p.heldBy ? 20 : 26;
        [p.rx, p.vx] = springStep(p.rx, p.vx, p.x, omega, dt);
        [p.ry, p.vy] = springStep(p.ry, p.vy, p.y, omega, dt);
        if (Math.abs(p.rx - p.x) < 0.001 && Math.abs(p.ry - p.y) < 0.001 && Math.abs(p.vx) + Math.abs(p.vy) < 0.05) {
          p.rx = p.x;
          p.ry = p.y;
          p.vx = p.vy = 0;
        }
        animating = true;
      }

      if (p.pressDelay > 0) {
        p.pressDelay -= dt;
        if (p.pressDelay <= 0) p.press = 0;
        animating = true;
      } else if (p.press >= 0) {
        p.press += dt / 0.32;
        if (p.press >= 1) p.press = -1;
        animating = true;
      }

      const still =
        !p.heldBy && !p.snap && p.press < 0 && p.pressDelay <= 0 && p.lift === 0 && p.liftV === 0 && p.hover === 0 && p.vx === 0 && p.vy === 0 && p.rx === p.x && p.ry === p.y;
      if (still !== p.still) {
        p.still = still;
        this.orderDirty = true;
      }
    }
    return animating;
  }

  private sortIfNeeded() {
    if (!this.orderDirty) return;
    this.orderDirty = false;
    this.staticVersion++;
    this.placedList = this.list.filter((p) => p.placed && !p.snap).sort((a, b) => b.model.area - a.model.area);
    this.settlingList = this.list.filter((p) => p.placed && p.snap);
    this.looseList = this.list.filter((p) => !p.placed && !p.heldBy).sort((a, b) => a.z - b.z);
    this.heldList = this.list
      .filter((p) => !p.placed && p.heldBy)
      .sort((a, b) => (a.heldBy === this.you ? 1 : 0) - (b.heldBy === this.you ? 1 : 0) || a.z - b.z);
    this.staticPlaced = this.placedList.filter((p) => p.still);
    this.pressingList = this.placedList.filter((p) => !p.still);
    this.staticLoose = this.looseList.filter((p) => p.still);
    this.movingList = this.looseList.filter((p) => !p.still);
  }

  private draw() {
    this.sortIfNeeded();
    this.renderer.render({
      camera: this.camera,
      dpr: this.dpr,
      lod: this.lod,
      staticPlaced: this.staticPlaced,
      staticLoose: this.staticLoose,
      pressing: this.pressingList,
      settling: this.settlingList,
      moving: this.movingList,
      held: this.heldList,
      staticVersion: this.staticVersion,
      cameraMoving: this.forceMoving || this.camera.moving || this.input.gesturing,
      effects: this.effects,
      visibility: this.visibility,
      players: this.players,
      cursors: this.cursors,
      you: this.you,
      now: performance.now(),
      completeGlow: this.completeGlow,
    });
  }

  private reportZoom() {
    const z = this.camera.zoom;
    if (Math.abs(z - this.lastZoomReport) / z > 0.01) {
      this.lastZoomReport = z;
      this.callbacks.zoom?.(z, this.camera.minZoom, this.camera.maxZoom);
    }
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    let dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    // Keep the backing store to a sensible size on big screens.
    const maxPixels = 9_000_000;
    if (w * h * dpr * dpr > maxPixels) dpr = Math.sqrt(maxPixels / (w * h));
    const first = this.camera.width <= 1;
    this.dpr = dpr;
    this.renderer.resize(w, h, dpr);
    this.camera.resize(w, h, this.insets);
    if (first) this.camera.fit(this.table, false, 0.02);
    this.requestFrame();
  }

  private panOf(p: ScenePiece): number {
    const sx = this.camera.toScreenX(p.rx);
    return clamp((sx / Math.max(1, this.camera.width)) * 2 - 1, -1, 1) * 0.7;
  }

  private vibrate(ms: number) {
    if (!this.haptics) return;
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* not supported */
    }
  }

  /** Test / debug helper: where a piece and its home are on screen right now. */
  inspect(id: string) {
    const p = this.pieces.get(id);
    if (!p) return null;
    const [lx, ly] = p.model.label;
    return {
      x: this.camera.toScreenX(p.rx + lx),
      y: this.camera.toScreenY(p.ry + ly),
      homeX: this.camera.toScreenX(p.model.tx + lx),
      homeY: this.camera.toScreenY(p.model.ty + ly),
      placed: p.placed,
      heldBy: p.heldBy,
      lift: p.lift,
      onBoard: this.isOnBoard(p),
      zoom: this.camera.zoom,
    };
  }

  /** Debug: renders `frames` frames while panning; returns average ms per frame. */
  benchmark(frames = 60, gesture = true): number {
    this.forceMoving = gesture;
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      this.camera.panBy(Math.sin(i / 5) * 6, Math.cos(i / 7) * 6);
      this.draw();
      this.renderer.flush();
    }
    this.forceMoving = false;
    return (performance.now() - t0) / frames;
  }

  /** Static-layer renders so far (diagnostics). */
  get staticRenders() {
    return this.renderer.staticRenders;
  }

  private forceMoving = false;

  get pieceIds(): string[] {
    return this.list.map((p) => p.id);
  }

  get progress() {
    return { placed: this.placedCount, total: this.list.length };
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
