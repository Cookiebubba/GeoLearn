import type { PuzzleModel } from '../geo/puzzleModel';
import { scatterPieces } from './layout';
import { isSnap, labelPoint, placementPoints } from './rules';
import {
  emptyStats,
  type GameResults,
  type GameSnapshot,
  type GrabMode,
  type PieceState,
  type PlayerInfo,
  type PlayerResult,
  type PlayerStats,
  type RoomSettings,
  type TableBounds,
} from './types';

export interface DropOutcome {
  x: number;
  y: number;
  z: number;
  placed: boolean;
  /** Dropped on land but not in the right place. */
  miss: boolean;
  points: number;
}

/**
 * Authoritative state of one puzzle game: who holds which piece, where every
 * piece is, and everybody's score. Pure logic, no I/O — the server wraps it
 * with WebSockets and offline play runs it in the browser.
 */
export class GameEngine {
  readonly table: TableBounds;
  readonly pieces = new Map<string, PieceState>();
  readonly stats = new Map<string, PlayerStats>();
  readonly teams = new Map<string, number>();
  placedCount = 0;
  private zCounter = 0;

  constructor(
    readonly model: PuzzleModel,
    readonly settings: RoomSettings,
    readonly seed: number,
    /** Preferred table shape (width / height), usually the players' screens. */
    aspect?: number,
  ) {
    const layout = scatterPieces(model, seed, aspect);
    this.table = layout.table;
    for (const p of model.pieces) {
      const [x, y] = layout.positions.get(p.id)!;
      this.pieces.set(p.id, { id: p.id, x, y, z: 0, placed: false, by: null, heldBy: null, holdMode: null });
    }
  }

  static fromSnapshot(model: PuzzleModel, settings: RoomSettings, snap: GameSnapshot, players: PlayerInfo[]): GameEngine {
    const e = new GameEngine(model, settings, snap.seed);
    for (const ps of snap.pieces) {
      e.pieces.set(ps.id, { ...ps });
      e.zCounter = Math.max(e.zCounter, ps.z);
    }
    e.placedCount = snap.pieces.filter((p) => p.placed).length;
    for (const pl of players) {
      e.stats.set(pl.id, { ...pl.stats });
      e.teams.set(pl.id, pl.team);
    }
    return e;
  }

  get complete(): boolean {
    return this.placedCount >= this.model.pieces.length;
  }

  ensurePlayer(id: string, team: number) {
    if (!this.stats.has(id)) this.stats.set(id, emptyStats());
    this.teams.set(id, team);
  }

  heldBy(playerId: string): PieceState | undefined {
    for (const p of this.pieces.values()) if (p.heldBy === playerId) return p;
    return undefined;
  }

  /** Claims a piece for a player. One piece per player; placed pieces are locked. */
  grab(playerId: string, pieceId: string, mode: GrabMode): boolean {
    const piece = this.pieces.get(pieceId);
    if (!piece || piece.placed) return false;
    if (piece.heldBy && piece.heldBy !== playerId) return false;
    const other = this.heldBy(playerId);
    if (other && other !== piece) {
      other.heldBy = null;
      other.holdMode = null;
    }
    piece.heldBy = playerId;
    piece.holdMode = mode;
    piece.z = ++this.zCounter;
    return true;
  }

  move(playerId: string, pieceId: string, x: number, y: number): [number, number] | null {
    const piece = this.pieces.get(pieceId);
    if (!piece || piece.heldBy !== playerId || piece.placed) return null;
    [piece.x, piece.y] = this.clamp(pieceId, x, y);
    return [piece.x, piece.y];
  }

