import type { PuzzleEngine } from './PuzzleEngine';
import type { ScenePiece } from './types';

type Role = 'hold' | 'pending' | 'camera' | 'peek';

interface Ptr {
  id: number;
  touch: boolean;
  x: number;
  y: number;
  x0: number;
  y0: number;
  lx: number;
  ly: number;
  t0: number;
  role: Role;
  moved: boolean;
  piece: ScenePiece | null;
}

const LONG_PRESS_MS = 280;
const PINCH_GRACE_MS = 150;

/**
 * Pointer gestures for mouse, pen and multi-touch:
 *
 * - Press a piece that is off the board → it lifts immediately and follows you.
 * - On the board: drag quickly to slide it flat, or press and hold to lift it.
 * - While one finger holds a piece, other fingers pan (one) or pinch-zoom (two).
 * - Empty table: drag to pan, pinch to zoom, double-tap to zoom in.
 * - Tap a country already in place to see its name.
 */
export class InputController {
  private canvas: HTMLCanvasElement | null = null;
  private readonly ptrs = new Map<number, Ptr>();
  private enabled = false;
  private holdId: number | null = null;
  private holdStart = 0;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private gesture: { key: string; dist: number; mx: number; my: number } | null = null;
  private samples: { t: number; x: number; y: number }[] = [];
  private lastTap: { t: number; x: number; y: number } | null = null;
  private edgeV = { x: 0, y: 0 };
  /** Edge auto-pan only arms once the held piece has been away from the edges. */
  private edgeArmed = false;
  private edgeSince = 0;
  private cleanup: (() => void)[] = [];

