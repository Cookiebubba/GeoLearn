import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPuzzleModel, type PuzzleModel } from '@geolearn/shared/geo/puzzleModel';
import type { PuzzleDataFile } from '@geolearn/shared/geo/puzzleData';
import { PUZZLES, type PuzzleId } from '@geolearn/shared/puzzles';

export class PuzzleLibrary {
  private readonly models = new Map<PuzzleId, PuzzleModel>();

  constructor(private readonly dir: string) {}

  /** Loads every puzzle up front so the first game starts instantly. */
  loadAll(): this {
    for (const meta of PUZZLES) this.get(meta.id);
    return this;
  }

  get(id: PuzzleId): PuzzleModel {
    let model = this.models.get(id);
    if (!model) {
      const data = JSON.parse(readFileSync(join(this.dir, `${id}.json`), 'utf8')) as PuzzleDataFile;
      model = buildPuzzleModel(data);
      this.models.set(id, model);
    }
    return model;
  }
}
