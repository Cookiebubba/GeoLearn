export type Pt = [number, number];
export type Ring = Pt[];

/** Signed area; positive = clockwise on screen (y axis pointing down). */
export function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}

export function ringBBox(ring: Ring): [number, number, number, number] {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

export function unionBBox(a: number[], b: number[]): [number, number, number, number] {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

export function bboxDistance(a: number[], b: number[]): number {
  const dx = Math.max(0, a[0] - b[2], b[0] - a[2]);
  const dy = Math.max(0, a[1] - b[3], b[1] - a[3]);
  return Math.hypot(dx, dy);
}

export function bboxDiag(b: number[]): number {
  return Math.hypot(b[2] - b[0], b[3] - b[1]);
}

export function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True when `inner` lies inside `outer` (majority vote over a few vertices). */
export function ringInsideRing(inner: Ring, outer: Ring): boolean {
  const step = Math.max(1, Math.floor(inner.length / 7));
  let yes = 0;
  let total = 0;
  for (let i = 0; i < inner.length; i += step) {
    total++;
    if (pointInRing(inner[i][0], inner[i][1], outer)) yes++;
  }
  return yes * 2 > total;
}

export interface PolygonRec {
  outer: Ring;
  holes: Ring[];
  area: number;
  bbox: [number, number, number, number];
}

/**
 * Groups loose rings (any winding) into polygons with holes using containment
 * depth: even depth = exterior, odd depth = hole of the smallest enclosing exterior.
 */
export function groupRings(rings: Ring[]): PolygonRec[] {
  const recs = rings
    .filter((r) => r.length >= 3)
    .map((r) => ({ ring: r, area: Math.abs(signedArea(r)), bbox: ringBBox(r) }))
    .filter((r) => r.area > 0)
    .sort((a, b) => b.area - a.area);

  const depth: number[] = new Array(recs.length).fill(0);
  const parent: number[] = new Array(recs.length).fill(-1);
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    for (let j = i - 1; j >= 0; j--) {
      // Candidates are larger rings (earlier in the list) whose bbox contains ours.
      const o = recs[j];
      if (o.bbox[0] > r.bbox[0] || o.bbox[1] > r.bbox[1] || o.bbox[2] < r.bbox[2] || o.bbox[3] < r.bbox[3]) continue;
      if (ringInsideRing(r.ring, o.ring)) {
        // Smallest containing ring = the first found walking back from i.
        parent[i] = j;
        depth[i] = depth[j] + 1;
        break;
      }
    }
  }

  const polys = new Map<number, PolygonRec>();
  recs.forEach((r, i) => {
    if (depth[i] % 2 === 0) {
      polys.set(i, { outer: orient(r.ring, true), holes: [], area: r.area, bbox: r.bbox });
    }
  });
  recs.forEach((r, i) => {
    if (depth[i] % 2 === 1) {
      const p = polys.get(parent[i]);
      if (p) {
        p.holes.push(orient(r.ring, false));
        p.area -= r.area;
      }
    }
  });
  return [...polys.values()];
}

/** Returns the ring with clockwise (exterior=true) or counter-clockwise orientation on screen. */
export function orient(ring: Ring, exterior: boolean): Ring {
  const a = signedArea(ring);
  if (a > 0 === exterior) return ring;
  return ring.slice().reverse();
}

export function distPointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return [Math.hypot(px - x, py - y), x, y];
}

/** Nearest point on a set of rings. */
export function nearestOnRings(px: number, py: number, rings: Ring[]): [number, number, number] {
  let best: [number, number, number] = [Infinity, px, py];
  for (const ring of rings) {
    for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
      const d = distPointSegment(px, py, ring[j][0], ring[j][1], ring[i][0], ring[i][1]);
      if (d[0] < best[0]) best = d;
    }
  }
  return best;
}
