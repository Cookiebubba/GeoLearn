import type { PuzzleModel } from '../geo/puzzleModel';
import { mulberry32, shuffle } from '../random';
import type { TableBounds } from './types';

export interface LayoutResult {
  positions: Map<string, [number, number]>;
  table: TableBounds;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

class RectHash {
  private readonly cells = new Map<number, Rect[]>();
  constructor(private readonly size: number) {}
  private key(cx: number, cy: number) {
    return (cx + 4096) * 8192 + (cy + 4096);
  }
  add(r: Rect) {
    for (let cx = Math.floor(r.x0 / this.size); cx <= Math.floor(r.x1 / this.size); cx++) {
      for (let cy = Math.floor(r.y0 / this.size); cy <= Math.floor(r.y1 / this.size); cy++) {
        const k = this.key(cx, cy);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(r);
      }
    }
  }
  /** The first placed rect overlapping `r`, if any. */
  firstHit(r: Rect): Rect | null {
    const cx1 = Math.floor(r.x1 / this.size);
    const cy1 = Math.floor(r.y1 / this.size);
    for (let cx = Math.floor(r.x0 / this.size); cx <= cx1; cx++) {
      for (let cy = Math.floor(r.y0 / this.size); cy <= cy1; cy++) {
        const list = this.cells.get(this.key(cx, cy));
        if (!list) continue;
        for (const o of list) if (r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0) return o;
      }
    }
    return null;
  }
}

/** Smallest footprint a piece gets on the table, as a fraction of the board width. */
const MIN_FOOT = 0.026;
/** Share of the free table area that footprints (with their gaps) may take. */
const FILL = 0.6;
/** How far small pieces may be spread out when the table has room to spare. */
const MAX_SPREAD = 3.2;
/** How strongly pieces prefer the emptier sides of the board. */
const SIDE_WEIGHT = 0.6;

/**
 * Lays every piece out around the empty board, upright and without overlaps.
 *
 * First the table is framed: the board plus a band on every side, shaped like
 * the players' screens (portrait phones get deep bands above and below), and
 * just big enough for the pieces. If there is room to spare, small pieces are
 * spaced further apart so they stay easy to see and grab.
 *
 * Then, largest first, each piece considers free spots on rings around the
 * board and takes the cheapest: close to the board, inside the frame, and
 * keeping every side evenly stocked for its size.
 */
export function scatterPieces(model: PuzzleModel, seed: number, targetAspect?: number): LayoutResult {
  const rand = mulberry32(seed);
  const W = model.board.width;
  const H = model.board.height;
  const boardGap = W * 0.03;
  const ringStep = W * 0.008;
  const searchDepth = W * 0.45;
  const aspect = targetAspect && Number.isFinite(targetAspect) ? Math.min(3, Math.max(0.35, targetAspect)) : W / H;

  const gapOf = (size: number) => Math.min(Math.max(size * 0.07, W * 0.006), W * 0.016);
  const footprint = (p: PuzzleModel['pieces'][number], k: number) => {
    const min = W * MIN_FOOT * k;
    return { fw: Math.max(p.w, min), fh: Math.max(p.h, min), gap: gapOf(p.size) * Math.min(k, 1.6) };
  };
  const footArea = (k: number) => {
    let a = 0;
    for (const p of model.pieces) {
      const f = footprint(p, k);
      a += (f.fw + f.gap) * (f.fh + f.gap);
    }
    return a;
  };

  // ── Frame the table ──────────────────────────────────────────────────────
  const innerW = W + 2 * boardGap;
  const innerH = H + 2 * boardGap;
  const band = W * 0.07;
  let frameW = Math.max(innerW + 2 * band, (innerH + 2 * band) * aspect);
  let frameH = frameW / aspect;
  const free = () => frameW * frameH - innerW * innerH;
  let spread = 1;
  if (footArea(1) / FILL > free()) {
    // Not enough room: grow the frame (same shape) until the pieces fit.
    const need = innerW * innerH + footArea(1) / FILL;
    frameW = Math.sqrt(need * aspect);
    frameH = frameW / aspect;
  } else {
    // Room to spare: spread small pieces out as far as it allows.
    let lo = 1;
    let hi = MAX_SPREAD;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (footArea(mid) / FILL <= free()) lo = mid;
      else hi = mid;
    }
    spread = lo;
  }
  const frame: Rect = { x0: W / 2 - frameW / 2, y0: H / 2 - frameH / 2, x1: W / 2 + frameW / 2, y1: H / 2 + frameH / 2 };
  // Area of the band on each side (top, right, bottom, left), to share pieces out fairly.
  const bandArea = [
    Math.max(1, frameW * (-boardGap - frame.y0)),
    Math.max(1, (frame.x1 - W - boardGap) * innerH),
    Math.max(1, frameW * (frame.y1 - H - boardGap)),
    Math.max(1, (-boardGap - frame.x0) * innerH),
  ];

  // ── Place the pieces ─────────────────────────────────────────────────────
  // Size-ordered, but shuffled within bands of similar size so neighbours vary.
  const sorted = [...model.pieces].sort((a, b) => b.w * b.h - a.w * a.h);
  const bands: (typeof sorted)[] = [];
  for (let i = 0; i < sorted.length; i += 5) bands.push(shuffle(sorted.slice(i, i + 5), rand));
  const order = bands.flat();

