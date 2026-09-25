import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Visibility } from '../game/engine/types';

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const safeStorage = createJSONStorage(() => {
  try {
    const k = '__geolearn_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch {
    const mem = new Map<string, string>();
    return {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
  }
});

interface IdentityState {
  name: string | null;
  /** Proves this device owns `name` (sent to the server, never shown). */
  token: string;
  setName(name: string): void;
}

export const useIdentity = create<IdentityState>()(
  persist(
    (set) => ({
      name: null,
      token: randomToken(),
      setName: (name) => set({ name }),
    }),
    { name: 'geolearn.identity', storage: safeStorage },
  ),
);

interface PrefsState {
  palette: string;
  visibility: Visibility;
  volume: number;
  muted: boolean;
  haptics: boolean;
  setPalette(id: string): void;
  setVisibility(v: Partial<Visibility>): void;
  setMuted(m: boolean): void;
  setVolume(v: number): void;
  setHaptics(h: boolean): void;
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      palette: 'atlas',
      visibility: { names: false, capitals: false, flags: false, revealOnPlace: true },
      volume: 0.8,
      muted: false,
      haptics: true,
      setPalette: (palette) => set({ palette }),
      setVisibility: (v) => set((s) => ({ visibility: { ...s.visibility, ...v } })),
      setMuted: (muted) => set({ muted }),
      setVolume: (volume) => set({ volume }),
      setHaptics: (haptics) => set({ haptics }),
    }),
    { name: 'geolearn.prefs', storage: safeStorage },
  ),
);

/** Personal bests kept on this device, shown on the map picker. */
interface BestsState {
  best: Record<string, number>;
  record(key: string, ms: number): boolean;
}

export const useBests = create<BestsState>()(
  persist(
    (set, get) => ({
      best: {},
      record: (key, ms) => {
        const prev = get().best[key];
        if (prev !== undefined && prev <= ms) return false;
        set((s) => ({ best: { ...s.best, [key]: ms } }));
        return true;
      },
    }),
    { name: 'geolearn.bests', storage: safeStorage },
  ),
);

export type TipId = 'drag' | 'zoom' | 'lift';

/** One-time gameplay tips this device has already seen. */
interface TipsState {
  seen: Partial<Record<TipId, true>>;
  markSeen(id: TipId): void;
}

export const useTips = create<TipsState>()(
  persist(
    (set) => ({
      seen: {},
      markSeen: (id) => set((s) => (s.seen[id] ? s : { seen: { ...s.seen, [id]: true } })),
    }),
    { name: 'geolearn.tips', storage: safeStorage },
  ),
);
