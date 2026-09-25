import type { CatalogEntry, LeaderboardKind, OpenRoomSummary, PartyBucket, PuzzleDataFile, PuzzleDetailFile, PuzzleId, RoomSettings, RoomStatus } from '@geolearn/shared';
import catalogJson from '@geolearn/shared/data/catalog.json';

export const catalog = catalogJson as CatalogEntry[];
export const CATALOG_BY_ID = new Map(catalog.map((c) => [c.id, c]));

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, body });
  return body;
}

export async function claimName(name: string, token: string): Promise<{ ok: true; name: string } | { ok: false; message: string }> {
  try {
    const res = await fetch('/api/players/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, token }),
    });
    const body = (await res.json()) as { ok: boolean; name?: string; message?: string };
    if (body.ok && body.name) return { ok: true, name: body.name };
    return { ok: false, message: body.message ?? 'That name is not available' };
  } catch {
    // Offline: let people play solo under any name.
    return { ok: true, name };
  }
}

export async function fetchOpenRooms(): Promise<OpenRoomSummary[]> {
  const body = await json<{ rooms: OpenRoomSummary[] }>(await fetch('/api/rooms/open'));
  return body.rooms;
}

export async function fetchRoomInfo(code: string): Promise<{ ok: boolean; settings?: RoomSettings; status?: RoomStatus; players?: number; host?: string }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
  return (await res.json()) as { ok: boolean };
}

export interface LeaderboardEntry {
  rank: number;
  names: string;
  value: number;
  secondary: number;
  at: string;
}

export async function fetchLeaderboard(kind: LeaderboardKind | 'alltime', puzzle: PuzzleId, party: PartyBucket, period: 'all' | 'week'): Promise<LeaderboardEntry[]> {
  const q = new URLSearchParams({ kind, puzzle, party, period });
  const body = await json<{ entries: LeaderboardEntry[] }>(await fetch(`/api/leaderboard?${q}`));
  return body.entries;
}

export async function fetchStats(): Promise<{ online: number; players: number; games: number; countries: number }> {
  return json(await fetch('/api/stats'));
}

const puzzleCache = new Map<PuzzleId, Promise<PuzzleDataFile>>();
const detailCache = new Map<PuzzleId, Promise<PuzzleDetailFile>>();

export function loadPuzzle(id: PuzzleId): Promise<PuzzleDataFile> {
  let p = puzzleCache.get(id);
  if (!p) {
    p = fetch(`/data/puzzles/${id}.json`).then((r) => json<PuzzleDataFile>(r));
    p.catch(() => puzzleCache.delete(id));
    puzzleCache.set(id, p);
  }
  return p;
}

export function loadPuzzleDetail(id: PuzzleId): Promise<PuzzleDetailFile> {
  let p = detailCache.get(id);
  if (!p) {
    p = fetch(`/data/puzzles/${id}.detail.json`).then((r) => json<PuzzleDetailFile>(r));
    p.catch(() => detailCache.delete(id));
    detailCache.set(id, p);
  }
  return p;
}
