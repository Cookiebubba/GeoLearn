/**
 * Step 2 of the map pipeline: project, clip, simplify and package every puzzle.
 *
 *   npm run geo:build        (after `npm run fetch -w @geolearn/geo` and `prepare-data`)
 *
 * Output: packages/shared/data/puzzles/<id>.json + packages/shared/data/catalog.json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoStream, type GeoProjection } from 'd3-geo';
import { topology } from 'topojson-server';
import { presimplify, simplify } from 'topojson-simplify';
import { feature, neighbors } from 'topojson-client';
import polylabel from 'polylabel';
import { COUNTRY_BY_ID } from '@geolearn/shared/geo/countries';
import {
  encodeRing,
  type CatalogEntry,
  type PieceDataFile,
  type PuzzleDataFile,
  type PuzzleDetailFile,
} from '@geolearn/shared/geo/puzzleData';
import { PUZZLE_CONFIGS, type PuzzleGeoConfig } from './config';
import {
  bboxDiag,
  bboxDistance,
  groupRings,
  nearestOnRings,
  orient,
  pointInRing,
  ringBBox,
  signedArea,
  unionBBox,
  type PolygonRec,
  type Ring,
} from './geom';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, '..', 'cache');
const OUT = join(HERE, '..', '..', 'shared', 'data');
const BOARD_W = 1000;
const DATA_VERSION = 1;

/** Colour slots; neighbours (touching or within PROXIMITY) never share one. */
const COLOUR_SLOTS = 8;
const PROXIMITY = 0.005; // of board width
/** Pairs that must never share a colour even though they don't touch (disputes, near-neighbours). */
const DISTINCT: [string, string][] = [
  ['FLK', 'ARG'],
  ['FLK', 'GBR'],
  ['TWN', 'CHN'],
  ['GUF', 'FRA'],
  ['GRL', 'DNK'],
  ['PRI', 'USA'],
  ['NCL', 'FRA'],
  ['ESH', 'MAR'],
  ['XKX', 'SRB'],
  ['CYP', 'TUR'],
];
/** Keep outlying islands within this distance of the country when they are not tiny. */
const OUTLIER_KM = 1500;
/** Archipelago states: keep every island within OUTLIER_KM regardless of size. */
const ARCHIPELAGOS = new Set(['MDV', 'KIR', 'MHL', 'FSM', 'TUV', 'SYC', 'CPV', 'BHS', 'SLB', 'VUT', 'FJI', 'TON', 'WSM', 'PLW', 'COM', 'STP', 'NRU', 'MUS', 'ATG', 'KNA', 'VCT', 'GRD', 'TTO', 'MLT']);

interface Entity {
  id: string;
  feature: GeoJSON.Feature<GeoJSON.MultiPolygon>;
}

function loadEntities(): Map<string, Entity> {
  const fc = JSON.parse(readFileSync(join(CACHE, 'entities.geojson'), 'utf8')) as GeoJSON.FeatureCollection<GeoJSON.MultiPolygon>;
  const map = new Map<string, Entity>();
  for (const f of fc.features) map.set(f.properties!.id, { id: f.properties!.id, feature: f });
  return map;
}

function streamRings(object: GeoJSON.Feature, projection: GeoProjection): Ring[] {
  const rings: Ring[] = [];
  let ring: Ring | null = null;
  const sink = {
    point(x: number, y: number) {
      ring?.push([x, y]);
    },
    lineStart() {
      ring = [];
    },
    lineEnd() {
      if (ring && ring.length > 2) rings.push(ring);
      ring = null;
    },
    polygonStart() {},
    polygonEnd() {},
    sphere() {},
  };
  geoStream(object, projection.stream(sink as never));
  return rings;
}

function makeProjection(cfg: PuzzleGeoConfig, scale: number, clip = true): GeoProjection {
  const p = cfg.projection().scale(scale).translate([0, 0]).precision(0.02);
  if (cfg.frame && clip) {
    const big = 1e9;
    const f = cfg.frame;
    const xs = (pts: [number, number][] | undefined) => (pts ?? []).map((q) => p(q)![0]);
    const ys = (pts: [number, number][] | undefined) => (pts ?? []).map((q) => p(q)![1]);
    const x0 = f.west ? Math.min(...xs(f.west)) : -big;
    const x1 = f.east ? Math.max(...xs(f.east)) : big;
    const y0 = f.north ? Math.min(...ys(f.north)) : -big;
    const y1 = f.south ? Math.max(...ys(f.south)) : big;
    p.clipExtent([
      [x0, y0],
      [x1, y1],
    ]);
  }
  return p;
}

