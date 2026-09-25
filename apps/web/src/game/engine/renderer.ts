import type { Camera } from './camera';
import type { Effects } from './effects';
import { buildUnionPath, type PieceGeometry } from './geometry';
import { clamp, easeOutCubic } from './math';
import { ShadowCache } from './shadows';
import type { EnginePlayer, ScenePiece, Visibility } from './types';

const CAVITY = '#e9e9e5';
const FONT = '"Inter Variable", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
/** Pieces smaller than this on screen (px) get a halo. */
export const HALO_BELOW = 10;
export const haloRadius = (px: number) => 4.5 + Math.max(0, HALO_BELOW - px) * 0.3;
/** Extra area rendered around the viewport in the static layer (fraction of the viewport). */
const LAYER_MARGIN = 0.2;
/** The static layer never needs more than 2× density; held pieces draw at full DPR. */
const STATIC_MAX_DPR = 2;

export interface RenderInput {
  camera: Camera;
  dpr: number;
  lod: number;
  /** Seated pieces that aren't animating (largest first, so enclaves sit on top). */
  staticPlaced: ScenePiece[];
  /** Resting loose pieces (bottom to top). */
  staticLoose: ScenePiece[];
  /** Seated pieces playing their little press animation. */
  pressing: ScenePiece[];
  /** Pieces gliding home. */
  settling: ScenePiece[];
  /** Loose pieces that are moving / hovered (bottom to top). */
  moving: ScenePiece[];
  /** Pieces in someone's hand, mine last. */
  held: ScenePiece[];
  /** Bumped by the engine whenever the static layer's content changes. */
  staticVersion: number;
  /** The camera is mid-gesture/animation: the static layer may be stretched. */
  cameraMoving: boolean;
  effects: Effects;
  visibility: Visibility;
  players: Map<string, EnginePlayer>;
  cursors: Map<string, { x: number; y: number; t: number }>;
  you: string;
  now: number;
  /** 0..1: fades the board's inner shadow once the map is complete. */
  completeGlow: number;
}

/** Camera-like mapping between board units and a drawing surface (CSS px). */
interface View {
  x: number;
  y: number;
  zoom: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

const sx = (v: View, wx: number) => (wx - v.x) * v.zoom + v.cx;
const sy = (v: View, wy: number) => (wy - v.y) * v.zoom + v.cy;

function viewRect(v: View, margin = 0) {
  return {
    x0: (-margin - v.cx) / v.zoom + v.x,
    y0: (-margin - v.cy) / v.zoom + v.y,
    x1: (v.width + margin - v.cx) / v.zoom + v.x,
    y1: (v.height + margin - v.cy) / v.zoom + v.y,
  };
}

interface BoardShadow {
  canvas: HTMLCanvasElement;
  x0: number;
  y0: number;
  w: number;
  h: number;
}

interface Layer {
  /** Camera the layer was rendered with. */
  x: number;
  y: number;
  zoom: number;
  cx: number;
  cy: number;
  /** Margin (CSS px) around the viewport. */
  mx: number;
  my: number;
  key: string;
  world: { x0: number; y0: number; x1: number; y1: number };
  transform: string;
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

/**
 * Two canvases:
 * - the static layer (board, seated and resting pieces) is rendered rarely and
 *   moved with a GPU-composited CSS transform while you pan and pinch;
 * - the dynamic layer draws only what moves (held pieces, effects, cursors).
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private readonly sctx: CanvasRenderingContext2D;
  private readonly dctx: CanvasRenderingContext2D;
  private unionPaths: (Path2D | undefined)[] = [];
  private geoms: PieceGeometry[] = [];
  private board = { width: 1000, height: 1000 };
  private shadow: BoardShadow | null = null;
  private readonly restShadows = new ShadowCache();
  private readonly liftShadows = new ShadowCache();
  private readonly flags: FlagCache;
  private readonly textWidths = new Map<string, number>();
  private layer: Layer | null = null;
  /** Some shadow sprites were stale in the last static render; refresh when idle. */
  private staleSprites = false;
  private flagVersion = 0;
  private dynamicDirty = true;
  private cssW = 1;
  private cssH = 1;
  /** Set when something asynchronous (a flag, a shadow sprite) needs another frame. */
  wantsFrame = false;
  /** Number of static-layer renders (for tests / diagnostics). */
  staticRenders = 0;

