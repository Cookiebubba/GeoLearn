import { hashId } from './math';

export interface Palette {
  id: string;
  name: string;
  /** Eight colour slots; neighbouring countries never share a slot. */
  colors: string[];
}

export const PALETTES: Palette[] = [
  { id: 'atlas', name: 'Atlas', colors: ['#EBCB85', '#A9CDA2', '#E8A98F', '#A7B9E3', '#DDA8C9', '#CADB92', '#8FCFCF', '#F4BE8C'] },
  { id: 'blossom', name: 'Blossom', colors: ['#F6B3C4', '#D5B8EC', '#FFD2B8', '#F28FAD', '#BFD0F5', '#F9E0A8', '#E7A6D8', '#C8E6D0'] },
  { id: 'ocean', name: 'Ocean', colors: ['#7FB6E0', '#6CC4B9', '#A8D8EA', '#5E9ED6', '#9BDFC8', '#B7C4F2', '#77C6DC', '#C9E4D2'] },
  { id: 'meadow', name: 'Meadow', colors: ['#9CCB86', '#D6DE8C', '#7FB89A', '#E6D089', '#B5D6A7', '#88C5B0', '#C9E0A0', '#DCC49A'] },
  { id: 'sunset', name: 'Sunset', colors: ['#F4A582', '#F7C873', '#E88FA0', '#F6D89A', '#EDB09A', '#F2A45F', '#D9A3C5', '#F9D2B0'] },
  { id: 'vintage', name: 'Vintage', colors: ['#D8C48E', '#B7C59F', '#D4A08D', '#A6B8C4', '#CDB3A5', '#9EB49D', '#E2CFA2', '#C39A8C'] },
  { id: 'candy', name: 'Candy', colors: ['#FF8FAB', '#FFD166', '#06D6A0', '#4CC9F0', '#B388EB', '#FF9F1C', '#8AE1FC', '#F15BB5'] },
  { id: 'mono', name: 'Stone', colors: ['#D8D8D5', '#C2C2BE', '#ADADA8', '#E6E6E2', '#9A9A95', '#CDCDC9', '#B7B7B2', '#A3A39E'] },
];

export const PALETTE_BY_ID = new Map(PALETTES.map((p) => [p.id, p]));

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToCss(h: number, s: number, l: number): string {
  return `hsl(${h.toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%)`;
}

export interface PieceColors {
  fill: string;
  /** Slightly brighter while lifted. */
  lifted: string;
  /** Label text colour with good contrast on the fill. */
  text: string;
  textHalo: string;
  rgb: [number, number, number];
}

/**
 * Colour for one country: its palette slot, nudged a touch in hue and lightness
 * by the country id so that no two countries are exactly the same colour.
 */
export function pieceColors(palette: Palette, slot: number, id: string): PieceColors {
  const base = palette.colors[slot % palette.colors.length];
  const [r, g, b] = hexToRgb(base);
  const [h, s, l] = rgbToHsl(r, g, b);
  const hash = hashId(id);
  const dh = ((hash & 0xff) / 255 - 0.5) * 8;
  const dl = (((hash >> 8) & 0xff) / 255 - 0.5) * 0.06;
  const nl = Math.min(0.92, Math.max(0.28, l + dl));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const dark = lum < 150;
  return {
    fill: hslToCss(h + dh, s, nl),
    lifted: hslToCss(h + dh, Math.min(1, s * 1.04), Math.min(0.95, nl + 0.03)),
    text: dark ? 'rgba(255,255,255,0.96)' : 'rgba(28,30,34,0.86)',
    textHalo: dark ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.55)',
    rgb: [r, g, b],
  };
}
