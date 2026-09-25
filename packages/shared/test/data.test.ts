import { describe, expect, it } from 'vitest';
import { COUNTRIES, COUNTRY_BY_ID } from '../src/geo/countries';
import { PUZZLES } from '../src/puzzles';
import { loadModel } from './helpers';

describe('puzzle data', () => {
  it('has 203 unique countries with valid codes', () => {
    expect(COUNTRIES).toHaveLength(203);
    expect(new Set(COUNTRIES.map((c) => c.id)).size).toBe(203);
    for (const c of COUNTRIES) {
      expect(c.id).toMatch(/^[A-Z]{3}$/);
      expect(c.iso2).toMatch(/^[a-z]{2}$/);
    }
  });

  it('counts 193 UN members', () => {
    expect(COUNTRIES.filter((c) => c.status === 'un-member')).toHaveLength(193);
  });

  for (const meta of PUZZLES) {
    it(`${meta.id}: every member is present with sane geometry`, () => {
      const model = loadModel(meta.id);
      const expected = meta.continent ? COUNTRIES.filter((c) => c.continents.includes(meta.continent!)) : COUNTRIES;
      expect(model.pieces.map((p) => p.id).sort()).toEqual(expected.map((c) => c.id).sort());
      for (const p of model.pieces) {
        expect(COUNTRY_BY_ID.has(p.id)).toBe(true);
        expect(p.data.rings[0].length).toBeGreaterThan(0);
        expect(p.tx).toBeGreaterThanOrEqual(-1);
        expect(p.tx).toBeLessThanOrEqual(model.board.width + 1);
        expect(p.ty).toBeLessThanOrEqual(model.board.height + 1);
      }
      // The silhouette contains each piece's own label point when at home.
      for (const p of model.pieces) {
        if (p.area < 1) continue;
        expect(model.silhouette.contains(p.tx + p.label[0], p.ty + p.label[1]), p.id).toBe(true);
      }
    });
  }

  it('shows Crimea as part of Ukraine and the Golan in Syria', () => {
    const eu = loadModel('europe');
    const ukr = eu.byId.get('UKR')!;
    // Ukraine now reaches further south than without Crimea (bbox height check).
    expect(ukr.h).toBeGreaterThan(ukr.w * 0.5);
    const asia = loadModel('asia');
    expect(asia.byId.get('SYR')!.area).toBeGreaterThan(asia.byId.get('ISR')!.area * 5);
  });
});

describe('shared borders', () => {
  it('neighbouring pieces reconstruct identical border vertices (no hairline gaps)', () => {
    const model = loadModel('europe');
    const verts = (id: string, lod: number) => {
      const p = model.byId.get(id)!;
      const set = new Set<string>();
      for (const enc of p.data.rings[lod]) {
        let x = Math.round(p.tx * 100);
        let y = Math.round(p.ty * 100);
        for (let i = 0; i < enc.length; i += 2) {
          x += enc[i];
          y += enc[i + 1];
          set.add(`${x},${y}`);
        }
      }
      return set;
    };
    for (const lod of [0, 1]) {
      for (const [a, b] of [
        ['FRA', 'DEU'],
        ['POL', 'DEU'],
        ['ESP', 'PRT'],
        ['UKR', 'BLR'],
        ['UKR', 'RUS'],
      ]) {
        const va = verts(a, lod);
        const vb = verts(b, lod);
        const shared = [...va].filter((v) => vb.has(v)).length;
        expect(shared, `${a}/${b} lod ${lod}`).toBeGreaterThan(3);
      }
      for (const p of model.pieces) expect(Math.abs(Math.round(p.tx * 100) - p.tx * 100), p.id).toBeLessThan(1e-6);
    }
  });
});
