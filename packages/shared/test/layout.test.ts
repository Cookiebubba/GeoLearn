import { describe, expect, it } from 'vitest';
import { scatterPieces } from '../src/game/layout';
import { PUZZLES } from '../src/puzzles';
import { loadModel } from './helpers';

describe('scatterPieces', () => {
  for (const meta of PUZZLES) {
    // Board shape, a portrait phone and a desktop screen.
    for (const aspect of [undefined, 0.62, 1.6]) {
      it(`${meta.id} (${aspect ?? 'board'} screen): pieces start off the board, apart, deterministic`, () => {
        const model = loadModel(meta.id);
        const a = scatterPieces(model, 42, aspect);
        const b = scatterPieces(model, 42, aspect);
        expect([...a.positions.entries()]).toEqual([...b.positions.entries()]);
        const W = model.board.width;
        const H = model.board.height;
        const rects = model.pieces.map((p) => {
          const [x, y] = a.positions.get(p.id)!;
          return { id: p.id, x0: x + p.bbox[0], y0: y + p.bbox[1], x1: x + p.bbox[2], y1: y + p.bbox[3] };
        });
        for (const r of rects) {
          const overlapsBoard = r.x0 < W && r.x1 > 0 && r.y0 < H && r.y1 > 0;
          expect(overlapsBoard, r.id).toBe(false);
          expect(r.x0).toBeGreaterThanOrEqual(a.table.x0);
          expect(r.y0).toBeGreaterThanOrEqual(a.table.y0);
          expect(r.x1).toBeLessThanOrEqual(a.table.x1);
          expect(r.y1).toBeLessThanOrEqual(a.table.y1);
        }
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            const p = rects[i];
            const q = rects[j];
            const overlap = p.x0 < q.x1 && p.x1 > q.x0 && p.y0 < q.y1 && p.y1 > q.y0;
            expect(overlap, `${p.id} vs ${q.id}`).toBe(false);
          }
        }
        if (aspect) {
          // The table leans towards the screen's shape rather than the board's.
          const tableAspect = (a.table.x1 - a.table.x0) / (a.table.y1 - a.table.y0);
          const miss = Math.abs(Math.log(tableAspect / aspect));
          expect(miss).toBeLessThanOrEqual(Math.abs(Math.log(W / H / aspect)) + 0.1);
        }
      });
    }
  }
});
