import type { ContinentId } from './geo/countries';

export type PuzzleId = 'africa' | 'asia' | 'europe' | 'north-america' | 'south-america' | 'oceania' | 'world';

export interface PuzzleMeta {
  id: PuzzleId;
  name: string;
  blurb: string;
  continent: ContinentId | null;
}

export const PUZZLES: PuzzleMeta[] = [
  { id: 'europe', name: 'Europe', blurb: 'Fjords, peninsulas and a few very small states.', continent: 'europe' },
  { id: 'africa', name: 'Africa', blurb: 'Fifty-five pieces from the Sahara to the Cape.', continent: 'africa' },
  { id: 'south-america', name: 'South America', blurb: 'The Andes, the Amazon and the far south.', continent: 'south-america' },
  { id: 'north-america', name: 'North America', blurb: 'From the Arctic to the Caribbean.', continent: 'north-america' },
  { id: 'asia', name: 'Asia', blurb: 'The largest continent, from the Levant to Japan.', continent: 'asia' },
  { id: 'oceania', name: 'Oceania', blurb: 'Australia, New Zealand and the Pacific islands.', continent: 'oceania' },
  { id: 'world', name: 'The World', blurb: 'Every country, one table. The big one.', continent: null },
];

export const PUZZLE_BY_ID: ReadonlyMap<PuzzleId, PuzzleMeta> = new Map(PUZZLES.map((p) => [p.id, p]));

export function isPuzzleId(value: unknown): value is PuzzleId {
  return typeof value === 'string' && PUZZLE_BY_ID.has(value as PuzzleId);
}
