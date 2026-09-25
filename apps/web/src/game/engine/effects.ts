import type { ScenePiece } from './types';

interface Ripple {
  piece: ScenePiece;
  t: number;
  delay: number;
  color: string;
}

interface Particle {
  x: number;
  y: number;
  /** World units per second. */
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
}

interface Toast {
  piece: ScenePiece;
  title: string;
  subtitle: string | null;
  t: number;
  dur: number;
}

/** A little number that drifts up from a piece (points scored). */
interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  t: number;
  dur: number;
}

/** Short-lived visual rewards: outline ripples, drifting sparks and name toasts. */
export class Effects {
  ripples: Ripple[] = [];
  particles: Particle[] = [];
  toasts: Toast[] = [];
  floaters: Floater[] = [];
  /** Completion light sweep, 0..1 (or -1 when idle). */
  sweep = -1;

  get active(): boolean {
    return this.ripples.length > 0 || this.particles.length > 0 || this.toasts.length > 0 || this.floaters.length > 0 || this.sweep >= 0;
  }

  float(piece: ScenePiece, text: string, color: string) {
    const [lx, ly] = piece.model.label;
    this.floaters.push({ x: piece.model.tx + lx, y: piece.model.ty + ly, text, color, t: 0, dur: 1.5 });
  }

  snap(piece: ScenePiece, zoom: number, strong: boolean) {
    this.ripples.push({ piece, t: 0, delay: 0, color: 'rgba(255,255,255,1)' });
    if (strong) this.ripples.push({ piece, t: 0, delay: 0.09, color: piece.colors.fill });
    const n = strong ? 16 : 8;
    const [lx, ly] = piece.model.label;
    const cx = piece.model.tx + lx;
    const cy = piece.model.ty + ly;
    const spread = Math.max(piece.model.label[2] * 0.6, 6 / zoom);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      const speed = (40 + Math.random() * 70) / zoom;
      this.particles.push({
        x: cx + Math.cos(a) * spread * Math.random(),
        y: cy + Math.sin(a) * spread * Math.random(),
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 20 / zoom,
        life: 0,
        max: 0.6 + Math.random() * 0.5,
        size: 1.4 + Math.random() * 2.2,
        color: i % 3 === 0 ? 'rgba(255,255,255,0.95)' : piece.colors.fill,
      });
    }
  }

  toast(piece: ScenePiece, title: string, subtitle: string | null, dur = 2.2) {
    this.toasts = this.toasts.filter((t) => t.piece !== piece);
    this.toasts.push({ piece, title, subtitle, t: 0, dur });
    if (this.toasts.length > 4) this.toasts.shift();
  }

  startSweep() {
    this.sweep = 0;
  }

  update(dt: number) {
    for (const r of this.ripples) {
      if (r.delay > 0) r.delay -= dt;
      else r.t += dt / 0.75;
    }
    this.ripples = this.ripples.filter((r) => r.t < 1);
    for (const p of this.particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const drag = Math.pow(0.12, dt);
      p.vx *= drag;
      p.vy *= drag;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
    for (const t of this.toasts) t.t += dt;
    this.toasts = this.toasts.filter((t) => t.t < t.dur);
    for (const f of this.floaters) f.t += dt;
    this.floaters = this.floaters.filter((f) => f.t < f.dur);
    if (this.sweep >= 0) {
      this.sweep += dt / 1.8;
      if (this.sweep >= 1) this.sweep = -1;
    }
  }

  clear() {
    this.ripples = [];
    this.particles = [];
    this.toasts = [];
    this.floaters = [];
    this.sweep = -1;
  }
}