  constructor(private readonly engine: PuzzleEngine) {}

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      canvas.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => canvas.removeEventListener(type, fn as EventListener, opts));
    };
    on('pointerdown', (e) => this.down(e));
    on('pointermove', (e) => this.move(e));
    on('pointerup', (e) => this.up(e, false));
    on('pointercancel', (e) => this.up(e, true));
    on('lostpointercapture', (e) => {
      if (this.ptrs.has(e.pointerId)) this.up(e, true);
    });
    on('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.ptrs.size) this.engine.hover(null, null);
    });
    on('wheel', (e) => this.wheel(e), { passive: false });
    on('contextmenu', (e) => e.preventDefault());
    // iOS: stop the long-press callout / magnifier and page gestures.
    on('touchstart', (e) => e.preventDefault(), { passive: false });
    on('gesturestart' as keyof HTMLElementEventMap, (e) => e.preventDefault(), { passive: false });
    const key = (e: KeyboardEvent) => this.key(e);
    window.addEventListener('keydown', key);
    this.cleanup.push(() => window.removeEventListener('keydown', key));
  }

  detach() {
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.clearPending();
  }

  private pos(e: PointerEvent | WheelEvent) {
    const r = this.canvas!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Fingers / mouse are currently driving the camera. */
  get gesturing(): boolean {
    for (const p of this.ptrs.values()) if (p.role === 'camera' && p.moved) return true;
    return false;
  }

  private cameraPtrs(): Ptr[] {
    return [...this.ptrs.values()].filter((p) => p.role === 'camera');
  }

  // ── Pointer events ─────────────────────────────────────────────────────

  private down(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button > 2) return;
    e.preventDefault();
    this.engine.unlockAudio();
    try {
      this.canvas!.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best effort */
    }
    const { x, y } = this.pos(e);
    const touch = e.pointerType !== 'mouse';
    const p: Ptr = { id: e.pointerId, touch, x, y, x0: x, y0: y, lx: x, ly: y, t0: performance.now(), role: 'camera', moved: false, piece: null };
    this.ptrs.set(p.id, p);
    this.engine.camera.stop();
    this.gesture = null;
    this.samples = [];

    // A second finger: it's a camera gesture. If the first finger only just
    // grabbed something, the user was really starting a pinch — undo the grab.
    const others = [...this.ptrs.values()].filter((o) => o !== p);
    if (others.length) {
      const pend = others.find((o) => o.role === 'pending');
      if (pend) {
        this.clearPending();
        pend.role = 'camera';
      }
      const holder = this.holdId !== null ? this.ptrs.get(this.holdId) : undefined;
      if (holder && performance.now() - this.holdStart < PINCH_GRACE_MS && Math.hypot(holder.x - holder.x0, holder.y - holder.y0) < 12) {
        this.engine.endHold(true);
        holder.role = 'camera';
        this.holdId = null;
      }
      p.role = 'camera';
      return;
    }

    if (e.pointerType === 'mouse' && e.button !== 0) return; // right/middle drag pans
    if (!this.enabled) return;

    const hit = this.engine.pick(x, y, touch);
    if (hit?.kind === 'loose') {
      p.piece = hit.piece;
      if (this.engine.isOnBoard(hit.piece)) {
        p.role = 'pending';
        this.pendingTimer = setTimeout(() => this.resolvePending(p, 'lift'), LONG_PRESS_MS);
      } else if (this.engine.beginHold(hit.piece, 'lift', x, y, touch)) {
        p.role = 'hold';
        this.holdId = p.id;
        this.holdStart = performance.now();
        this.resetEdge(p);
      }
      return;
    }
    if (hit?.kind === 'placed') {
      p.role = 'peek';
      p.piece = hit.piece;
    }
  }

  private resolvePending(p: Ptr, mode: 'lift' | 'slide') {
    this.clearPending();
    if (!this.ptrs.has(p.id) || p.role !== 'pending' || !p.piece) return;
    // Grab relative to where the finger went down, so the piece doesn't jump.
    if (this.engine.beginHold(p.piece, mode, p.x0, p.y0, p.touch)) {
      p.role = 'hold';
      this.holdId = p.id;
      this.holdStart = performance.now() - PINCH_GRACE_MS;
      this.resetEdge(p);
      this.engine.moveHold(p.x, p.y);
    } else {
      p.role = 'camera';
    }
  }

  private clearPending() {
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
  }

  cancelPendingFor(piece: ScenePiece) {
    for (const p of this.ptrs.values()) {
      if (p.role === 'pending' && p.piece === piece) {
        this.clearPending();
        p.role = 'camera';
        p.piece = null;
      }
    }
  }

  /** The engine dropped our hold (denied / taken): keep the finger for panning. */
  releaseHoldPointer() {
    if (this.holdId === null) return;
    const p = this.ptrs.get(this.holdId);
    if (p) {
      p.role = 'camera';
      p.lx = p.x;
      p.ly = p.y;
    }
    this.holdId = null;
    this.edgeV = { x: 0, y: 0 };
    this.gesture = null;
  }

  private move(e: PointerEvent) {
    const p = this.ptrs.get(e.pointerId);
    const { x, y } = this.pos(e);
    if (!p) {
      if (e.pointerType === 'mouse') this.engine.hover(x, y);
      return;
    }
    p.x = x;
    p.y = y;
    const slop = p.touch ? 9 : 4;
    if (!p.moved && Math.hypot(x - p.x0, y - p.y0) > slop) p.moved = true;

    switch (p.role) {
      case 'pending':
        if (p.moved) this.resolvePending(p, 'slide');
        break;
      case 'hold':
        this.engine.moveHold(x, y);
        this.updateEdge(p);
        break;
      case 'peek':
        if (p.moved) {
          p.role = 'camera';
          this.gesture = null;
        }
        break;
    }
    if (p.role === 'camera') this.applyCamera(p);
    else if (!p.touch) this.engine.sendCursor(x, y);
    p.lx = x;
    p.ly = y;
  }

  private applyCamera(moved: Ptr) {
    const cams = this.cameraPtrs();
    const cam = this.engine.camera;
    if (cams.length === 1) {
      const c = cams[0];
      if (c !== moved) return;
      const dx = c.x - c.lx;
      const dy = c.y - c.ly;
      if (!dx && !dy) return;
      cam.panBy(dx, dy);
      const t = performance.now();
      this.samples.push({ t, x: c.x, y: c.y });
      while (this.samples.length > 2 && t - this.samples[0].t > 90) this.samples.shift();
    } else if (cams.length >= 2) {
      const [a, b] = cams;
      const key = `${a.id}:${b.id}`;
      const dist = Math.max(8, Math.hypot(a.x - b.x, a.y - b.y));
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if (this.gesture && this.gesture.key === key) {
        cam.zoomAt(this.gesture.mx, this.gesture.my, dist / this.gesture.dist);
        cam.panBy(mx - this.gesture.mx, my - this.gesture.my);
      }
      this.gesture = { key, dist, mx, my };
      this.samples = [];
    }
    this.engine.requestFrame();
  }

  private up(e: PointerEvent, cancelled: boolean) {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    this.ptrs.delete(p.id);
    try {
      this.canvas?.releasePointerCapture(p.id);
    } catch {
      /* already released */
    }
    const quick = performance.now() - p.t0 < 350;
    switch (p.role) {
      case 'hold':
        this.holdId = null;
        this.edgeV = { x: 0, y: 0 };
        this.engine.endHold(false);
        break;
      case 'pending':
        this.clearPending();
        if (!cancelled) this.engine.tapPiece(p.piece);
        break;
      case 'peek':
        if (!cancelled && !p.moved && p.piece) this.engine.peek(p.piece);
        break;
      case 'camera':
        if (!cancelled && !p.moved && quick && this.ptrs.size === 0) this.tap(p);
        else if (this.cameraPtrs().length === 0 && this.samples.length >= 2) this.fling();
        break;
    }
    this.gesture = null;
    this.samples = [];
    if (!p.touch && !this.ptrs.size) this.engine.hover(p.x, p.y);
    this.engine.requestFrame();
  }

  private tap(p: Ptr) {
    const now = performance.now();
    const last = this.lastTap;
    if (last && now - last.t < 320 && Math.hypot(p.x - last.x, p.y - last.y) < 36) {
      this.engine.camera.zoomSmooth(p.x, p.y, 2);
      this.lastTap = null;
    } else {
      this.lastTap = { t: now, x: p.x, y: p.y };
    }
  }

  private fling() {
    const s = this.samples;
    const a = s[0];
    const b = s[s.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0.005 || performance.now() - b.t > 60) return;
    const vx = (b.x - a.x) / dt;
    const vy = (b.y - a.y) / dt;
    if (Math.hypot(vx, vy) > 180) this.engine.camera.fling(vx, vy);
  }

  private edgePush(p: Ptr): { x: number; y: number } {
    const cam = this.engine.camera;
    const zone = p.touch ? 30 : 40;
    const top = cam.insets.top;
    const bottom = cam.height - cam.insets.bottom;
    const ex = p.x < zone ? -(zone - p.x) / zone : p.x > cam.width - zone ? (p.x - (cam.width - zone)) / zone : 0;
    const ey = p.y < top + zone ? -(top + zone - p.y) / zone : p.y > bottom - zone ? (p.y - (bottom - zone)) / zone : 0;
    return { x: Math.max(-1, Math.min(1, ex)), y: Math.max(-1, Math.min(1, ey)) };
  }

  /** A new hold: picking up a piece that already sits by an edge mustn't scroll. */
  private resetEdge(p: Ptr) {
    const push = this.edgePush(p);
    this.edgeArmed = !push.x && !push.y;
    this.edgeV = { x: 0, y: 0 };
    this.edgeSince = 0;
  }

  private updateEdge(p: Ptr) {
    const push = this.edgePush(p);
    if (!push.x && !push.y) {
      this.edgeArmed = true;
      this.edgeV = { x: 0, y: 0 };
      this.edgeSince = 0;
      return;
    }
    if (!this.edgeArmed) return;
    if (!this.edgeSince) this.edgeSince = performance.now();
    const speed = 620;
    this.edgeV = { x: push.x * speed, y: push.y * speed };
  }

  /** Auto-pans while a held piece is pushed against a screen edge (easing in). */
  update(dt: number): boolean {
    if (this.holdId === null || (!this.edgeV.x && !this.edgeV.y)) return false;
    const ramp = Math.min(1, (performance.now() - this.edgeSince) / 280);
    const k = ramp * ramp;
    this.engine.camera.panBy(-this.edgeV.x * k * dt, -this.edgeV.y * k * dt);
    return true;
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    const { x, y } = this.pos(e);
    const cam = this.engine.camera;
    if (e.ctrlKey) {
      // Trackpad pinch.
      cam.zoomAt(x, y, Math.exp(-e.deltaY * 0.012));
    } else if (e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY))) {
      // Mouse wheel notches.
      const notches = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaY / 100;
      cam.zoomSmooth(x, y, Math.pow(1.28, -Math.max(-3, Math.min(3, notches))));
    } else {
      // Two-finger trackpad scroll pans.
      cam.panBy(-e.deltaX, -e.deltaY);
    }
    this.engine.requestFrame();
  }

  private key(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const cam = this.engine.camera;
    const step = 90;
    switch (e.key) {
      case '+':
      case '=':
        this.engine.zoomBy(1.5);
        break;
      case '-':
      case '_':
        this.engine.zoomBy(1 / 1.5);
        break;
      case '0':
        this.engine.fitTable();
        break;
      case 'ArrowLeft':
        cam.panBy(step, 0);
        break;
      case 'ArrowRight':
        cam.panBy(-step, 0);
        break;
      case 'ArrowUp':
        cam.panBy(0, step);
        break;
      case 'ArrowDown':
        cam.panBy(0, -step);
        break;
      case 'Escape':
        if (this.holdId !== null) {
          const p = this.ptrs.get(this.holdId);
          if (p) p.role = 'camera';
          this.holdId = null;
          this.edgeV = { x: 0, y: 0 };
          this.engine.endHold(true);
        }
        break;
      default:
        return;
    }
    e.preventDefault();
    this.engine.requestFrame();
  }
}