  constructor(
    readonly staticCanvas: HTMLCanvasElement,
    readonly dynamicCanvas: HTMLCanvasElement,
  ) {
    const s = staticCanvas.getContext('2d');
    const d = dynamicCanvas.getContext('2d');
    if (!s || !d) throw new Error('Canvas 2D is not available');
    this.sctx = s;
    this.dctx = d;
    this.ctx = d;
    this.flags = new FlagCache(() => {
      this.flagVersion++;
      this.wantsFrame = true;
    });
    staticCanvas.style.transformOrigin = '0 0';
    staticCanvas.style.willChange = 'transform';
  }

  setBoard(geoms: PieceGeometry[], board: { width: number; height: number }) {
    this.geoms = geoms;
    this.board = board;
    this.unionPaths = [];
    this.shadow = null;
    this.layer = null;
  }

  /** Invalidate cached outlines after the detailed LOD arrives. */
  refreshLod(lod: number) {
    this.unionPaths[lod] = undefined;
    this.layer = null;
  }

  invalidate() {
    this.layer = null;
    this.dynamicDirty = true;
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
    this.layer = null;
  }

  /** Forces pending canvas work to rasterize (benchmarks only). */
  flush() {
    this.sctx.getImageData(0, 0, 1, 1);
    this.dctx.getImageData(0, 0, 1, 1);
  }

  get hasBoardShadow() {
    return !!this.shadow;
  }

  clearCaches() {
    this.restShadows.clear();
    this.liftShadows.clear();
    this.staticCanvas.width = this.staticCanvas.height = 0;
    this.dynamicCanvas.width = this.dynamicCanvas.height = 0;
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.cssW = cssW;
    this.cssH = cssH;
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.dynamicCanvas.width !== w || this.dynamicCanvas.height !== h) {
      this.dynamicCanvas.width = w;
      this.dynamicCanvas.height = h;
    }
    this.layer = null;
    this.dynamicDirty = true;
  }

  // ── Frame ──────────────────────────────────────────────────────────────

  render(s: RenderInput) {
    this.restShadows.beginFrame();
    this.liftShadows.beginFrame();
    const cam = s.camera;
    const main: View = { x: cam.x, y: cam.y, zoom: cam.zoom, cx: cam.cx, cy: cam.cy, width: cam.width, height: cam.height };

    // Static layer: re-render only when needed, otherwise just move it.
    const key = [
      s.lod,
      s.staticVersion,
      s.dpr,
      cam.width,
      cam.height,
      cam.cx,
      cam.cy,
      visKey(s.visibility),
      Math.round(s.completeGlow * 20),
      this.shadow ? 1 : 0,
      this.flagVersion,
    ].join('|');
    if (this.needsStatic(s, main, key)) this.renderStatic(s, main, key);
    this.positionLayer(main);

    // Dynamic layer.
    const hasDynamic = s.pressing.length + s.settling.length + s.moving.length + s.held.length > 0 || s.effects.active || s.cursors.size > 0;
    if (!hasDynamic && !this.dynamicDirty) return;
    const ctx = this.dctx;
    this.ctx = ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.dynamicCanvas.width, this.dynamicCanvas.height);
    this.dynamicDirty = hasDynamic;
    if (!hasDynamic) return;

