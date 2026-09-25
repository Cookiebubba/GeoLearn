import { decodeRing, type PieceDataFile, type PuzzleDataFile } from './puzzleData';
import type { PuzzleId } from '../puzzles';

export interface PieceModel {
  id: string;
  index: number;
  /** Anchor position when correctly placed. */
  tx: number;
  ty: number;
  /** Local bbox. */
  bbox: [number, number, number, number];
  w: number;
  h: number;
  /** max(w, h) */
  size: number;
  area: number;
  /** 0 for the largest piece of the puzzle, 1 for the smallest. */
  smallness: number;
  label: [number, number, number];
  capital: [number, number] | null;
  color: number;
  data: PieceDataFile;
}

export interface PuzzleModel {
  id: PuzzleId;
  board: { width: number; height: number };
  lodZoom: number[];
  maxZoom: number;
  pieces: PieceModel[];
  byId: Map<string, PieceModel>;
  silhouette: SilhouetteIndex;
}

export function buildPuzzleModel(data: PuzzleDataFile): PuzzleModel {
  const bySize = [...data.pieces].sort((a, b) => b.area - a.area).map((p) => p.id);
  const rank = new Map(bySize.map((id, i) => [id, bySize.length > 1 ? i / (bySize.length - 1) : 0]));
  const pieces: PieceModel[] = data.pieces.map((p, index) => {
    const w = p.bbox[2] - p.bbox[0];
    const h = p.bbox[3] - p.bbox[1];
    return {
      id: p.id,
      index,
      tx: p.target[0],
      ty: p.target[1],
      bbox: p.bbox,
      w,
      h,
      size: Math.max(w, h),
      area: p.area,
      smallness: rank.get(p.id) ?? 0,
      label: p.label,
      capital: p.capital,
      color: p.color,
      data: p,
    };
  });
  return {
    id: data.id,
    board: data.board,
    lodZoom: data.lodZoom,
    maxZoom: data.maxZoom,
    pieces,
    byId: new Map(pieces.map((p) => [p.id, p])),
    silhouette: new SilhouetteIndex(pieces, data.board),
  };
}

interface IndexedRing {
  pts: Float64Array;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Point-in-land test against the union of every piece in its correct place
 * (the empty board's silhouette). Uses the coarsest LOD and a uniform grid.
 */
export class SilhouetteIndex {
  private readonly cell: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly grid: IndexedRing[][];

  constructor(pieces: PieceModel[], board: { width: number; height: number }) {
    this.cell = Math.max(board.width, board.height) / 64;
    this.cols = Math.ceil(board.width / this.cell) + 1;
    this.rows = Math.ceil(board.height / this.cell) + 1;
    this.grid = Array.from({ length: this.cols * this.rows }, () => []);
    for (const p of pieces) {
      for (const enc of p.data.rings[0]) {
        const local = decodeRing(enc);
        const pts = new Float64Array(local.length);
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (let i = 0; i < local.length; i += 2) {
          const x = local[i] + p.tx;
          const y = local[i + 1] + p.ty;
          pts[i] = x;
          pts[i + 1] = y;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
        const ring = { pts, x0, y0, x1, y1 };
        const c0 = Math.max(0, Math.floor(x0 / this.cell));
        const c1 = Math.min(this.cols - 1, Math.floor(x1 / this.cell));
        const r0 = Math.max(0, Math.floor(y0 / this.cell));
        const r1 = Math.min(this.rows - 1, Math.floor(y1 / this.cell));
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.grid[r * this.cols + c].push(ring);
      }
    }
  }

  /** True when (x, y) is on land (nonzero winding over all rings). */
  contains(x: number, y: number): boolean {
    const c = Math.floor(x / this.cell);
    const r = Math.floor(y / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
    let wn = 0;
    for (const ring of this.grid[r * this.cols + c]) {
      if (x < ring.x0 || x > ring.x1 || y < ring.y0 || y > ring.y1) continue;
      wn += windingNumber(x, y, ring.pts);
    }
    return wn !== 0;
  }

  /** True when any land lies within `radius` of (x, y) (coarse, for tiny islands). */
  near(x: number, y: number, radius: number): boolean {
    if (this.contains(x, y)) return true;
    const c0 = Math.max(0, Math.floor((x - radius) / this.cell));
    const c1 = Math.min(this.cols - 1, Math.floor((x + radius) / this.cell));
    const r0 = Math.max(0, Math.floor((y - radius) / this.cell));
    const r1 = Math.min(this.rows - 1, Math.floor((y + radius) / this.cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        for (const ring of this.grid[r * this.cols + c]) {
          if (x < ring.x0 - radius || x > ring.x1 + radius || y < ring.y0 - radius || y > ring.y1 + radius) continue;
          return true;
        }
      }
    }
    return false;
  }
}

export function windingNumber(x: number, y: number, pts: ArrayLike<number>): number {
  let wn = 0;
  const n = pts.length;
  for (let i = 0; i < n; i += 2) {
    const ax = pts[i];
    const ay = pts[i + 1];
    const j = i + 2 < n ? i + 2 : 0;
    const bx = pts[j];
    const by = pts[j + 1];
    if (ay <= y) {
      if (by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) wn++;
    } else if (by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) wn--;
  }
  return wn;
}
