import type { PuzzleId } from '../puzzles';

/**
 * On-disk format produced by packages/geo (see packages/geo/src/build.ts).
 *
 * Coordinates are "board units": every board is 1000 units wide.
 * Piece geometry is stored relative to the piece's anchor (the centre of its
 * bounding box when sitting in its correct place). Rings are delta-encoded
 * integers in hundredths of a unit: [x0, y0, dx1, dy1, dx2, dy2, ...].
 * Exterior rings are clockwise on screen (y down), holes counter-clockwise, so a
 * single path filled with the "nonzero" rule renders any set of pieces as their
 * exact union — which is how the empty board silhouette is drawn.
 */
export const COORD_SCALE = 100;

export interface PuzzleDataFile {
  id: PuzzleId;
  version: number;
  board: { width: number; height: number };
  /**
   * Level-of-detail switch points, in screen pixels per board unit. The last LOD is
   * shipped separately in `<id>.detail.json` (see PuzzleDetailFile).
   */
  lodZoom: number[];
  /** Largest sensible zoom, in screen pixels per board unit. */
  maxZoom: number;
  pieces: PieceDataFile[];
}

export interface PuzzleDetailFile {
  id: PuzzleId;
  version: number;
  /** Index of the LOD this file provides. */
  lod: number;
  rings: Record<string, number[][]>;
}

export interface PieceDataFile {
  id: string;
  /** Anchor position when correctly placed (board units). */
  target: [number, number];
  /** Local bounding box [minX, minY, maxX, maxY]. */
  bbox: [number, number, number, number];
  /** Area in board units². */
  area: number;
  /** Label anchor (local) and radius of the largest inscribed circle. */
  label: [number, number, number];
  /** Capital city position (local), if it lies on this piece. */
  capital: [number, number] | null;
  /** Global colour slot, stable across puzzles (neighbours never share a slot). */
  color: number;
  /** rings[lod][ring] = delta-encoded integer ring. */
  rings: number[][][];
}

export interface CatalogEntry {
  id: PuzzleId;
  pieces: number;
  board: { width: number; height: number };
  /** Silhouette as an SVG path in a 100-unit-wide box. */
  silhouette: string;
  silhouetteHeight: number;
}

export function decodeRing(encoded: number[]): Float64Array {
  const out = new Float64Array(encoded.length);
  let x = 0;
  let y = 0;
  for (let i = 0; i < encoded.length; i += 2) {
    x += encoded[i];
    y += encoded[i + 1];
    out[i] = x / COORD_SCALE;
    out[i + 1] = y / COORD_SCALE;
  }
  return out;
}

export function encodeRing(points: ArrayLike<number>): number[] {
  const out: number[] = [];
  let px = 0;
  let py = 0;
  for (let i = 0; i < points.length; i += 2) {
    const x = Math.round(points[i] * COORD_SCALE);
    const y = Math.round(points[i + 1] * COORD_SCALE);
    const dx = x - px;
    const dy = y - py;
    // Skip duplicate consecutive points produced by rounding.
    if (i > 0 && dx === 0 && dy === 0) continue;
    out.push(dx, dy);
    px = x;
    py = y;
  }
  return out;
}
