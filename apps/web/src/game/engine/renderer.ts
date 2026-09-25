import type { Camera } from './camera';
import type { Effects } from './effects';
import { buildUnionPath, type PieceGeometry } from './geometry';
import { clamp, easeOutCubic } from './math';
import { ShadowCache } from './shadows';
import type { EnginePlayer, ScenePiece, Visibility } from './types';

export const TABLE_TOP = '#ffffff';
export const TABLE_BOTTOM = '#f2f2ef';
const CAVITY = '#e9e9e5';
/** Pieces smaller than this on screen (px) get a halo. */
export const HALO_BELOW = 10;
export const haloRadius = (px: number) => 4.5 + Math.max(0, HALO_BELOW - px) * 0.3;
const FONT = '"Inter Variable", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif';

export interface RenderInput {
  camera: Camera;
  dpr: number;
  lod: number;
  placed: ScenePiece[];
  settling: ScenePiece[];
  loose: ScenePiece[];
  held: ScenePiece[];
  effects: Effects;
  visibility: Visibility;
  players: Map<string, EnginePlayer>;
  cursors: Map<string, { x: number; y: number; t: number }>;
  you: string;
  now: number;
  /** 0..1: fades the board's inner shadow once the map is complete. */
  completeGlow: number;
}

interface BoardShadow {
  canvas: HTMLCanvasElement;
  x0: number;
  y0: number;
  w: number;
  h: number;
}

