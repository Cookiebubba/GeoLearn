import { clamp, easeInOutCubic } from './math';

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface CameraAnim {
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toY: number;
  toZ: number;
  t: number;
  dur: number;
}

/**
 * Pan/zoom camera. (x, y) is the world point shown at the centre of the usable
 * viewport; zoom is CSS pixels per board unit.
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  width = 1;
  height = 1;
  minZoom = 0.05;
  maxZoom = 20;
  bounds: Rect = { x0: 0, y0: 0, x1: 1000, y1: 1000 };
  insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

  private anim: CameraAnim | null = null;
  private vx = 0;
  private vy = 0;
  /** Smooth wheel zoom target. */
  private zoomTarget: { z: number; sx: number; sy: number } | null = null;

  /** Centre of the usable area in screen space (insets for the HUD). */
  get cx() {
    return this.insets.left + (this.width - this.insets.left - this.insets.right) / 2;
  }
  get cy() {
    return this.insets.top + (this.height - this.insets.top - this.insets.bottom) / 2;
  }

  toScreenX(wx: number) {
    return (wx - this.x) * this.zoom + this.cx;
  }
  toScreenY(wy: number) {
    return (wy - this.y) * this.zoom + this.cy;
  }
  toWorldX(sx: number) {
    return (sx - this.cx) / this.zoom + this.x;
  }
  toWorldY(sy: number) {
    return (sy - this.cy) / this.zoom + this.y;
  }

  /** Visible world rectangle (whole canvas, not just the inset area). */
  viewRect(margin = 0): Rect {
    return {
      x0: this.toWorldX(-margin),
      y0: this.toWorldY(-margin),
      x1: this.toWorldX(this.width + margin),
      y1: this.toWorldY(this.height + margin),
    };
  }

  resize(width: number, height: number, insets: Insets) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.insets = insets;
    this.minZoom = this.fitZoom(this.bounds, 0.08) * 0.85;
    this.clampState();
  }

  setBounds(b: Rect, maxZoom: number) {
    this.bounds = b;
    this.maxZoom = maxZoom;
    this.minZoom = this.fitZoom(b, 0.08) * 0.85;
    this.clampState();
  }

  fitZoom(r: Rect, pad = 0.05): number {
    const w = this.width - this.insets.left - this.insets.right;
    const h = this.height - this.insets.top - this.insets.bottom;
    const rw = (r.x1 - r.x0) * (1 + pad * 2);
    const rh = (r.y1 - r.y0) * (1 + pad * 2);
    return Math.max(0.001, Math.min(w / rw, h / rh));
  }

  /** Frames a rectangle, optionally animated. */
  fit(r: Rect, animate = true, pad = 0.04, dur = 0.7) {
    const z = clamp(this.fitZoom(r, pad), this.minZoom, this.maxZoom);
    this.flyTo((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, z, animate ? dur : 0);
  }

  flyTo(x: number, y: number, zoom: number, dur = 0.6) {
    this.vx = this.vy = 0;
    this.zoomTarget = null;
    if (dur <= 0) {
      this.x = x;
      this.y = y;
      this.zoom = clamp(zoom, this.minZoom, this.maxZoom);
      this.anim = null;
      this.clampState();
      return;
    }
    this.anim = { fromX: this.x, fromY: this.y, fromZ: this.zoom, toX: x, toY: y, toZ: clamp(zoom, this.minZoom, this.maxZoom), t: 0, dur };
  }

  stop() {
    this.anim = null;
    this.vx = this.vy = 0;
    this.zoomTarget = null;
  }

  panBy(dsx: number, dsy: number) {
    this.anim = null;
    this.x -= dsx / this.zoom;
    this.y -= dsy / this.zoom;
    this.clampState();
  }

  /** Zooms by `factor` keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number) {
    this.anim = null;
    const wx = this.toWorldX(sx);
    const wy = this.toWorldY(sy);
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    this.x = wx - (sx - this.cx) / this.zoom;
    this.y = wy - (sy - this.cy) / this.zoom;
    this.clampState();
  }

  /** Smoothly approaches a zoom level around a screen point (mouse wheel). */
  zoomSmooth(sx: number, sy: number, factor: number) {
    const base = this.zoomTarget ? this.zoomTarget.z : this.zoom;
    this.zoomTarget = { z: clamp(base * factor, this.minZoom, this.maxZoom), sx, sy };
    this.anim = null;
  }

  fling(vx: number, vy: number) {
    this.vx = vx;
    this.vy = vy;
  }

  get moving(): boolean {
    return !!this.anim || !!this.zoomTarget || Math.abs(this.vx) + Math.abs(this.vy) > 4;
  }

  /** Advances animations; returns true when the camera changed. */
  update(dt: number): boolean {
    let changed = false;
    if (this.anim) {
      const a = this.anim;
      a.t = Math.min(1, a.t + dt / a.dur);
      const e = easeInOutCubic(a.t);
      // Interpolate zoom geometrically so it feels even.
      this.zoom = a.fromZ * Math.pow(a.toZ / a.fromZ, e);
      this.x = a.fromX + (a.toX - a.fromX) * e;
      this.y = a.fromY + (a.toY - a.fromY) * e;
      if (a.t >= 1) this.anim = null;
      this.clampState();
      changed = true;
    }
    if (this.zoomTarget) {
      const t = this.zoomTarget;
      const a = 1 - Math.exp(-dt * 18);
      const next = this.zoom * Math.pow(t.z / this.zoom, a);
      const wx = this.toWorldX(t.sx);
      const wy = this.toWorldY(t.sy);
      this.zoom = next;
      this.x = wx - (t.sx - this.cx) / this.zoom;
      this.y = wy - (t.sy - this.cy) / this.zoom;
      if (Math.abs(Math.log(t.z / this.zoom)) < 0.002) {
        this.zoomTarget = null;
      }
      this.clampState();
      changed = true;
    }
    if (Math.abs(this.vx) + Math.abs(this.vy) > 4) {
      this.x -= (this.vx * dt) / this.zoom;
      this.y -= (this.vy * dt) / this.zoom;
      const decay = Math.pow(0.02, dt);
      this.vx *= decay;
      this.vy *= decay;
      this.clampState();
      changed = true;
    } else {
      this.vx = this.vy = 0;
    }
    return changed;
  }

  clampState() {
    this.zoom = clamp(this.zoom, this.minZoom, this.maxZoom);
    const b = this.bounds;
    // Let the centre roam over the table, a bit past its edges.
    const slackX = (this.width * 0.25) / this.zoom;
    const slackY = (this.height * 0.25) / this.zoom;
    this.x = clamp(this.x, b.x0 - slackX, b.x1 + slackX);
    this.y = clamp(this.y, b.y0 - slackY, b.y1 + slackY);
  }
}
