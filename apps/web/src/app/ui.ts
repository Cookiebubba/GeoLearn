import { create } from 'zustand';
import { useIdentity } from './stores';

interface Toast {
  id: number;
  text: string;
}

interface UiState {
  toasts: Toast[];
  nameOpen: boolean;
  nameResolvers: ((name: string | null) => void)[];
  toast(text: string, ms?: number): void;
  openName(): Promise<string | null>;
  closeName(name: string | null): void;
}

let toastSeq = 0;

export const useUi = create<UiState>((set, get) => ({
  toasts: [],
  nameOpen: false,
  nameResolvers: [],
  toast(text, ms = 2600) {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
  },
  openName() {
    return new Promise((resolve) => set((s) => ({ nameOpen: true, nameResolvers: [...s.nameResolvers, resolve] })));
  },
  closeName(name) {
    for (const r of get().nameResolvers) r(name);
    set({ nameOpen: false, nameResolvers: [] });
  },
}));

/** Resolves with the player's name, asking for one first if needed. */
export async function ensureName(): Promise<string | null> {
  const current = useIdentity.getState().name;
  if (current) return current;
  return useUi.getState().openName();
}
