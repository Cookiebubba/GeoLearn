import type { PieceModel } from '../geo/puzzleModel';
import type { GameMode, PartySize } from './types';

export const MIN_ZOOM = 0.02;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * How close (board units) a piece's anchor must be to its home to click into place.
 * A fraction of the piece's size, with a floor expressed in screen pixels so tiny
 * countries stay pleasant to place at any zoom (capped so it never feels automatic).
 */
export function snapTolerance(piece: PieceModel, zoom: number, maxZoom: number): number {
  const z = clamp(Number.isFinite(zoom) ? zoom : 1, MIN_ZOOM, maxZoom);
  const world = clamp(piece.size * 0.1, 1.2, 22);
  const screen = Math.min(20 / z, piece.size * 0.5 + 8);
  return Math.max(world, screen);
}

export function isSnap(piece: PieceModel, x: number, y: number, zoom: number, maxZoom: number): boolean {
  return Math.hypot(x - piece.tx, y - piece.ty) <= snapTolerance(piece, zoom, maxZoom);
}

/**
 * Versus points for one correct placement: 100, up to +50 for small (hard to
 * find) countries, and +10 per consecutive clean placement (max +50).
 */
export function placementPoints(piece: PieceModel, streakBefore: number): number {
  return 100 + Math.round(piece.smallness * 50) + 10 * Math.min(streakBefore, 5);
}

/** Label point of a piece at an arbitrary position (used for the "on land" test). */
export function labelPoint(piece: PieceModel, x: number, y: number): [number, number] {
  return [x + piece.label[0], y + piece.label[1]];
}

export function validModes(partySize: PartySize): GameMode[] {
  if (partySize === 1) return ['coop'];
  if (partySize === 2) return ['coop', 'versus'];
  return ['coop', 'versus', 'teams'];
}

export function modeLabel(mode: GameMode): string {
  return mode === 'coop' ? 'Together' : mode === 'versus' ? 'Versus' : 'Teams';
}

export function partyLabel(size: PartySize): string {
  return size === 1 ? 'Solo' : size === 2 ? 'Duo' : 'Quad';
}
