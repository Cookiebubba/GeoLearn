import type { CountryInfo, GrabMode, PieceModel } from '@geolearn/shared';
import type { PieceGeometry } from './geometry';
import type { PieceColors } from './palette';

export interface Visibility {
  names: boolean;
  capitals: boolean;
  flags: boolean;
  /** Briefly show a country's name when it clicks into place. */
  revealOnPlace: boolean;
}

export interface EnginePlayer {
  id: string;
  name: string;
  color: string;
}

export interface EngineCallbacks {
  grab(pieceId: string, mode: GrabMode): void;
  move(pieceId: string, x: number, y: number): void;
  drop(pieceId: string, x: number, y: number, zoom: number): void;
  cursor(x: number | null, y: number | null): void;
  /** Local progress changed (placed pieces). */
  progress?(placed: number, total: number): void;
  /** A piece clicked into place. */
  placed?(pieceId: string, byMe: boolean): void;
  /** The whole map is complete (local detection, before the server confirms). */
  complete?(): void;
  /** Camera zoom changed (for the zoom controls). */
  zoom?(zoom: number, min: number, max: number): void;
}

export interface ScenePiece {
  id: string;
  model: PieceModel;
  geom: PieceGeometry;
  info: CountryInfo;
  colors: PieceColors;
  // Logical state.
  x: number;
  y: number;
  z: number;
  placed: boolean;
  placedBy: string | null;
  heldBy: string | null;
  mode: GrabMode | null;
  // Render state.
  rx: number;
  ry: number;
  vx: number;
  vy: number;
  lift: number;
  liftV: number;
  hover: number;
  /** Glide into place after a correct drop. */
  snap: { t: number; fx: number; fy: number } | null;
  /** 0..1 progress of the little "seated" press after snapping; -1 when idle. */
  press: number;
  /** Seconds to wait before starting a press (completion wave). */
  pressDelay: number;
  /** Placed locally, waiting for the server to agree. */
  pending: boolean;
  /** Where the piece was when this client grabbed it (to undo a denied grab). */
  origin: [number, number] | null;
  /** Extra upward float (screen px) while held on a touch screen. */
  float: number;
  floatV: number;
  floatTarget: number;
}
