import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GameResults } from '@geolearn/shared/game/types';
import { openDatabase, type DbHandle } from '../src/db/client';
import { loadConfig } from '../src/config';
import { ResultsStore } from '../src/results';

let db: DbHandle;
let store: ResultsStore;

beforeAll(async () => {
  const config = loadConfig({ dataDir: ':memory:', databaseUrl: undefined });
  db = await openDatabase({ dataDir: ':memory:', migrationsDir: config.migrationsDir });
  store = new ResultsStore(db, 300);
});

afterAll(async () => {
  await db.close();
});

function solo(name: string, durationMs: number): GameResults {
  return {
    puzzleId: 'oceania',
    mode: 'coop',
    playerCount: 1,
    durationMs,
    completed: true,
    totalPieces: 15,
    placedPieces: 15,
    precision: 1,
    players: [{ id: 'p1', name, team: 0, color: 0, placed: 15, points: 0, attempts: 15, misses: 0, precision: 1, bestStreak: 15, rank: 1 }],
    winners: ['p1'],
    winningTeam: null,
  };
}

describe('leaderboards', () => {
  it('ranks human-paced games but not scripted instant solves', async () => {
    // 15 countries in 1.2s: 80ms each. Stored, but never ranked.
    expect(await store.save('BOT01', solo('Speedy Bot', 1200), Date.now() - 1200, [])).toEqual([]);
    // 15 countries in 42s: a very good human run.
    const placements = await store.save('HUMAN', solo('Ada', 42_000), Date.now() - 42_000, []);
    expect(placements.find((p) => p.board === 'fastest')).toMatchObject({ rank: 1, total: 1, personalBest: true });

    const fastest = await store.leaderboard('fastest', 'oceania', 'solo', 'all');
    expect(fastest.map((e) => e.names)).toEqual(['Ada']);
    const allTime = await store.leaderboard('alltime', 'oceania', 'solo', 'all');
    expect(allTime.map((e) => e.names)).toEqual(['Ada']);
  });
});