  const hash = new RectHash(W * 0.05);
  const positions = new Map<string, [number, number]>();
  const sideFill = [0, 0, 0, 0];
  let bounds: Rect = { ...frame };
  let boundsArea = frameW * frameH;
  const probe: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };

  for (const piece of order) {
    const { fw, fh, gap } = footprint(piece, spread);
    const step = Math.min(Math.max(Math.min(fw, fh) / 2, W * 0.004), W * 0.025);
    let best: { rect: Rect; side: number; cost: number } | null = null;
    let firstRing = -1;
    // The side-balance part of the cost can't go below the emptiest side's.
    let floor = Infinity;
    for (let side = 0; side < 4; side++) floor = Math.min(floor, SIDE_WEIGHT * (sideFill[side] / bandArea[side]));

    for (let r = boardGap; r < W * 6; r += ringStep) {
      if (firstRing >= 0 && r > firstRing + searchDepth) break;
      // Cost never drops below the ring distance (plus that floor), so farther rings can't win.
      if (best && (r - boardGap) / W + floor > best.cost) break;
      for (let side = 0; side < 4; side++) {
        const horizontal = side === 0 || side === 2;
        const span = horizontal ? W + 2 * r : H + 2 * r;
        const len = horizontal ? fw : fh;
        // Slide a candidate along this side of the ring. When it bumps into a
        // placed piece, jump straight past it (rings fill up fast, so this skips
        // most of the work and packs pieces snugly).
        const lo = -r + len / 2;
        const hi = Math.max(lo, -r + span - len / 2);
        let along = Math.min(hi, lo + rand() * step);
        let last = false;
        for (;;) {
          const cx = horizontal ? along : side === 3 ? -r - fw / 2 : W + r + fw / 2;
          const cy = horizontal ? (side === 0 ? -r - fh / 2 : H + r + fh / 2) : along;
          probe.x0 = cx - fw / 2 - gap / 2;
          probe.y0 = cy - fh / 2 - gap / 2;
          probe.x1 = cx + fw / 2 + gap / 2;
          probe.y1 = cy + fh / 2 + gap / 2;
          const blocker = hash.firstHit(probe);
          let next = along + step;
          if (blocker) next = Math.max(next, (horizontal ? blocker.x1 + fw / 2 : blocker.y1 + fh / 2) + gap / 2 + 1e-6);
          if (last) next = Infinity;
          else if (next > hi) {
            next = hi;
            last = true;
          }
          if (blocker) {
            if (next === Infinity || next <= along) break;
            along = next;
            continue;
          }
          // Spilling out of the frame shrinks everything on screen, so it costs a lot.
          const grownArea = (Math.max(bounds.x1, probe.x1) - Math.min(bounds.x0, probe.x0)) * (Math.max(bounds.y1, probe.y1) - Math.min(bounds.y0, probe.y0));
          const growth = (grownArea - boundsArea) / (W * H);
          const cost = (r - boardGap) / W + 4 * growth + SIDE_WEIGHT * (sideFill[side] / bandArea[side]) + rand() * 0.01;
          if (!best || cost < best.cost) best = { rect: { ...probe }, side, cost };
          if (firstRing < 0) firstRing = r;
          if (next === Infinity || next <= along) break;
          along = next;
        }
      }
    }
    if (!best) throw new Error(`layout: no room for ${piece.id}`);
    const { rect, side } = best;
    hash.add(rect);
    const cx = (rect.x0 + rect.x1) / 2;
    const cy = (rect.y0 + rect.y1) / 2;
    // The footprint is centred on the piece's bbox centre (its anchor).
    positions.set(piece.id, [round2(cx - (piece.bbox[0] + piece.bbox[2]) / 2), round2(cy - (piece.bbox[1] + piece.bbox[3]) / 2)]);
    sideFill[side] += (rect.x1 - rect.x0) * (rect.y1 - rect.y0);
    bounds = {
      x0: Math.min(bounds.x0, rect.x0),
      y0: Math.min(bounds.y0, rect.y0),
      x1: Math.max(bounds.x1, rect.x1),
      y1: Math.max(bounds.y1, rect.y1),
    };
    boundsArea = (bounds.x1 - bounds.x0) * (bounds.y1 - bounds.y0);
  }

  // Trim the frame back to what the pieces actually use.
  const used = { x0: 0, y0: 0, x1: W, y1: H };
  for (const piece of model.pieces) {
    const [x, y] = positions.get(piece.id)!;
    used.x0 = Math.min(used.x0, x + piece.bbox[0]);
    used.y0 = Math.min(used.y0, y + piece.bbox[1]);
    used.x1 = Math.max(used.x1, x + piece.bbox[2]);
    used.y1 = Math.max(used.y1, y + piece.bbox[3]);
  }
  const margin = W * 0.04;
  return {
    positions,
    table: {
      x0: round2(used.x0 - margin),
      y0: round2(used.y0 - margin),
      x1: round2(used.x1 + margin),
      y1: round2(used.y1 + margin),
    },
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
