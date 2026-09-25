import type { PuzzleId } from '../puzzles';

/**
 * - coop:   everyone builds the same map together; scored on time and precision.
 * - versus: free-for-all on one shared table; every country you place scores points.
 * - teams:  two teams of two share the table and race on points (quads only).
 */
export type GameMode = 'coop' | 'versus' | 'teams';
export type PartySize = 1 | 2 | 4;
export type RoomStatus = 'lobby' | 'countdown' | 'playing' | 'finished';
export type GrabMode = 'lift' | 'slide';

export interface RoomSettings {
  puzzleId: PuzzleId;
  mode: GameMode;
  partySize: PartySize;
  isPublic: boolean;
}

export interface PlayerStats {
  /** Countries placed correctly. */
  placed: number;
  points: number;
  /** Drops that landed on land (the board silhouette). */
  attempts: number;
  /** Attempts that were not the right spot. */
  misses: number;
  streak: number;
  bestStreak: number;
}

export interface PlayerInfo {
  id: string;
  name: string;
  /** Player colour slot 0..3 (cursor / hand colour). */
  color: number;
  team: number;
  connected: boolean;
  host: boolean;
  stats: PlayerStats;
}

export interface PieceState {
  id: string;
  x: number;
  y: number;
  /** Stacking order; higher draws on top. */
  z: number;
  placed: boolean;
  /** Player who placed it (null if not placed). */
  by: string | null;
  heldBy: string | null;
  holdMode: GrabMode | null;
}

export interface TableBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface GameSnapshot {
  seed: number;
  table: TableBounds;
  pieces: PieceState[];
  /** Server clock (ms) when play began, null during countdown. */
  startedAt: number | null;
  finishedAt: number | null;
}

export interface PlayerResult {
  id: string;
  name: string;
  team: number;
  color: number;
  placed: number;
  points: number;
  attempts: number;
  misses: number;
  /** placed / attempts, 0..1 (1 when nothing was attempted). */
  precision: number;
  bestStreak: number;
  rank: number;
}

export interface GameResults {
  puzzleId: PuzzleId;
  mode: GameMode;
  playerCount: number;
  durationMs: number;
  completed: boolean;
  totalPieces: number;
  placedPieces: number;
  /** Team precision (all players' placements / all attempts). */
  precision: number;
  players: PlayerResult[];
  /** Winning player ids (versus) or the whole party (coop). */
  winners: string[];
  winningTeam: number | null;
  /** Filled in by the server once the result is stored. */
  leaderboard?: LeaderboardPlacement[];
}

export interface LeaderboardPlacement {
  board: LeaderboardKind;
  rank: number;
  total: number;
  personalBest: boolean;
}

export type LeaderboardKind = 'fastest' | 'precision' | 'points';

/** Player-count bucket used by leaderboards. */
export type PartyBucket = 'solo' | 'duo' | 'quad';

export function partyBucket(playerCount: number): PartyBucket {
  if (playerCount <= 1) return 'solo';
  if (playerCount === 2) return 'duo';
  return 'quad';
}

export interface RoomSnapshot {
  code: string;
  settings: RoomSettings;
  status: RoomStatus;
  players: PlayerInfo[];
  game: GameSnapshot | null;
  /** Server clock (ms) when the countdown ends. */
  countdownEndsAt: number | null;
  results: GameResults | null;
}

export interface OpenRoomSummary {
  code: string;
  puzzleId: PuzzleId;
  mode: GameMode;
  partySize: PartySize;
  players: number;
  host: string;
  status: RoomStatus;
}

export const PLAYER_COLORS = ['#e2574c', '#2f8f83', '#5b6bd6', '#d9962b'] as const;
export const TEAM_NAMES = ['Tide', 'Ember'] as const;

export function emptyStats(): PlayerStats {
  return { placed: 0, points: 0, attempts: 0, misses: 0, streak: 0, bestStreak: 0 };
}
