import {
  geoAzimuthalEqualArea,
  geoConicEqualArea,
  geoConicConformal,
  geoNaturalEarth1,
  type GeoProjection,
} from 'd3-geo';
import { COUNTRIES, type ContinentId } from '@geolearn/shared/geo/countries';
import type { PuzzleId } from '@geolearn/shared/puzzles';

type LonLat = [number, number];

export interface PuzzleGeoConfig {
  id: PuzzleId;
  members: string[];
  /** Fresh, unscaled projection (rotation / parallels only). */
  projection: () => GeoProjection;
  /**
   * Map frame. Each side lists lon/lat points; the most extreme projected x (west/east)
   * or y (north/south) among them becomes that edge of the clipping rectangle.
   */
  frame?: { west?: LonLat[]; east?: LonLat[]; north?: LonLat[]; south?: LonLat[] };
  /** Members that are expected to be cut by the frame (no warning). */
  allowClip?: string[];
  /** Lon/lat boxes [w, s, e, n]; source polygons centred inside are removed (e.g. Hawaii). */
  exclude?: [number, number, number, number][];
  /** Visvalingam area thresholds (board units²) per LOD. */
  lodWeights: number[];
  /** Zoom (screen px / board unit) where each LOD becomes active. */
  lodZoom: number[];
  /** Rings smaller than this (board units²) are dropped per LOD. */
  lodMinRing: number[];
  /** Largest zoom the client allows (screen px / board unit). */
  maxZoom: number;
}

const members = (continent: ContinentId) => COUNTRIES.filter((c) => c.continents.includes(continent)).map((c) => c.id);

const CONTINENT_LOD = {
  lodWeights: [0.2, 0.012, 0.0028],
  lodZoom: [0, 1.6, 6],
  lodMinRing: [0.08, 0.008, 0.0015],
  maxZoom: 14,
};

export const PUZZLE_CONFIGS: PuzzleGeoConfig[] = [
  {
    id: 'europe',
    members: members('europe'),
    // ETRS89-LAEA style: the EU's standard statistical map projection.
    projection: () => geoAzimuthalEqualArea().rotate([-12, -52]),
    frame: {
      west: [[-25, 64.5], [-10, 37], [-10, 43.5]],
      east: [[51.5, 44], [50.6, 40.3]],
      north: [[25, 71.6]],
      south: [[20, 34.4]],
    },
    allowClip: ['RUS'],
    ...CONTINENT_LOD,
  },
  {
    id: 'africa',
    members: members('africa'),
    projection: () => geoConicEqualArea().parallels([20, -23]).rotate([-22, 0]),
    frame: { west: [[-26, 15]], east: [[64, -12], [64, -20]], north: [[10, 38.5]], south: [[22, -36]] },
    ...CONTINENT_LOD,
  },
  {
    id: 'south-america',
    members: members('south-america'),
    projection: () => geoConicEqualArea().parallels([-5, -42]).rotate([60, 0]),
    frame: { west: [[-82.5, -5], [-82.5, 5]], east: [[-32.2, -3.8]], north: [[-66, 13.5], [-72, 13.5]], south: [[-68, -56.6]] },
    allowClip: ['ECU', 'BRA', 'CHL', 'VEN', 'COL'],
    ...CONTINENT_LOD,
  },
  {
    id: 'north-america',
    members: members('north-america'),
    projection: () => geoConicConformal().parallels([20, 60]).rotate([96, 0]),
    frame: { west: [[-172.5, 52], [-172.5, 57]] },
    exclude: [[-179.9, 15, -150, 30]],
    allowClip: ['USA'],
    ...CONTINENT_LOD,
  },
  {
    id: 'asia',
    members: members('asia'),
    projection: () => geoConicEqualArea().parallels([15, 65]).rotate([-95, 0]),
    ...CONTINENT_LOD,
  },
  {
    id: 'oceania',
    members: members('oceania'),
    projection: () => geoAzimuthalEqualArea().rotate([-160, 16]),
    frame: { west: [[112, -25]], east: [[-168, -14], [-168, 0]], north: [[160, 15], [170, 15]], south: [[168, -48.5]] },
    allowClip: ['KIR', 'NZL', 'AUS'],
    ...CONTINENT_LOD,
  },
  {
    id: 'world',
    members: COUNTRIES.map((c) => c.id),
    // Centred on 11°E so the antimeridian cut runs through the Bering Strait.
    projection: () => geoNaturalEarth1().rotate([-11, 0]),
    frame: { north: [[0, 84]], south: [[0, -57]] },
    allowClip: [],
    lodWeights: [0.12, 0.008, 0.0009],
    lodZoom: [0, 2, 8],
    lodMinRing: [0.05, 0.004, 0.0006],
    maxZoom: 28,
  },
];
