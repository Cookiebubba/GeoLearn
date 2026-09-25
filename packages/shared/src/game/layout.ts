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
  hits(r: Rect): boolean {
    for (let cx = Math.floor(r.x0 / this.size); cx <= Math.floor(r.x1 / this.size); cx++) {
      for (let cy = Math.floor(r.y0 / this.size); cy <= Math.floor(r.y1 / this.size); cy++) {
        const list = this.cells.get(this.key(cx, cy));
        if (!list) continue;
        for (const o of list) if (r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0) return true;
      }
    }
    return false;
  }
}

/**
 * Lays every piece out around the empty board, upright and without overlaps.
 *
 * Largest pieces go first. Each piece considers free spots on rings around the
 * board and takes the cheapest: close to the board, not growing the table (so
 * gaps get filled and the whole table fits a phone screen nicely), and keeping
 * the four sides evenly stocked.
 */
export function scatterPieces(model: PuzzleModel, seed: number): LayoutResult {
  const rand = mulberry32(seed);
  const W = model.board.width;
  const H = model.board.height;
  const minFoot = W * 0.014;
  const boardGap = W * 0.03;
  const ringStep = W * 0.008;
  const searchDepth = W * 0.45;

  // Size-ordered, but shuffled within bands of similar size so neighbours vary.
  const sorted = [...model.pieces].sort((a, b) => b.w * b.h - a.w * a.h);
  const bands: (typeof sorted)[] = [];
  for (let i = 0; i < sorted.length; i += 5) bands.push(shuffle(sorted.slice(i, i + 5), rand));
  const order = bands.flat();

  const hash = new RectHash(W * 0.05);
  const positions = new Map<string, [number, number]>();
  const sideFill = [0, 0, 0, 0];
  const sideLen = [W, H, W, H];
  let bounds: Rect = { x0: -boardGap, y0: -boardGap, x1: W + boardGap, y1: H + boardGap };
  const area = (b: Rect) => (b.x1 - b.x0) * (b.y1 - b.y0);
  const boardAspect = W / H;

  for (const piece of order) {
    const fw = Math.max(piece.w, minFoot);
    const fh = Math.max(piece.h, minFoot);
    const gap = Math.min(Math.max(piece.size * 0.07, W * 0.006), W * 0.016);
    const step = Math.min(Math.max(Math.min(fw, fh) / 2, W * 0.004), W * 0.025);
    let best: { rect: Rect; side: number; cost: number } | null = null;
    let firstRing = -1;

    for (let r = boardGap; r < W * 4; r += ringStep) {
      if (firstRing >= 0 && r > firstRing + searchDepth) break;
      // Cost never drops below the ring distance, so farther rings can't win.
      if (best && (r - boardGap) / W > best.cost) break;
      for (let side = 0; side < 4; side++) {
        const horizontal = side === 0 || side === 2;
        const span = horizontal ? W + 2 * r : H + 2 * r;
        const len = horizontal ? fw : fh;
        const count = Math.max(1, Math.floor((span - len) / step) + 1);
        const offset = rand() * step;
        for (let i = 0; i < count; i++) {
          const along = -r + len / 2 + Math.min(i * step + offset, span - len);
          const cx = horizontal ? along : side === 3 ? -r - fw / 2 : W + r + fw / 2;
          const cy = horizontal ? (side === 0 ? -r - fh / 2 : H + r + fh / 2) : along;
          const rect = { x0: cx - fw / 2 - gap / 2, y0: cy - fh / 2 - gap / 2, x1: cx + fw / 2 + gap / 2, y1: cy + fh / 2 + gap / 2 };
          if (hash.hits(rect)) continue;
          const grown = {
            x0: Math.min(bounds.x0, rect.x0),
            y0: Math.min(bounds.y0, rect.y0),
            x1: Math.max(bounds.x1, rect.x1),
            y1: Math.max(bounds.y1, rect.y1),
          };
          const growth = (area(grown) - area(bounds)) / (W * H);
          // Keep the table the same shape as the board, so the ring of pieces is even.
          const aspect = (grown.x1 - grown.x0) / (grown.y1 - grown.y0);
          const shape = Math.abs(Math.log(aspect / boardAspect));
          const cost = (r - boardGap) / W + 2.5 * growth + 1.2 * shape + 0.25 * (sideFill[side] / sideLen[side] / W) + rand() * 0.01;
          if (!best || cost < best.cost) best = { rect, side, cost };
          if (firstRing < 0) firstRing = r;
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
    sideFill[side] += fw * fh;
    bounds = {
      x0: Math.min(bounds.x0, rect.x0),
      y0: Math.min(bounds.y0, rect.y0),
      x1: Math.max(bounds.x1, rect.x1),
      y1: Math.max(bounds.y1, rect.y1),
    };
  }

  const margin = W * 0.04;
  return {
    positions,
    table: {
      x0: round2(bounds.x0 - margin),
      y0: round2(bounds.y0 - margin),
      x1: round2(bounds.x1 + margin),
      y1: round2(bounds.y1 + margin),
    },
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