function excludeParts(cfg: PuzzleGeoConfig, f: GeoJSON.Feature<GeoJSON.MultiPolygon>): GeoJSON.Feature<GeoJSON.MultiPolygon> {
  if (!cfg.exclude?.length) return f;
  const coords = f.geometry.coordinates.filter((poly) => {
    const b = ringBBox(poly[0] as Ring);
    const cx = (b[0] + b[2]) / 2;
    const cy = (b[1] + b[3]) / 2;
    return !cfg.exclude!.some(([w, s, e, n]) => cx >= w && cx <= e && cy >= s && cy <= n);
  });
  return { ...f, geometry: { type: 'MultiPolygon', coordinates: coords } };
}

function ringsArea(rings: Ring[]): number {
  return rings.reduce((a, r) => a + signedArea(r), 0);
}

interface ProjectedPiece {
  id: string;
  polys: PolygonRec[];
  dropped: number;
}

function projectMembers(cfg: PuzzleGeoConfig, entities: Map<string, Entity>, projection: GeoProjection, kmToUnits: number): ProjectedPiece[] {
  const out: ProjectedPiece[] = [];
  for (const id of cfg.members) {
    const ent = entities.get(id);
    if (!ent) throw new Error(`missing entity ${id}`);
    const rings = streamRings(excludeParts(cfg, ent.feature), projection);
    const polys = groupRings(rings);
    if (polys.length === 0) {
      console.warn(`  ! ${id} has no geometry inside the ${cfg.id} frame`);
      continue;
    }
    const { kept, dropped } = keepMainParts(id, polys, projection, kmToUnits);
    out.push({ id, polys: kept, dropped });
  }
  return out;
}

/**
 * Drops far-flung scraps (e.g. Réunion from France) so every piece stays a compact,
 * graspable object. The "main" part is the one holding the capital.
 */
function keepMainParts(id: string, polys: PolygonRec[], projection: GeoProjection, kmToUnits: number) {
  const info = COUNTRY_BY_ID.get(id)!;
  let mainIdx = 0;
  const cap = info.capitalLonLat ? projection(info.capitalLonLat) : null;
  if (cap) {
    let best = Infinity;
    polys.forEach((p, i) => {
      const inside = pointInRing(cap[0], cap[1], p.outer);
      const d = inside ? 0 : nearestOnRings(cap[0], cap[1], [p.outer])[0];
      // Prefer containment, then proximity; tiny tie-break by size.
      if (d < best - 1e-9 || (d === best && p.area > polys[mainIdx].area)) {
        best = d;
        mainIdx = i;
      }
    });
    // A capital far from every part (clipped away) → fall back to the largest part.
    if (best > bboxDiag(polys[mainIdx].bbox) * 2 + 5) mainIdx = 0;
  }
  const main = polys[mainIdx];
  const rest = polys.filter((_, i) => i !== mainIdx).sort((a, b) => b.area - a.area);
  const kept = [main];
  let bb = main.bbox;
  let dropped = 0;
  const archipelago = ARCHIPELAGOS.has(id);
  const outlier = OUTLIER_KM * kmToUnits;
  const bboxArea = (b: number[]) => Math.max((b[2] - b[0]) * (b[3] - b[1]), 1e-6);
  // Iterate until stable so chains of islands can grow the box progressively.
  let changed = true;
  const pending = new Set(rest);
  while (changed) {
    changed = false;
    for (const p of [...pending]) {
      const dist = bboxDistance(bb, p.bbox);
      const grown = unionBBox(bb, p.bbox);
      const compact = bboxArea(grown) <= 2 * bboxArea(bb);
      const bigRegion = p.area >= 0.1 * main.area && dist <= 3 * outlier;
      const near = dist <= 0.5 * bboxDiag(bb);
      const keep = archipelago ? dist <= outlier : compact || near || bigRegion;
      if (keep) {
        kept.push(p);
        bb = grown;
        pending.delete(p);
        changed = true;
      }
    }
  }
  dropped = pending.size;
  return { kept, dropped };
}

function closeRing(r: Ring): Ring {
  const a = r[0];
  const b = r[r.length - 1];
  return a[0] === b[0] && a[1] === b[1] ? r : [...r, a];
}

function openRing(r: number[][]): Ring {
  const a = r[0];
  const b = r[r.length - 1];
  const pts = r.map((p) => [p[0], p[1]] as [number, number]);
  if (a[0] === b[0] && a[1] === b[1]) pts.pop();
  return pts;
}

interface LodPiece {
  /** Polygons as [exterior, ...holes] */
  polygons: Ring[][];
}