    const view = viewRect(main, 40);
    const budget = { n: 12 };
    const liftBudget = { n: 4 };
    const labelsOn = s.visibility.names || s.visibility.capitals || s.visibility.flags;
    for (const p of s.pressing) {
      if (this.inView(p, view, 1)) this.drawSeated(p, main, s.lod, s.dpr);
    }
    if (s.effects.sweep >= 0) this.drawSweep(main, s.dpr, this.unionPath(s.lod), s.effects.sweep);
    if (labelsOn) for (const p of s.pressing) if (this.inView(p, view, 1)) this.drawLabels(p, main, 1, s.visibility, false, s.dpr);
    for (const p of s.moving) this.drawLoose(p, s, main, view, budget, liftBudget, labelsOn);
    for (const p of s.settling) this.drawLoose(p, s, main, view, budget, liftBudget, labelsOn);
    for (const p of s.held) this.drawLoose(p, s, main, view, budget, liftBudget, labelsOn);
    this.drawEffects(s, main, s.dpr);
    this.drawCursors(s, main, s.dpr);
    if (budget.n <= 0 || liftBudget.n <= 0) this.wantsFrame = true;
  }

  private needsStatic(s: RenderInput, v: View, key: string): boolean {
    const L = this.layer;
    if (!L || L.key !== key) return true;
    const k = v.zoom / L.zoom;
    // Stretched too far to look right, or the view has left the rendered area.
    if (k > 1.9 || k < 0.55) return true;
    const r = viewRect(v, 0);
    if (r.x0 < L.world.x0 || r.y0 < L.world.y0 || r.x1 > L.world.x1 || r.y1 > L.world.y1) return true;
    // Once things settle, re-render crisp at the exact camera.
    if (!s.cameraMoving && (Math.abs(k - 1) > 1e-4 || Math.abs(sx(v, L.x) - L.cx) > 0.01 || Math.abs(sy(v, L.y) - L.cy) > 0.01)) return true;
    if (!s.cameraMoving && this.staleSprites) return true;
    return false;
  }

  private renderStatic(s: RenderInput, v: View, key: string) {
    this.staticRenders++;
    const dpr = Math.min(s.dpr, STATIC_MAX_DPR);
    const mx = Math.round(this.cssW * LAYER_MARGIN);
    const my = Math.round(this.cssH * LAYER_MARGIN);
    const lw = this.cssW + mx * 2;
    const lh = this.cssH + my * 2;
    const canvas = this.staticCanvas;
    const pw = Math.max(1, Math.round(lw * dpr));
    const ph = Math.max(1, Math.round(lh * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      canvas.style.width = `${lw}px`;
      canvas.style.height = `${lh}px`;
    }
    const lv: View = { x: v.x, y: v.y, zoom: v.zoom, cx: v.cx + mx, cy: v.cy + my, width: lw, height: lh };
    const ctx = this.sctx;
    this.ctx = ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, pw, ph);

    const view = viewRect(lv, 40);
    const union = this.unionPath(s.lod);
    // Rebuild at most this many shadow sprites per render; stale ones are reused
    // (slightly off in blur) and refreshed over the next idle frames.
    const budget = { n: 36 };

    // The recess.
    this.setWorld(lv, dpr);
    ctx.fillStyle = CAVITY;
    ctx.fill(union, 'nonzero');

    for (const p of s.staticPlaced) if (this.inView(p, view, 1)) this.drawSeated(p, lv, s.lod, dpr);

    // Inner shadow over the seated pieces, so they read as inlaid.
    if (this.shadow) {
      this.setWorld(lv, dpr);
      ctx.save();
      ctx.clip(union, 'nonzero');
      ctx.globalAlpha = 1 - 0.45 * s.completeGlow;
      ctx.drawImage(this.shadow.canvas, this.shadow.x0, this.shadow.y0, this.shadow.w, this.shadow.h);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    const labelsOn = s.visibility.names || s.visibility.capitals || s.visibility.flags;
    if (labelsOn) for (const p of s.staticPlaced) if (this.inView(p, view, 1)) this.drawLabels(p, lv, 1, s.visibility, false, dpr);

    // Resting pieces: shadows first, then the pieces.
    const visible = s.staticLoose.filter((p) => this.inView(p, view, 1));
    for (const p of visible) this.drawRestShadow(p, lv, s.lod, dpr, budget);
    for (const p of visible) {
      this.setPiece(lv, dpr, p.rx, p.ry, 1);
      ctx.fillStyle = p.colors.fill;
      ctx.fill(p.geom.path(s.lod), 'nonzero');
    }
    this.drawHalos(visible, lv, dpr);
    if (labelsOn) for (const p of visible) this.drawLabels(p, lv, 1, s.visibility, false, dpr);
    this.staleSprites = budget.n <= 0;
    if (this.staleSprites) this.wantsFrame = true;

    this.layer = { x: v.x, y: v.y, zoom: v.zoom, cx: v.cx, cy: v.cy, mx, my, key, world: viewRect(lv, 0), transform: '' };
  }

  /** Moves/stretches the static layer to match the current camera (GPU composited). */
  private positionLayer(v: View) {
    const L = this.layer;
    if (!L) return;
    const k = v.zoom / L.zoom;
    const tx = (-L.mx - L.cx) * k + (L.x - v.x) * v.zoom + v.cx;
    const ty = (-L.my - L.cy) * k + (L.y - v.y) * v.zoom + v.cy;
    const t = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${k.toFixed(5)})`;
    if (t !== L.transform) {
      L.transform = t;
      this.staticCanvas.style.transform = t;
    }
  }

  // ── Pieces ─────────────────────────────────────────────────────────────

  private drawSeated(p: ScenePiece, v: View, lod: number, dpr: number) {
    const ctx = this.ctx;
    // The "seated" press is a fixed ~1.5px squeeze, so big countries don't gape.
    const sizePx = Math.max(1, p.model.size * v.zoom);
    const scale = p.press >= 0 ? 1 - Math.min(0.03, 3 / sizePx) * Math.sin(Math.PI * p.press) : 1;
    this.setPiece(v, dpr, p.rx, p.ry, scale);
    const path = p.geom.path(lod);
    ctx.fillStyle = p.colors.fill;
    ctx.fill(path, 'nonzero');
    // Same-colour hairline hides anti-aliasing seams between neighbours.
    ctx.strokeStyle = p.colors.fill;
    ctx.lineWidth = 0.9 / (v.zoom * scale);
    ctx.lineJoin = 'round';
    ctx.stroke(path);
    const light = (p.glow >= 0 ? 0.38 * Math.sin(Math.PI * p.glow) : 0) + (p.press >= 0 ? 0.16 * Math.sin(Math.PI * p.press) : 0);
    if (light > 0.005) {
      ctx.fillStyle = `rgba(255,255,255,${light.toFixed(3)})`;
      ctx.fill(path, 'nonzero');
      ctx.strokeStyle = ctx.fillStyle;
      ctx.stroke(path);
    }
  }

  private drawRestShadow(p: ScenePiece, v: View, lod: number, dpr: number, budget: { n: number }) {
    const sp = this.restShadows.get(p.geom, lod, v.zoom, dpr, 2.4, budget);
    if (sp) this.stamp(sp, sx(v, p.rx) + 0.9, sy(v, p.ry) + 1.6, v.zoom, 1, 0.26, dpr);
  }

  /** Soft rings that make tiny countries visible and easy to grab. Batched. */
  private drawHalos(pieces: ScenePiece[], v: View, dpr: number) {
    const ctx = this.ctx;
    const tiny = pieces.filter((p) => p.model.size * v.zoom < HALO_BELOW);
    if (!tiny.length) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rings = new Path2D();
    for (const p of tiny) {
      const px = p.model.size * v.zoom;
      const x = sx(v, p.rx + p.model.label[0]);
      const y = sy(v, p.ry + p.model.label[1]);
      const r = haloRadius(px);
      rings.moveTo(x + r, y);
      rings.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill(rings);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(60,62,58,0.28)';
    ctx.stroke(rings);
    for (const p of tiny) {
      const px = p.model.size * v.zoom;
      ctx.beginPath();
      ctx.arc(sx(v, p.rx + p.model.label[0]), sy(v, p.ry + p.model.label[1]), Math.max(2.2, px / 2), 0, Math.PI * 2);
      ctx.fillStyle = p.colors.fill;
      ctx.fill();
    }
  }

  private drawLoose(
    p: ScenePiece,
    s: RenderInput,
    v: View,
    view: { x0: number; y0: number; x1: number; y1: number },
    budget: { n: number },
    liftBudget: { n: number },
    labelsOn: boolean,
  ) {
    const ctx = this.ctx;
    const dpr = s.dpr;
    const lift = clamp(p.lift, 0, 1.2);
    const scale = 1 + 0.075 * lift + 0.018 * p.hover;
    if (!this.inView(p, view, scale)) return;
    const path = p.geom.path(s.lod);
    const ax = sx(v, p.rx);
    const ay = sy(v, p.ry);

    const restAlpha = 0.26 * (1 - Math.min(1, lift));
    if (restAlpha > 0.01) {
      const sp = this.restShadows.get(p.geom, s.lod, v.zoom * scale, dpr, 2.4, budget);
      if (sp) this.stamp(sp, ax + 0.9, ay + 1.6, v.zoom, scale, restAlpha, dpr);
    }
    if (lift > 0.02) {
      const sp = this.liftShadows.get(p.geom, s.lod, v.zoom * scale, dpr, 14, liftBudget);
      if (sp) this.stamp(sp, ax + 2 + 6 * lift, ay + 4 + 9 * lift, v.zoom, scale, 0.22 * Math.min(1, lift), dpr);
    }

    this.setPiece(v, dpr, p.rx, p.ry, scale);
    ctx.fillStyle = lift > 0.5 ? p.colors.lifted : p.colors.fill;
    ctx.fill(path, 'nonzero');

    // Someone else's hand: a thin ring in their colour.
    if (p.heldBy && p.heldBy !== s.you) {
      const who = s.players.get(p.heldBy);
      if (who) {
        ctx.strokeStyle = who.color;
        ctx.lineWidth = 1.6 / (v.zoom * scale);
        ctx.lineJoin = 'round';
        ctx.stroke(path);
      }
    }

    const px = p.model.size * v.zoom * scale;
    if (px < HALO_BELOW) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const lx = sx(v, p.rx + p.model.label[0] * scale);
      const ly = sy(v, p.ry + p.model.label[1] * scale);
      const r = haloRadius(px) * (1 + 0.15 * lift);
      ctx.beginPath();
      ctx.arc(lx, ly, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = p.heldBy && p.heldBy !== s.you ? (s.players.get(p.heldBy)?.color ?? 'rgba(60,62,58,0.3)') : 'rgba(60,62,58,0.3)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(lx, ly, Math.max(2.2, px / 2), 0, Math.PI * 2);
      ctx.fillStyle = p.colors.fill;
      ctx.fill();
    }

    if (labelsOn) this.drawLabels(p, v, scale, s.visibility, lift > 0.5, dpr);

    if (p.heldBy && p.heldBy !== s.you) {
      const who = s.players.get(p.heldBy);
      if (who) {
        const b = p.model.bbox;
        this.nameTag(who.name, who.color, sx(v, p.rx + b[0] * scale), sy(v, p.ry + b[1] * scale) - 6, dpr);
      }
    }
  }

  /** Draws a shadow sprite under a piece anchored at screen (ax, ay). */
  private stamp(
    sp: { canvas: HTMLCanvasElement; scale: number; ox: number; oy: number },
    ax: number,
    ay: number,
    zoom: number,
    scale: number,
    alpha: number,
    dpr: number,
  ) {
    const ctx = this.ctx;
    if (!sp.canvas.width) return;
    const k = zoom * scale;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(sp.canvas, ax + sp.ox * k, ay + sp.oy * k, (sp.canvas.width / sp.scale) * k, (sp.canvas.height / sp.scale) * k);
    ctx.globalAlpha = 1;
  }

  private setWorld(v: View, dpr: number) {
    const k = dpr * v.zoom;
    this.ctx.setTransform(k, 0, 0, k, dpr * (v.cx - v.x * v.zoom), dpr * (v.cy - v.y * v.zoom));
  }

  private setPiece(v: View, dpr: number, x: number, y: number, scale: number) {
    const k = dpr * v.zoom * scale;
    this.ctx.setTransform(k, 0, 0, k, dpr * (v.cx + (x - v.x) * v.zoom), dpr * (v.cy + (y - v.y) * v.zoom));
  }

  private inView(p: ScenePiece, r: { x0: number; y0: number; x1: number; y1: number }, scale: number) {
    const b = p.model.bbox;
    return p.rx + b[2] * scale >= r.x0 && p.rx + b[0] * scale <= r.x1 && p.ry + b[3] * scale >= r.y0 && p.ry + b[1] * scale <= r.y1;
  }

  private drawSweep(v: View, dpr: number, union: Path2D, t: number) {
    const ctx = this.ctx;
    const { width: W, height: H } = this.board;
    this.setWorld(v, dpr);
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

  private drawLabels(p: ScenePiece, v: View, scale: number, vis: Visibility, force: boolean, dpr: number) {
    const ctx = this.ctx;
    const zoom = v.zoom * scale;
    const [lx, ly, lr] = p.model.label;
    const r = Math.max(lr * zoom, 0);
    const screenW = p.model.w * zoom;
    const size = Math.max(screenW, p.model.h * zoom);
    const px = sx(v, p.rx + lx * scale);
    const py = sy(v, p.ry + ly * scale);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const capital =
      vis.capitals && p.model.capital && p.info.capital && (size > 30 || force)
        ? { x: sx(v, p.rx + p.model.capital[0] * scale), y: sy(v, p.ry + p.model.capital[1] * scale) }
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
    let top = py - blockH / 2;

    // Keep the capital's dot visible: slide the label block off it.
    if (capital && blockH > 0) {
      const pad = 5;
      const inside = capital.x > px - blockW / 2 - pad && capital.x < px + blockW / 2 + pad && capital.y > top - pad && capital.y < top + blockH + pad;
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
        roundRect(ctx, px - flagW / 2, y, flagW, flagH, Math.min(3, flagH * 0.15));
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.restore();
        ctx.save();
        roundRect(ctx, px - flagW / 2, y, flagW, flagH, Math.min(3, flagH * 0.15));
        ctx.clip();
        ctx.drawImage(img, px - flagW / 2, y, flagW, flagH);
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
        ctx.strokeText(line, px, y);
        ctx.fillStyle = p.colors.text;
        ctx.fillText(line, px, y);
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
        const block = { x0: px - blockW / 2, x1: px + blockW / 2, y0: top, y1: top + blockH };
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
    const ctx = this.ctx;
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

  private drawEffects(s: RenderInput, v: View, dpr: number) {
    const ctx = this.ctx;
    const fx = s.effects;
    for (const r of fx.ripples) {
      if (r.delay > 0) continue;
      const e = easeOutCubic(r.t);
      this.setPiece(v, dpr, r.piece.rx, r.piece.ry, 1);
      ctx.globalAlpha = (1 - e) * 0.7;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = (1.5 + 18 * e) / v.zoom;
      ctx.lineJoin = 'round';
      ctx.stroke(r.piece.geom.path(s.lod));
    }
    ctx.globalAlpha = 1;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const p of fx.particles) {
      const t = p.life / p.max;
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.beginPath();
      ctx.arc(sx(v, p.x), sy(v, p.y), p.size * (1 - t * 0.5), 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const t of fx.toasts) {
      const p = t.piece;
      const inT = Math.min(1, t.t / 0.25);
      const outT = Math.max(0, (t.t - (t.dur - 0.5)) / 0.5);
      const alpha = easeOutCubic(inT) * (1 - outT);
      const x = clamp(sx(v, p.rx + p.model.label[0]), 80, v.width - 80);
      const top = sy(v, p.ry + p.model.bbox[1]);
      const y = Math.max(104, Math.min(top, sy(v, p.ry + p.model.label[1]) - 26)) - 10 - 8 * easeOutCubic(inT) - 6 * outT;
      ctx.font = `650 14px ${FONT}`;
      const tw = this.measure(t.title, 14, 650);
      let sw = 0;
      if (t.subtitle) {
        ctx.font = `450 11.5px ${FONT}`;
        sw = this.measure(t.subtitle, 11.5, 450);
      }
      const w = Math.max(tw, sw) + 26;
      const h = t.subtitle ? 44 : 30;
      // Stack toasts that would overlap.
      let yy = y;
      for (let guard = 0; guard < 6; guard++) {
        const hit = placed.find((r) => x - w / 2 < r.x1 && x + w / 2 > r.x0 && yy - h < r.y1 && yy > r.y0);
        if (!hit) break;
        yy = hit.y0 - 6;
      }
      placed.push({ x0: x - w / 2, y0: yy - h, x1: x + w / 2, y1: yy });
      const y2 = yy;
      ctx.globalAlpha = alpha;
      ctx.save();
      ctx.shadowColor = 'rgba(20,20,20,0.16)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 4;
      roundRect(ctx, x - w / 2, y2 - h, w, h, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.96)';
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(x - w / 2 + 11, y2 - h + 15, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = p.colors.fill;
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#1f2125';
      ctx.font = `650 14px ${FONT}`;
      ctx.fillText(t.title, x + 3, y2 - h + 15.5);
      if (t.subtitle) {
        ctx.font = `450 11.5px ${FONT}`;
        ctx.fillStyle = '#6b6e75';
        ctx.fillText(t.subtitle, x + 3, y2 - h + 31);
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawCursors(s: RenderInput, v: View, dpr: number) {
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const holding = new Set(s.held.map((p) => p.heldBy));
    for (const [id, c] of s.cursors) {
      if (id === s.you || holding.has(id)) continue;
      const age = (s.now - c.t) / 1000;
      if (age > 4) continue;
      const who = s.players.get(id);
      if (!who) continue;
      const alpha = age > 3 ? 4 - age : 1;
      const x = sx(v, c.x);
      const y = sy(v, c.y);
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

function visKey(v: Visibility) {
  return `${+v.names}${+v.capitals}${+v.flags}`;
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