class FlagCache {
  private readonly images = new Map<string, HTMLImageElement | 'loading' | 'error'>();
  constructor(private readonly onLoad: () => void) {}
  get(iso2: string): HTMLImageElement | null {
    const v = this.images.get(iso2);
    if (v && v !== 'loading' && v !== 'error') return v;
    if (!v) {
      this.images.set(iso2, 'loading');
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        this.images.set(iso2, img);
        this.onLoad();
      };
      img.onerror = () => this.images.set(iso2, 'error');
      img.src = `/flags/${iso2}.svg`;
    }
    return null;
  }
}

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  private unionPaths: (Path2D | undefined)[] = [];
  private geoms: PieceGeometry[] = [];
  private board = { width: 1000, height: 1000 };
  private shadow: BoardShadow | null = null;
  private readonly restShadows = new ShadowCache();
  private readonly liftShadows = new ShadowCache();
  private readonly flags: FlagCache;
  private readonly textWidths = new Map<string, number>();
  private bg: { w: number; h: number; g: CanvasGradient } | null = null;
  /** Set when an asynchronous resource (flag) arrives and a redraw is needed. */
  wantsFrame = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.flags = new FlagCache(() => (this.wantsFrame = true));
  }

  setBoard(geoms: PieceGeometry[], board: { width: number; height: number }) {
    this.geoms = geoms;
    this.board = board;
    this.unionPaths = [];
    this.shadow = null;
  }

  /** Invalidate cached outlines after the detailed LOD arrives. */
  refreshLod(lod: number) {
    this.unionPaths[lod] = undefined;
  }

  unionPath(lod: number): Path2D {
    let p = this.unionPaths[lod];
    if (!p) {
      p = buildUnionPath(this.geoms, lod);
      this.unionPaths[lod] = p;
    }
    return p;
  }

  /**
   * The empty board is a recess in the table: one light from the upper left, so
   * the upper-left walls cast a soft shadow into it. Rendered once to a sprite.
   */
  buildBoardShadow() {
    const { width: W, height: H } = this.board;
    const margin = W * 0.03;
    const scale = Math.min(2.2, 2048 / (W + margin * 2), 2048 / (H + margin * 2));
    const cw = Math.ceil((W + margin * 2) * scale);
    const ch = Math.ceil((H + margin * 2) * scale);
    const union = this.unionPath(1);

    const mask = document.createElement('canvas');
    mask.width = cw;
    mask.height = ch;
    const m = mask.getContext('2d')!;
    m.fillStyle = '#fff';
    m.fillRect(0, 0, cw, ch);
    m.setTransform(scale, 0, 0, scale, margin * scale, margin * scale);
    m.globalCompositeOperation = 'destination-out';
    // Filled as one path: shared borders cancel out, so no internal edges exist.
    m.fill(union, 'nonzero');

    const out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    const o = out.getContext('2d')!;
    o.save();
    o.setTransform(scale, 0, 0, scale, margin * scale, margin * scale);
    o.clip(union, 'nonzero');
    o.setTransform(1, 0, 0, 1, 0, 0);
    const far = 30000;
    // Shadow from the upper-left walls.
    o.shadowColor = 'rgba(40, 42, 38, 0.42)';
    o.shadowBlur = 7 * scale;
    o.shadowOffsetX = far + 2.2 * scale;
    o.shadowOffsetY = 3.4 * scale;
    o.drawImage(mask, -far, 0);
    // A tighter contact shadow right at the rim.
    o.shadowColor = 'rgba(40, 42, 38, 0.30)';
    o.shadowBlur = 1.8 * scale;
    o.shadowOffsetX = far + 0.6 * scale;
    o.shadowOffsetY = 0.9 * scale;
    o.drawImage(mask, -far, 0);
    // Light catching the lower-right walls.
    o.shadowColor = 'rgba(255, 255, 255, 0.9)';
    o.shadowBlur = 2.6 * scale;
    o.shadowOffsetX = far - 1.4 * scale;
    o.shadowOffsetY = -2 * scale;
    o.drawImage(mask, -far, 0);
    o.restore();
    mask.width = mask.height = 0;
    this.shadow = { canvas: out, x0: -margin, y0: -margin, w: W + margin * 2, h: H + margin * 2 };
  }

  get hasBoardShadow() {
    return !!this.shadow;
  }

  clearCaches() {
    this.restShadows.clear();
    this.liftShadows.clear();
  }

  resize(cssW: number, cssH: number, dpr: number) {
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.bg = null;
    }
  }

  // ── Frame ──────────────────────────────────────────────────────────────

  render(s: RenderInput) {
    const { ctx } = this;
    const cam = s.camera;
    const dpr = s.dpr;
    this.restShadows.beginFrame();
    this.liftShadows.beginFrame();
    const budget = { n: 24 };
    const liftBudget = { n: 4 };

    // Table.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (!this.bg || this.bg.w !== cam.width || this.bg.h !== cam.height) {
      const g = ctx.createLinearGradient(0, 0, cam.width * 0.6, cam.height);
      g.addColorStop(0, TABLE_TOP);
      g.addColorStop(1, TABLE_BOTTOM);
      this.bg = { w: cam.width, h: cam.height, g };
    }
    ctx.fillStyle = this.bg.g;
    ctx.fillRect(0, 0, cam.width, cam.height);

    const view = cam.viewRect(40);
    const union = this.unionPath(s.lod);

    // The recess.
    this.setWorld(cam, dpr);
    ctx.fillStyle = CAVITY;
    ctx.fill(union, 'nonzero');

    // Pieces sitting in their home.
    for (const p of s.placed) {
      if (!this.inView(p, view, 1)) continue;
      const scale = p.press >= 0 ? 1 - 0.03 * Math.sin(Math.PI * p.press) : 1;
      this.setPiece(cam, dpr, p.rx, p.ry, scale);
      const path = p.geom.path(s.lod);
      ctx.fillStyle = p.colors.fill;
      ctx.fill(path, 'nonzero');
      // Same-colour hairline hides anti-aliasing seams between neighbours.
      ctx.strokeStyle = p.colors.fill;
      ctx.lineWidth = 0.9 / (cam.zoom * scale);
      ctx.lineJoin = 'round';
      ctx.stroke(path);
    }

    // Inner shadow over the seated pieces, so they read as inlaid.
    if (this.shadow) {
      this.setWorld(cam, dpr);
      ctx.save();
      ctx.clip(union, 'nonzero');
      ctx.globalAlpha = 1 - 0.45 * s.completeGlow;
      ctx.drawImage(this.shadow.canvas, this.shadow.x0, this.shadow.y0, this.shadow.w, this.shadow.h);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    if (s.effects.sweep >= 0) this.drawSweep(cam, dpr, union, s.effects.sweep);

    const labelsOn = s.visibility.names || s.visibility.capitals || s.visibility.flags;
    if (labelsOn) for (const p of s.placed) if (this.inView(p, view, 1)) this.drawLabels(p, cam, 1, s.visibility, false, dpr);

    // Loose pieces on the table (and pieces gliding home).
    for (const p of s.loose) this.drawLoose(p, s, view, budget, liftBudget, labelsOn);
    for (const p of s.settling) this.drawLoose(p, s, view, budget, liftBudget, labelsOn);
    // Pieces in someone's hand, mine last.
    for (const p of s.held) this.drawLoose(p, s, view, budget, liftBudget, labelsOn);

    this.drawEffects(s, cam, dpr);
    this.drawCursors(s, cam, dpr);
    if (budget.n <= 0 || liftBudget.n <= 0) this.wantsFrame = true;
  }

  private drawLoose(p: ScenePiece, s: RenderInput, view: { x0: number; y0: number; x1: number; y1: number }, budget: { n: number }, liftBudget: { n: number }, labelsOn: boolean) {
    const { ctx } = this;
    const cam = s.camera;
    const dpr = s.dpr;
    const lift = clamp(p.lift, 0, 1.2);
    const scale = 1 + 0.075 * lift + 0.018 * p.hover;
    if (!this.inView(p, view, scale)) return;
    const path = p.geom.path(s.lod);
    const sx = cam.toScreenX(p.rx);
    const sy = cam.toScreenY(p.ry);

    // Resting contact shadow.
    const restAlpha = 0.26 * (1 - Math.min(1, lift));
    if (restAlpha > 0.01) {
      const sp = this.restShadows.get(p.geom, s.lod, cam.zoom * scale, dpr, 2.4, budget);
      if (sp) this.stamp(sp, sx + 0.9, sy + 1.6, cam.zoom, scale, restAlpha, dpr);
    }
    // Lifted shadow: larger, softer, offset away from the light.
    if (lift > 0.02) {
      const sp = this.liftShadows.get(p.geom, s.lod, cam.zoom * scale, dpr, 14, liftBudget);
      if (sp) this.stamp(sp, sx + 2 + 6 * lift, sy + 4 + 9 * lift, cam.zoom, scale, 0.22 * Math.min(1, lift), dpr);
    }

    this.setPiece(cam, dpr, p.rx, p.ry, scale);
    ctx.fillStyle = lift > 0.5 ? p.colors.lifted : p.colors.fill;
    ctx.fill(path, 'nonzero');

    // Someone else's hand: a thin ring in their colour.
    if (p.heldBy && p.heldBy !== s.you) {
      const who = s.players.get(p.heldBy);
      if (who) {
        ctx.strokeStyle = who.color;
        ctx.lineWidth = 1.6 / (cam.zoom * scale);
        ctx.lineJoin = 'round';
        ctx.stroke(path);
      }
    }

    // Tiny countries get a soft halo so they can be seen and grabbed.
    const px = p.model.size * cam.zoom * scale;
    if (px < HALO_BELOW) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const lx = cam.toScreenX(p.rx + p.model.label[0] * scale);
      const ly = cam.toScreenY(p.ry + p.model.label[1] * scale);
      const r = haloRadius(px) * (1 + 0.15 * lift);
      ctx.beginPath();
      ctx.arc(lx, ly, r, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(p.colors.rgb, 0.16 + 0.18 * Math.min(1, lift));
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = withAlpha(p.colors.rgb, 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(lx, ly, Math.max(1.8, px / 2), 0, Math.PI * 2);
      ctx.fillStyle = p.colors.fill;
      ctx.fill();
    }

    if (labelsOn) this.drawLabels(p, cam, scale, s.visibility, lift > 0.5, dpr);

    if (p.heldBy && p.heldBy !== s.you) {
      const who = s.players.get(p.heldBy);
      if (who) {
        const b = p.model.bbox;
        this.nameTag(who.name, who.color, cam.toScreenX(p.rx + b[0] * scale), cam.toScreenY(p.ry + b[1] * scale) - 6, dpr);
      }
    }
  }

  /** Draws a shadow sprite under a piece anchored at screen (sx, sy). */
  private stamp(sp: { canvas: HTMLCanvasElement; scale: number; ox: number; oy: number }, sx: number, sy: number, zoom: number, scale: number, alpha: number, dpr: number) {
    const { ctx } = this;
    if (!sp.canvas.width) return;
    const k = zoom * scale;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(sp.canvas, sx + sp.ox * k, sy + sp.oy * k, (sp.canvas.width / sp.scale) * k, (sp.canvas.height / sp.scale) * k);
    ctx.globalAlpha = 1;
  }

  private setWorld(cam: Camera, dpr: number) {
    const k = dpr * cam.zoom;
    this.ctx.setTransform(k, 0, 0, k, dpr * (cam.cx - cam.x * cam.zoom), dpr * (cam.cy - cam.y * cam.zoom));
  }

  private setPiece(cam: Camera, dpr: number, x: number, y: number, scale: number) {
    const k = dpr * cam.zoom * scale;
    this.ctx.setTransform(k, 0, 0, k, dpr * (cam.cx + (x - cam.x) * cam.zoom), dpr * (cam.cy + (y - cam.y) * cam.zoom));
  }

  private inView(p: ScenePiece, v: { x0: number; y0: number; x1: number; y1: number }, scale: number) {
    const b = p.model.bbox;
    return p.rx + b[2] * scale >= v.x0 && p.rx + b[0] * scale <= v.x1 && p.ry + b[3] * scale >= v.y0 && p.ry + b[1] * scale <= v.y1;
  }

  private drawSweep(cam: Camera, dpr: number, union: Path2D, t: number) {
    const { ctx } = this;
    const { width: W, height: H } = this.board;
    this.setWorld(cam, dpr);
    ctx.save();
    ctx.clip(union, 'nonzero');
    const e = easeOutCubic(t);
    const span = W + H;
    const pos = -0.3 * span + e * 1.6 * span;
    const g = ctx.createLinearGradient(pos - 160, pos * (H / span) - 160, pos + 160, pos * (H / span) + 160);
    const a = 0.42 * Math.sin(Math.PI * Math.min(1, t * 1.15));
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, `rgba(255,255,255,${a.toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-W * 0.1, -H * 0.1, W * 1.2, H * 1.2);
    ctx.restore();
  }

  // ── Labels ─────────────────────────────────────────────────────────────

  private measure(text: string, size: number, weight: number): number {
    const key = `${weight}|${size}|${text}`;
    let w = this.textWidths.get(key);
    if (w === undefined) {
      this.ctx.font = `${weight} ${size}px ${FONT}`;
      w = this.ctx.measureText(text).width;
      if (this.textWidths.size > 4000) this.textWidths.clear();
      this.textWidths.set(key, w);
    }
    return w;
  }

  /** Splits a name onto two lines at the space nearest the middle. */
  private fitName(name: string, maxW: number, maxSize: number, minSize: number): { size: number; lines: string[] } | null {
    for (let size = maxSize; size >= minSize; size -= 0.5) {
      if (this.measure(name, size, 620) <= maxW) return { size, lines: [name] };
      const spaces = [...name.matchAll(/ /g)].map((m) => m.index!);
      if (spaces.length) {
        const mid = name.length / 2;
        const cut = spaces.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a));
        const lines = [name.slice(0, cut), name.slice(cut + 1)];
        if (lines.every((l) => this.measure(l, size, 620) <= maxW)) return { size, lines };
      }
    }
    return null;
  }

  private drawLabels(p: ScenePiece, cam: Camera, scale: number, vis: Visibility, force: boolean, dpr: number) {
    const { ctx } = this;
    const zoom = cam.zoom * scale;
    const [lx, ly, lr] = p.model.label;
    const r = Math.max(lr * zoom, 0);
    const screenW = p.model.w * zoom;
    const size = Math.max(screenW, p.model.h * zoom);
    const sx = cam.toScreenX(p.rx + lx * scale);
    const sy = cam.toScreenY(p.ry + ly * scale);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const capital =
      vis.capitals && p.model.capital && p.info.capital && (size > 30 || force)
        ? { x: cam.toScreenX(p.rx + p.model.capital[0] * scale), y: cam.toScreenY(p.ry + p.model.capital[1] * scale) }
        : null;

    let name: { size: number; lines: string[] } | null = null;
    if (vis.names && (size > 22 || force)) {
      const maxW = Math.max(r * 2.3, screenW * 1.15, force ? 400 : 34);
      name = this.fitName(p.info.name, maxW, clamp(r * 0.46, 9.5, 17), force ? 10 : 8.5);
    }
    const flagH = vis.flags && (size > 20 || force) ? clamp(r * (name ? 0.42 : 0.62), 9, 34) : 0;
    const flagW = flagH * (4 / 3);
    const nameH = name ? name.lines.length * name.size * 1.12 : 0;
    const nameW = name ? Math.max(...name.lines.map((l) => this.measure(l, name!.size, 620))) : 0;
    const gap = name && flagH ? 3 : 0;
    const blockH = nameH + flagH + gap;
    const blockW = Math.max(nameW, flagW);
    let top = sy - blockH / 2;

    // Keep the capital's dot visible: slide the label block off it.
    if (capital && blockH > 0) {
      const pad = 5;
      const inside = capital.x > sx - blockW / 2 - pad && capital.x < sx + blockW / 2 + pad && capital.y > top - pad && capital.y < top + blockH + pad;
      if (inside) {
        const below = capital.y + 8;
        const above = capital.y - 8 - blockH;
        top = Math.abs(below - top) <= Math.abs(above - top) ? below : above;
      }
    }

    let y = top;
    if (flagH) {
      const img = this.flags.get(p.info.iso2);
      if (img) {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.18)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetY = 1;
        roundRect(ctx, sx - flagW / 2, y, flagW, flagH, Math.min(3, flagH * 0.15));
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.restore();
        ctx.save();
        roundRect(ctx, sx - flagW / 2, y, flagW, flagH, Math.min(3, flagH * 0.15));
        ctx.clip();
        ctx.drawImage(img, sx - flagW / 2, y, flagW, flagH);
        ctx.restore();
      }
      y += flagH + gap;
    }

    if (name) {
      ctx.font = `620 ${name.size}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineJoin = 'round';
      for (const line of name.lines) {
        ctx.lineWidth = Math.max(2, name.size * 0.22);
        ctx.strokeStyle = p.colors.textHalo;
        ctx.strokeText(line, sx, y);
        ctx.fillStyle = p.colors.text;
        ctx.fillText(line, sx, y);
        y += name.size * 1.12;
      }
    }

    if (capital) {
      ctx.beginPath();
      ctx.arc(capital.x, capital.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(30,32,36,0.85)';
      ctx.stroke();
      // The capital's name only when there's room, and never over the country's name.
      if (size > 64 || force) {
        const fs = clamp(r * 0.3, 9, 12.5);
        const tw = this.measure(p.info.capital!, fs, 500);
        const block = { x0: sx - blockW / 2, x1: sx + blockW / 2, y0: top, y1: top + blockH };
        const hits = (x0: number) => blockH > 0 && x0 < block.x1 && x0 + tw > block.x0 && capital.y + fs / 2 > block.y0 && capital.y - fs / 2 < block.y1;
        let tx = capital.x + 6;
        let align: CanvasTextAlign = 'left';
        if (hits(tx)) {
          tx = capital.x - 6;
          align = 'right';
          if (hits(tx - tw)) tx = NaN;
        }
        if (!Number.isNaN(tx)) {
          ctx.font = `500 ${fs}px ${FONT}`;
          ctx.textAlign = align;
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 3;
          ctx.strokeStyle = p.colors.textHalo;
          ctx.strokeText(p.info.capital!, tx, capital.y);
          ctx.fillStyle = p.colors.text;
          ctx.fillText(p.info.capital!, tx, capital.y);
        }
      }
    }
  }

  private nameTag(name: string, color: string, x: number, y: number, dpr: number) {
    const { ctx } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `600 11px ${FONT}`;
    const w = this.measure(name, 11, 600) + 14;
    const h = 19;
    roundRect(ctx, x, y - h, w, h, h / 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, x + 7, y - h / 2 + 0.5);
  }

  // ── Effects & presence ─────────────────────────────────────────────────

  private drawEffects(s: RenderInput, cam: Camera, dpr: number) {
    const { ctx } = this;
    const fx = s.effects;
    for (const r of fx.ripples) {
      if (r.delay > 0) continue;
      const e = easeOutCubic(r.t);
      this.setPiece(cam, dpr, r.piece.rx, r.piece.ry, 1);
      ctx.globalAlpha = (1 - e) * 0.7;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = (1.5 + 18 * e) / cam.zoom;
      ctx.lineJoin = 'round';
      ctx.stroke(r.piece.geom.path(s.lod));
    }
    ctx.globalAlpha = 1;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const p of fx.particles) {
      const t = p.life / p.max;
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.beginPath();
      ctx.arc(cam.toScreenX(p.x), cam.toScreenY(p.y), p.size * (1 - t * 0.5), 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const t of fx.toasts) {
      const p = t.piece;
      const inT = Math.min(1, t.t / 0.25);
      const outT = Math.max(0, (t.t - (t.dur - 0.5)) / 0.5);
      const alpha = easeOutCubic(inT) * (1 - outT);
      const x = cam.toScreenX(p.rx + p.model.label[0]);
      const top = cam.toScreenY(p.ry + p.model.bbox[1]);
      const y = Math.max(40, Math.min(top, cam.toScreenY(p.ry + p.model.label[1]) - 26)) - 10 - 8 * easeOutCubic(inT) - 6 * outT;
      ctx.font = `650 14px ${FONT}`;
      const tw = this.measure(t.title, 14, 650);
      let sw = 0;
      if (t.subtitle) {
        ctx.font = `450 11.5px ${FONT}`;
        sw = this.measure(t.subtitle, 11.5, 450);
      }
      const w = Math.max(tw, sw) + 26;
      const h = t.subtitle ? 44 : 30;
      ctx.globalAlpha = alpha;
      ctx.save();
      ctx.shadowColor = 'rgba(20,20,20,0.16)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 4;
      roundRect(ctx, x - w / 2, y - h, w, h, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.96)';
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(x - w / 2 + 11, y - h + 15, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = p.colors.fill;
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#1f2125';
      ctx.font = `650 14px ${FONT}`;
      ctx.fillText(t.title, x + 3, y - h + 15.5);
      if (t.subtitle) {
        ctx.font = `450 11.5px ${FONT}`;
        ctx.fillStyle = '#6b6e75';
        ctx.fillText(t.subtitle, x + 3, y - h + 31);
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawCursors(s: RenderInput, cam: Camera, dpr: number) {
    const { ctx } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const holding = new Set(s.held.map((p) => p.heldBy));
    for (const [id, c] of s.cursors) {
      if (id === s.you || holding.has(id)) continue;
      const age = (s.now - c.t) / 1000;
      if (age > 4) continue;
      const who = s.players.get(id);
      if (!who) continue;
      const alpha = age > 3 ? 4 - age : 1;
      const x = cam.toScreenX(c.x);
      const y = cam.toScreenY(c.y);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = who.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      this.nameTag(who.name, who.color, x + 9, y + 26, dpr);
      ctx.globalAlpha = 1;
    }
  }
}

function withAlpha(rgb: [number, number, number], a: number) {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(3)})`;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