interface BuiltPuzzle {
  cfg: PuzzleGeoConfig;
  board: { width: number; height: number };
  pieces: {
    id: string;
    lods: LodPiece[];
    capital: [number, number] | null;
  }[];
  adjacency: [string, string][];
}

function buildPuzzle(cfg: PuzzleGeoConfig, entities: Map<string, Entity>): BuiltPuzzle {
  console.log(`\n▸ ${cfg.id}`);
  // Pass 1 at a nominal scale to measure; pass 2 re-projects so the board is ~1000 wide,
  // which keeps d3's adaptive resampling precision meaningful in board units.
  const scale1 = 100;
  const p1 = makeProjection(cfg, scale1);
  const first = projectMembers(cfg, entities, p1, scale1 / 6371);
  const bb1 = first.flatMap((p) => p.polys.map((q) => q.bbox)).reduce((a, b) => unionBBox(a, b));
  const scale2 = (scale1 * BOARD_W) / (bb1[2] - bb1[0]);
  const p2 = makeProjection(cfg, scale2);
  const kmToUnits = scale2 / 6371;
  const projected = projectMembers(cfg, entities, p2, kmToUnits);
  for (const p of projected) if (p.dropped) console.log(`  ${p.id}: dropped ${p.dropped} outlying part(s)`);
  if (cfg.frame) {
    const unclipped = makeProjection(cfg, scale2, false);
    for (const id of cfg.members) {
      const ent = entities.get(id)!;
      const full = Math.abs(ringsArea(streamRings(excludeParts(cfg, ent.feature), unclipped)));
      const kept = Math.abs(ringsArea(streamRings(excludeParts(cfg, ent.feature), p2)));
      const frac = full > 0 ? kept / full : 1;
      if (frac < 0.995 && !cfg.allowClip?.includes(id)) console.warn(`  ! ${id}: frame keeps only ${(frac * 100).toFixed(2)}% of its area`);
    }
  }

  const bb = projected.flatMap((p) => p.polys.map((q) => q.bbox)).reduce((a, b) => unionBBox(a, b));
  const s = BOARD_W / (bb[2] - bb[0]);
  const tx = (x: number) => (x - bb[0]) * s;
  const ty = (y: number) => (y - bb[1]) * s;
  const height = (bb[3] - bb[1]) * s;

  const fc: GeoJSON.FeatureCollection<GeoJSON.MultiPolygon> = {
    type: 'FeatureCollection',
    features: projected.map((p) => ({
      type: 'Feature',
      id: p.id,
      properties: { id: p.id },
      geometry: {
        type: 'MultiPolygon',
        coordinates: p.polys.map((poly) =>
          [poly.outer, ...poly.holes].map((r) => closeRing(r.map(([x, y]) => [tx(x), ty(y)] as [number, number]))),
        ),
      },
    })),
  };

  const topo = topology({ countries: fc }, 1e6);
  const pre = presimplify(topo as never);

  const lodFeatures = cfg.lodWeights.map((w) => {
    const simp = simplify(pre, w);
    return feature(simp as never, (simp.objects as never as { countries: never }).countries) as unknown as GeoJSON.FeatureCollection<GeoJSON.MultiPolygon | GeoJSON.Polygon>;
  });

  // Adjacency from the finest topology (shared arcs).
  const finest = simplify(pre, cfg.lodWeights[cfg.lodWeights.length - 1]) as unknown as { objects: { countries: { geometries: unknown[] } } };
  const nb = neighbors(finest.objects.countries.geometries as never);
  const adjacency: [string, string][] = [];
  nb.forEach((list, i) => {
    for (const j of list) if (j > i) adjacency.push([projected[i].id, projected[j].id]);
  });

  const pieces = projected.map((p, idx) => {
    const lods: LodPiece[] = lodFeatures.map((lf, lod) => {
      const geom = lf.features[idx].geometry;
      const polysRaw = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
      let polygons = polysRaw
        .map((poly) => poly.map((r, k) => orient(openRing(r), k === 0)))
        .map((poly) => poly.filter((r, k) => r.length >= 3 && (k === 0 || Math.abs(signedArea(r)) >= cfg.lodMinRing[lod])))
        .filter((poly) => poly.length > 0 && poly[0].length >= 3);
      // Drop tiny islands, but never the largest ring of the piece.
      const areas = polygons.map((poly) => Math.abs(signedArea(poly[0])));
      const maxArea = Math.max(0, ...areas);
      polygons = polygons.filter((_, k) => areas[k] >= cfg.lodMinRing[lod] || areas[k] === maxArea);
      // Collapsed microstates: fall back to the unsimplified outline.
      if (polygons.length === 0 || maxArea < 1e-6) {
        const largest = [...p.polys].sort((a, b) => b.area - a.area)[0];
        polygons = [[orient(largest.outer.map(([x, y]) => [tx(x), ty(y)] as [number, number]), true)]];
      }
      return { polygons };
    });

    let capital: [number, number] | null = null;
    const info = COUNTRY_BY_ID.get(p.id)!;
    if (info.capitalLonLat) {
      const c = p2(info.capitalLonLat);
      if (c) capital = [tx(c[0]), ty(c[1])];
    }
    return { id: p.id, lods, capital };
  });

  // Proximity adjacency so near neighbours across straits also get distinct colours.
  const prox = BOARD_W * PROXIMITY;
  const coarse = pieces.map((pc) => {
    const rings = pc.lods[0].polygons.map((poly) => poly[0]);
    const box = rings.map(ringBBox).reduce((a, b) => unionBBox(a, b));
    return { id: pc.id, rings, box };
  });
  for (let i = 0; i < coarse.length; i++) {
    for (let j = i + 1; j < coarse.length; j++) {
      const a = coarse[i];
      const b = coarse[j];
      if (bboxDistance(a.box, b.box) > prox) continue;
      let close = false;
      outer: for (const ra of a.rings) {
        for (let k = 0; k < ra.length; k += Math.max(1, Math.floor(ra.length / 60))) {
          const d = nearestOnRings(ra[k][0], ra[k][1], b.rings)[0];
          if (d < prox) {
            close = true;
            break outer;
          }
        }
      }
      if (close) adjacency.push([a.id, b.id]);
    }
  }

  console.log(`  board ${BOARD_W} × ${height.toFixed(1)}, ${pieces.length} pieces, ${adjacency.length} adjacencies`);
  return { cfg, board: { width: BOARD_W, height: Math.round(height * 100) / 100 }, pieces, adjacency };
}

