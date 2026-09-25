import { decodeRing, windingNumber, type PieceModel } from '@geolearn/shared';

function addRing(path: Path2D, ring: Float64Array, ox: number, oy: number) {
  if (ring.length < 6) return;
  path.moveTo(ring[0] + ox, ring[1] + oy);
  for (let i = 2; i < ring.length; i += 2) path.lineTo(ring[i] + ox, ring[i + 1] + oy);
  path.closePath();
}

/** Decoded outlines and cached Path2D objects for one piece, per level of detail. */
export class PieceGeometry {
  readonly lodRings: (Float64Array[] | undefined)[];
  private readonly paths: (Path2D | undefined)[] = [];

  constructor(
    readonly model: PieceModel,
    lodCount: number,
  ) {
    this.lodRings = new Array(lodCount).fill(undefined);
    model.data.rings.forEach((lod, i) => (this.lodRings[i] = lod.map(decodeRing)));
  }

  setLod(lod: number, rings: number[][]) {
    this.lodRings[lod] = rings.map(decodeRing);
    this.paths[lod] = undefined;
  }

  /** Highest available LOD not above `lod`. */
  available(lod: number): number {
    for (let l = Math.min(lod, this.lodRings.length - 1); l >= 0; l--) if (this.lodRings[l]) return l;
    return 0;
  }

  path(lod: number): Path2D {
    const l = this.available(lod);
    let p = this.paths[l];
    if (!p) {
      p = new Path2D();
      for (const ring of this.lodRings[l]!) addRing(p, ring, 0, 0);
      this.paths[l] = p;
    }
    return p;
  }

  /** Point-in-piece test in local coordinates (nonzero winding). */
  contains(lx: number, ly: number, lod: number): boolean {
    const b = this.model.bbox;
    if (lx < b[0] || lx > b[2] || ly < b[1] || ly > b[3]) return false;
    const rings = this.lodRings[this.available(lod)]!;
    let wn = 0;
    for (const r of rings) wn += windingNumber(lx, ly, r);
    return wn !== 0;
  }

  /** Distance from a local point to the piece's bounding box (0 inside). */
  bboxDistance(lx: number, ly: number): number {
    const b = this.model.bbox;
    const dx = Math.max(b[0] - lx, 0, lx - b[2]);
    const dy = Math.max(b[1] - ly, 0, ly - b[3]);
    return Math.hypot(dx, dy);
  }
}

/** The empty board: every piece's outline at home, filled as one shape. */
export function buildUnionPath(pieces: PieceGeometry[], lod: number): Path2D {
  const path = new Path2D();
  for (const g of pieces) {
    const rings = g.lodRings[g.available(lod)]!;
    for (const r of rings) addRing(path, r, g.model.tx, g.model.ty);
  }
  return path;
}
