import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/engine';
import { snapTolerance } from '../src/game/rules';
import type { PlayerInfo, RoomSettings } from '../src/game/types';
import { emptyStats } from '../src/game/types';
import { loadModel } from './helpers';

const settings = (mode: RoomSettings['mode']): RoomSettings => ({ puzzleId: 'europe', mode, partySize: 2, isPublic: false });
const player = (id: string, team = 0): PlayerInfo => ({ id, name: id, color: 0, team, connected: true, host: false, stats: emptyStats() });

describe('GameEngine', () => {
  it('locks a piece to the first player who grabs it', () => {
    const e = new GameEngine(loadModel('europe'), settings('coop'), 1);
    e.ensurePlayer('a', 0);
    e.ensurePlayer('b', 0);
    expect(e.grab('a', 'FRA', 'lift')).toBe(true);
    expect(e.grab('b', 'FRA', 'lift')).toBe(false);
    expect(e.move('b', 'FRA', 10, 10)).toBeNull();
    expect(e.drop('b', 'FRA', 10, 10, 1)).toBeNull();
    expect(e.grab('b', 'DEU', 'lift')).toBe(true);
  });

  it('snaps a piece dropped near home and locks it', () => {
    const m = loadModel('europe');
    const e = new GameEngine(m, settings('versus'), 1);
    e.ensurePlayer('a', 0);
    const fra = m.byId.get('FRA')!;
    e.grab('a', 'FRA', 'lift');
    const out = e.drop('a', 'FRA', fra.tx + 1, fra.ty - 1, 1)!;
    expect(out.placed).toBe(true);
    expect(out.points).toBeGreaterThanOrEqual(100);
    expect(e.pieces.get('FRA')!.placed).toBe(true);
    expect(e.grab('a', 'FRA', 'lift')).toBe(false);
    expect(e.stats.get('a')!.placed).toBe(1);
  });

  it('counts a drop on the wrong land as a miss, but not a drop on the table', () => {
    const m = loadModel('europe');
    const e = new GameEngine(m, settings('versus'), 1);
    e.ensurePlayer('a', 0);
    const deu = m.byId.get('DEU')!;
    const fra = m.byId.get('FRA')!;
    e.grab('a', 'FRA', 'lift');
    // Put France's label point onto Germany.
    const miss = e.drop('a', 'FRA', deu.tx + deu.label[0] - fra.label[0], deu.ty + deu.label[1] - fra.label[1], 1)!;
    expect(miss.placed).toBe(false);
    expect(miss.miss).toBe(true);
    e.grab('a', 'FRA', 'lift');
    const aside = e.drop('a', 'FRA', e.table.x0 + 60, e.table.y0 + 60, 1)!;
    expect(aside.miss).toBe(false);
    expect(e.stats.get('a')!.attempts).toBe(1);
    expect(e.stats.get('a')!.misses).toBe(1);
  });

  it('completes and ranks players', () => {
    const m = loadModel('oceania');
    const e = new GameEngine(m, { ...settings('versus'), puzzleId: 'oceania' }, 7);
    e.ensurePlayer('a', 0);
    e.ensurePlayer('b', 0);
    m.pieces.forEach((p, i) => {
      const who = i % 3 === 0 ? 'b' : 'a';
      expect(e.grab(who, p.id, 'lift')).toBe(true);
      expect(e.drop(who, p.id, p.tx, p.ty, 2)!.placed).toBe(true);
    });
    expect(e.complete).toBe(true);
    const res = e.results([player('a'), player('b')], 60000);
    expect(res.completed).toBe(true);
    expect(res.players[0].id).toBe('a');
    expect(res.winners).toEqual(['a']);
    expect(res.precision).toBe(1);
  });

  it('releases held pieces on disconnect', () => {
    const e = new GameEngine(loadModel('africa'), { ...settings('coop'), puzzleId: 'africa' }, 3);
    e.ensurePlayer('a', 0);
    e.grab('a', 'EGY', 'slide');
    expect(e.release('a').map((p) => p.id)).toEqual(['EGY']);
    expect(e.pieces.get('EGY')!.heldBy).toBeNull();
  });

  it('keeps snap tolerance generous for tiny pieces and bounded for huge ones', () => {
    const m = loadModel('europe');
    const vat = m.byId.get('VAT')!;
    const rus = m.byId.get('RUS')!;
    expect(snapTolerance(vat, 0.3, m.maxZoom)).toBeGreaterThan(5);
    expect(snapTolerance(vat, 14, m.maxZoom)).toBeLessThan(2);
    expect(snapTolerance(rus, 14, m.maxZoom)).toBeLessThanOrEqual(22);
  });
});