  drop(playerId: string, pieceId: string, x: number, y: number, zoom: number): DropOutcome | null {
    const piece = this.pieces.get(pieceId);
    const model = this.model.byId.get(pieceId);
    if (!piece || !model || piece.heldBy !== playerId || piece.placed) return null;
    const stats = this.stats.get(playerId) ?? emptyStats();
    this.stats.set(playerId, stats);
    piece.heldBy = null;
    piece.holdMode = null;
    piece.z = ++this.zCounter;

    if (isSnap(model, x, y, zoom, this.model.maxZoom)) {
      piece.x = model.tx;
      piece.y = model.ty;
      piece.placed = true;
      piece.by = playerId;
      this.placedCount++;
      const points = placementPoints(model, stats.streak);
      stats.placed++;
      stats.attempts++;
      stats.points += points;
      stats.streak++;
      stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
      return { x: piece.x, y: piece.y, z: piece.z, placed: true, miss: false, points };
    }

    [piece.x, piece.y] = this.clamp(pieceId, x, y);
    const [lx, ly] = labelPoint(model, piece.x, piece.y);
    const onLand = this.model.silhouette.contains(lx, ly);
    if (onLand) {
      stats.attempts++;
      stats.misses++;
      stats.streak = 0;
    }
    return { x: piece.x, y: piece.y, z: piece.z, placed: false, miss: onLand, points: 0 };
  }

  /** Lets go of anything a (disconnected) player was holding, leaving it where it is. */
  release(playerId: string): PieceState[] {
    const out: PieceState[] = [];
    for (const p of this.pieces.values()) {
      if (p.heldBy === playerId) {
        p.heldBy = null;
        p.holdMode = null;
        out.push(p);
      }
    }
    return out;
  }

  /** Keeps a piece's bounding box on the table. */
  clamp(pieceId: string, x: number, y: number): [number, number] {
    const m = this.model.byId.get(pieceId)!;
    const t = this.table;
    const cx = Math.min(t.x1 - m.bbox[2] * 0.5, Math.max(t.x0 - m.bbox[0] * 0.5, x));
    const cy = Math.min(t.y1 - m.bbox[3] * 0.5, Math.max(t.y0 - m.bbox[1] * 0.5, y));
    return [Math.round(cx * 100) / 100, Math.round(cy * 100) / 100];
  }

  snapshot(startedAt: number | null, finishedAt: number | null): GameSnapshot {
    return {
      seed: this.seed,
      table: this.table,
      pieces: [...this.pieces.values()].map((p) => ({ ...p })),
      startedAt,
      finishedAt,
    };
  }

  results(players: PlayerInfo[], durationMs: number): GameResults {
    const rows: PlayerResult[] = players.map((pl) => {
      const s = this.stats.get(pl.id) ?? emptyStats();
      return {
        id: pl.id,
        name: pl.name,
        team: pl.team,
        color: pl.color,
        placed: s.placed,
        points: s.points,
        attempts: s.attempts,
        misses: s.misses,
        precision: s.attempts ? s.placed / s.attempts : 1,
        bestStreak: s.bestStreak,
        rank: 0,
      };
    });
    const mode = this.settings.mode;
    const key = (r: PlayerResult) => (mode === 'coop' ? r.placed * 1e6 + r.precision : r.points);
    rows.sort((a, b) => key(b) - key(a));
    rows.forEach((r, i) => (r.rank = i > 0 && key(rows[i - 1]) === key(r) ? rows[i - 1].rank : i + 1));

    const attempts = rows.reduce((n, r) => n + r.attempts, 0);
    const placed = rows.reduce((n, r) => n + r.placed, 0);
    let winners: string[];
    let winningTeam: number | null = null;
    if (mode === 'coop') winners = rows.map((r) => r.id);
    else if (mode === 'versus') winners = rows.filter((r) => r.rank === 1).map((r) => r.id);
    else {
      const totals = [0, 1].map((t) => rows.filter((r) => r.team === t).reduce((n, r) => n + r.points, 0));
      winningTeam = totals[0] === totals[1] ? null : totals[0] > totals[1] ? 0 : 1;
      winners = rows.filter((r) => winningTeam === null || r.team === winningTeam).map((r) => r.id);
    }
    return {
      puzzleId: this.model.id,
      mode,
      playerCount: players.length,
      durationMs,
      completed: this.complete,
      totalPieces: this.model.pieces.length,
      placedPieces: this.placedCount,
      precision: attempts ? placed / attempts : 1,
      players: rows,
      winners,
      winningTeam,
    };
  }
}
