/** Renders PNG previews of the generated puzzle data into packages/geo/previews/. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { COUNTRY_BY_ID } from '@geolearn/shared/geo/countries';
import { decodeRing, type PuzzleDataFile, type PuzzleDetailFile } from '@geolearn/shared/geo/puzzleData';
import { PUZZLES } from '@geolearn/shared/puzzles';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', '..', 'shared', 'data', 'puzzles');
const OUT = join(HERE, '..', 'previews');
mkdirSync(OUT, { recursive: true });

const PALETTE = ['#e8c872', '#9cc5a1', '#e3a587', '#a7b8de', '#d9a5c4', '#c9d68a', '#8fcfd1', '#f0b98d'];

const only = process.argv[2];
const lodArg = process.argv[3] ? Number(process.argv[3]) : 1;

for (const meta of PUZZLES) {
  if (only && meta.id !== only) continue;
  const data = JSON.parse(readFileSync(join(DATA, `${meta.id}.json`), 'utf8')) as PuzzleDataFile;
  const detail = JSON.parse(readFileSync(join(DATA, `${meta.id}.detail.json`), 'utf8')) as PuzzleDetailFile;
  const scale = meta.id === 'world' ? 2.4 : 1.4;
  const pad = 20;
  const W = Math.ceil(data.board.width * scale + pad * 2);
  const H = Math.ceil(data.board.height * scale + pad * 2);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.translate(pad, pad);
  ctx.scale(scale, scale);
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 1 / scale;
  ctx.strokeRect(0, 0, data.board.width, data.board.height);

  const sorted = [...data.pieces].sort((a, b) => b.area - a.area);
  for (const pc of sorted) {
    const rings = lodArg >= data.pieces[0].rings.length ? detail.rings[pc.id] : pc.rings[lodArg];
    const path = new Path2D();
    for (const enc of rings) {
      const r = decodeRing(enc);
      path.moveTo(r[0] + pc.target[0], r[1] + pc.target[1]);
      for (let i = 2; i < r.length; i += 2) path.lineTo(r[i] + pc.target[0], r[i + 1] + pc.target[1]);
      path.closePath();
    }
    ctx.fillStyle = PALETTE[pc.color % PALETTE.length];
    ctx.fill(path, 'nonzero');
    ctx.strokeStyle = 'rgba(40,40,40,0.55)';
    ctx.lineWidth = 0.35 / scale;
    ctx.stroke(path);
  }
  for (const pc of sorted) {
    const info = COUNTRY_BY_ID.get(pc.id)!;
    const lx = pc.target[0] + pc.label[0];
    const ly = pc.target[1] + pc.label[1];
    const size = Math.max(4, Math.min(11, pc.label[2] * 0.5)) / scale * 1.6;
    ctx.font = `${size}px sans-serif`;
    ctx.fillStyle = '#222';
    ctx.textAlign = 'center';
    ctx.fillText(info.name, lx, ly);
    if (pc.capital) {
      ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      ctx.arc(pc.target[0] + pc.capital[0], pc.target[1] + pc.capital[1], 1.3 / scale * 1.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#c0392b';
      ctx.fillText('(no capital)', lx, ly + size * 1.1);
    }
  }
  writeFileSync(join(OUT, `${meta.id}.png`), canvas.toBuffer('image/png'));
  console.log(`preview ${meta.id} ${W}×${H}`);
}
