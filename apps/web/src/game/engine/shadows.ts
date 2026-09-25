import type { PieceGeometry } from './geometry';

export interface ShadowSprite {
  canvas: HTMLCanvasElement;
  /** Sprite pixels per board unit. */
  scale: number;
  /** Board-unit offset of the sprite's top-left corner from the piece anchor. */
  ox: number;
  oy: number;
  bucket: number;
  lastUsed: number;
}

const MAX_SIDE = 1024;
const MAX_PIXELS = 12_000_000;
const FAR = 20000;

/**
 * Soft drop shadows for lifted pieces. A Gaussian shadow is expensive to draw
 * every frame, so each one is rendered once into a small sprite for the current
 * zoom level and then simply stamped under the piece.
 */
export class ShadowCache {
  private readonly sprites = new Map<string, ShadowSprite>();
  private pixels = 0;
  private frame = 0;

  /** Call once per frame; `budget` limits how many sprites may be (re)built. */
  beginFrame() {
    this.frame++;
  }

  get(geom: PieceGeometry, lod: number, zoom: number, dpr: number, blurCss: number, budget: { n: number }): ShadowSprite | null {
    const deviceZoom = zoom * dpr;
    const bucket = Math.round(Math.log2(deviceZoom) * 3);
    const key = geom.model.id;
    const cached = this.sprites.get(key);
    if (cached && (cached.bucket === bucket || budget.n <= 0)) {
      cached.lastUsed = this.frame;
      return cached;
    }
    if (budget.n <= 0) return null;
    budget.n--;

    const b = geom.model.bbox;
    const w = b[2] - b[0];
    const h = b[3] - b[1];
    const blur = blurCss * dpr;
    const pad = Math.ceil(blur * 2 + 2);
    let s = Math.pow(2, bucket / 3);
    const maxS = (MAX_SIDE - pad * 2) / Math.max(w, h, 0.01);
    if (s > maxS) s = maxS;
    const cw = Math.max(2, Math.ceil(w * s + pad * 2));
    const ch = Math.max(2, Math.ceil(h * s + pad * 2));

    const canvas = cached?.canvas ?? document.createElement('canvas');
    if (cached) this.pixels -= cached.canvas.width * cached.canvas.height;
    canvas.width = cw;
    canvas.height = ch;
    this.pixels += cw * ch;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, cw, ch);
    // Draw the silhouette far off-canvas and let only its blurred shadow land here.
    ctx.setTransform(s, 0, 0, s, pad - b[0] * s - FAR, pad - b[1] * s);
    ctx.shadowColor = '#000';
    ctx.shadowBlur = blur * (s / Math.pow(2, bucket / 3));
    ctx.shadowOffsetX = FAR;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = '#000';
    ctx.fill(geom.path(lod), 'nonzero');
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const sprite: ShadowSprite = { canvas, scale: s, ox: b[0] - pad / s, oy: b[1] - pad / s, bucket, lastUsed: this.frame };
    this.sprites.set(key, sprite);
    this.evict();
    return sprite;
  }

  private evict() {
    if (this.pixels <= MAX_PIXELS) return;
    const byAge = [...this.sprites.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [key, sp] of byAge) {
      if (this.pixels <= MAX_PIXELS * 0.7) break;
      this.pixels -= sp.canvas.width * sp.canvas.height;
      sp.canvas.width = sp.canvas.height = 0;
      this.sprites.delete(key);
    }
  }

  clear() {
    for (const sp of this.sprites.values()) sp.canvas.width = sp.canvas.height = 0;
    this.sprites.clear();
    this.pixels = 0;
  }
}