/** DSatur graph colouring, balancing slot usage. */
function colour(ids: string[], edges: [string, string][], k: number): Map<string, number> {
  const adj = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const [a, b] of edges) {
    if (a === b) continue;
    adj.get(a)?.add(b);
    adj.get(b)?.add(a);
  }
  const colourOf = new Map<string, number>();
  const usage = new Array(k).fill(0);
  const remaining = new Set(ids);
  while (remaining.size) {
    let pick = '';
    let bestSat = -1;
    let bestDeg = -1;
    for (const id of remaining) {
      const sat = new Set([...adj.get(id)!].map((n) => colourOf.get(n)).filter((c) => c !== undefined)).size;
      const deg = adj.get(id)!.size;
      if (sat > bestSat || (sat === bestSat && deg > bestDeg) || (sat === bestSat && deg === bestDeg && id < pick)) {
        pick = id;
        bestSat = sat;
        bestDeg = deg;
      }
    }
    const used = new Set([...adj.get(pick)!].map((n) => colourOf.get(n)));
    let choice = -1;
    for (let c = 0; c < k; c++) {
      if (used.has(c)) continue;
      if (choice === -1 || usage[c] < usage[choice]) choice = c;
    }
    if (choice === -1) {
      console.warn(`  ! could not colour ${pick} with ${k} colours; reusing least-used`);
      choice = usage.indexOf(Math.min(...usage));
    }
    colourOf.set(pick, choice);
    usage[choice]++;
    remaining.delete(pick);
  }
  console.log(`\ncolour usage: ${usage.join(', ')}`);
  return colourOf;
}

function round(n: number, d = 2) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function toPieceFile(p: BuiltPuzzle['pieces'][number], colourSlot: number): PieceDataFile {
  const finest = p.lods[p.lods.length - 1].polygons;
  const allRings = finest.flat();
  const box = allRings.map(ringBBox).reduce((a, b) => unionBBox(a, b));
  const ax = (box[0] + box[2]) / 2;
  const ay = (box[1] + box[3]) / 2;

  let area = 0;
  for (const poly of finest) {
    area += Math.abs(signedArea(poly[0]));
    for (const h of poly.slice(1)) area -= Math.abs(signedArea(h));
  }

  // Label at the pole of inaccessibility of the largest polygon.
  const largest = [...finest].sort((a, b) => Math.abs(signedArea(b[0])) - Math.abs(signedArea(a[0])))[0];
  const pl = polylabel(largest.map((r) => r.map(([x, y]) => [x, y])), 0.05) as number[] & { distance: number };

  let capital: [number, number] | null = null;
  if (p.capital) {
    const [cx, cy] = p.capital;
    const inside = finest.some((poly) => pointInRing(cx, cy, poly[0]) && !poly.slice(1).some((h) => pointInRing(cx, cy, h)));
    if (inside) capital = [cx, cy];
    else {
      const [d, nx, ny] = nearestOnRings(cx, cy, finest.map((poly) => poly[0]));
      const diag = bboxDiag(box);
      if (d < Math.max(0.6, diag * 0.04)) capital = [nx, ny];
    }
  }

  return {
    id: p.id,
    target: [round(ax, 3), round(ay, 3)],
    bbox: [round(box[0] - ax), round(box[1] - ay), round(box[2] - ax), round(box[3] - ay)],
    area: round(area, 4),
    label: [round(pl[0] - ax), round(pl[1] - ay), round(pl.distance, 3)],
    capital: capital ? [round(capital[0] - ax), round(capital[1] - ay)] : null,
    color: colourSlot,
    rings: p.lods.map((lod) =>
      lod.polygons.flat().map((r) => encodeRing(r.flatMap(([x, y]) => [x - ax, y - ay]))),
    ),
  };
}

