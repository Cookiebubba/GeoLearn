/** Renders the initial table layout (pieces scattered around the empty board). */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { decodeRing, type PuzzleDataFile } from '@geolearn/shared/geo/puzzleData';
import { buildPuzzleModel } from '@geolearn/shared/geo/puzzleModel';
import { scatterPieces } from '@geolearn/shared/game/layout';
import { PUZZLES } from '@geolearn/shared/puzzles';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', '..', 'shared', 'data', 'puzzles');
const OUT = join(HERE, '..', 'previews');
mkdirSync(OUT, { recursive: true });
const PALETTE = ['#e8c872', '#9cc5a1', '#e3a587', '#a7b8de', '#d9a5c4', '#c9d68a', '#8fcfd1', '#f0b98d'];
const only = process.argv[2];
/** Optional screen aspect (width / height) to lay the table out for, e.g. 0.64 for a portrait phone. */
const aspect = process.argv[3] ? Number(process.argv[3]) : undefined;

for (const meta of PUZZLES) {
  if (only && meta.id !== only) continue;
  const data = JSON.parse(readFileSync(join(DATA, `${meta.id}.json`), 'utf8')) as PuzzleDataFile;
  const model = buildPuzzleModel(data);
  const t0 = performance.now();
  const { positions, table } = scatterPieces(model, 12345, aspect);
  const ms = performance.now() - t0;
  const tw = table.x1 - table.x0;
  const th = table.y1 - table.y0;
  const scale = 1400 / Math.max(tw, th);
  const canvas = createCanvas(Math.ceil(tw * scale), Math.ceil(th * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fafaf8';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.translate(-table.x0, -table.y0);
  // Board silhouette = union of all pieces at home.
  const sil = new Path2D();
  for (const pc of model.pieces)
    for (const enc of pc.data.rings[0]) {
      const r = decodeRing(enc);
      sil.moveTo(r[0] + pc.tx, r[1] + pc.ty);
      for (let i = 2; i < r.length; i += 2) sil.lineTo(r[i] + pc.tx, r[i + 1] + pc.ty);
      sil.closePath();
    }
  ctx.fillStyle = '#e7e7e3';
  ctx.fill(sil, 'nonzero');
  for (const pc of model.pieces) {
    const [x, y] = positions.get(pc.id)!;
    const path = new Path2D();
    for (const enc of pc.data.rings[0]) {
      const r = decodeRing(enc);
      path.moveTo(r[0] + x, r[1] + y);
      for (let i = 2; i < r.length; i += 2) path.lineTo(r[i] + x, r[i + 1] + y);
      path.closePath();
    }
    ctx.fillStyle = PALETTE[pc.color % 8];
    ctx.fill(path, 'nonzero');
    if (pc.size < 6) {
      ctx.strokeStyle = PALETTE[pc.color % 8];
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  writeFileSync(join(OUT, `layout-${meta.id}${aspect ? `-${aspect}` : ''}.png`), canvas.toBuffer('image/png'));
  // How much of a screen of the requested shape the table would fill when fitted.
  const screen = aspect ?? tw / th;
  const used = screen > tw / th ? tw / th / screen : screen / (tw / th);
  console.log(
    `${meta.id}: layout ${ms.toFixed(0)} ms, table ${tw.toFixed(0)}×${th.toFixed(0)} (aspect ${(tw / th).toFixed(2)}, fills ${(used * 100).toFixed(0)}% of the screen)`,
  );
}
