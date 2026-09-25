import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPuzzleModel, type PuzzleModel } from '../src/geo/puzzleModel';
import type { PuzzleDataFile } from '../src/geo/puzzleData';
import type { PuzzleId } from '../src/puzzles';

const cache = new Map<string, PuzzleModel>();

export function loadModel(id: PuzzleId): PuzzleModel {
  let m = cache.get(id);
  if (!m) {
    const file = join(__dirname, '..', 'data', 'puzzles', `${id}.json`);
    m = buildPuzzleModel(JSON.parse(readFileSync(file, 'utf8')) as PuzzleDataFile);
    cache.set(id, m);
  }
  return m;
}