/** The finest LOD ships in a separate file that the client loads lazily. */
function splitDetail(file: PuzzleDataFile): { base: PuzzleDataFile; detail: PuzzleDetailFile } {
  const lod = file.lodZoom.length - 1;
  const detail: PuzzleDetailFile = { id: file.id, version: file.version, lod, rings: {} };
  const base: PuzzleDataFile = {
    ...file,
    pieces: file.pieces.map((pc) => {
      detail.rings[pc.id] = pc.rings[lod];
      return { ...pc, rings: pc.rings.slice(0, lod) };
    }),
  };
  return { base, detail };
}

function silhouettePath(p: BuiltPuzzle): { d: string; h: number } {
  const k = 100 / p.board.width;
  const parts: string[] = [];
  for (const pc of p.pieces) {
    for (const poly of pc.lods[0].polygons) {
      for (const [ri, ring] of poly.entries()) {
        const a = Math.abs(signedArea(ring));
        if (a < (ri === 0 ? 1.2 : 4)) continue;
        // Light decimation for tiny thumbnails.
        const step = ring.length > 60 ? 2 : 1;
        const pts = ring.filter((_, i) => i % step === 0);
        parts.push('M' + pts.map(([x, y]) => `${round(x * k, 1)} ${round(y * k, 1)}`).join('L') + 'Z');
      }
    }
  }
  return { d: parts.join(''), h: round(p.board.height * k, 1) };
}

function main() {
  const entities = loadEntities();
  const built = PUZZLE_CONFIGS.map((cfg) => buildPuzzle(cfg, entities));

  const ids = [...new Set(built.flatMap((b) => b.pieces.map((p) => p.id)))].sort();
  const colours = colour(ids, [...built.flatMap((b) => b.adjacency), ...DISTINCT], COLOUR_SLOTS);

  mkdirSync(join(OUT, 'puzzles'), { recursive: true });
  const catalog: CatalogEntry[] = [];
  for (const b of built) {
    const file: PuzzleDataFile = {
      id: b.cfg.id,
      version: DATA_VERSION,
      board: b.board,
      lodZoom: b.cfg.lodZoom,
      maxZoom: b.cfg.maxZoom,
      pieces: b.pieces.map((p) => toPieceFile(p, colours.get(p.id)!)),
    };
    const { base, detail } = splitDetail(file);
    const json = JSON.stringify(base);
    const detailJson = JSON.stringify(detail);
    writeFileSync(join(OUT, 'puzzles', `${b.cfg.id}.json`), json);
    writeFileSync(join(OUT, 'puzzles', `${b.cfg.id}.detail.json`), detailJson);
    const verts = b.pieces.map((p) => p.lods.map((l) => l.polygons.flat().reduce((n, r) => n + r.length, 0)));
    const perLod = b.cfg.lodWeights.map((_, i) => verts.reduce((n, v) => n + v[i], 0));
    console.log(
      `${b.cfg.id.padEnd(14)} base ${(json.length / 1024).toFixed(0).padStart(5)} KB, detail ${(detailJson.length / 1024).toFixed(0).padStart(5)} KB  vertices per LOD: ${perLod.join(' / ')}`,
    );
    const sil = silhouettePath(b);
    catalog.push({ id: b.cfg.id, pieces: b.pieces.length, board: b.board, silhouette: sil.d, silhouetteHeight: sil.h });
  }
  writeFileSync(join(OUT, 'catalog.json'), JSON.stringify(catalog));
  console.log(`\nwrote ${built.length} puzzles to ${OUT}`);
}

main();
