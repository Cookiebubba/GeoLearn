import { useCallback, useEffect, useRef, useState } from 'react';
import { Fingerprint, Hand, ZoomIn } from 'lucide-react';
import { useTips, type TipId } from '../app/stores';

const coarse = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

const TIPS: Record<TipId, { icon: typeof Hand; touch: string; mouse: string; ms: number }> = {
  drag: { icon: Hand, touch: 'Drag each country to where it belongs', mouse: 'Drag each country to where it belongs', ms: 9000 },
  zoom: { icon: ZoomIn, touch: 'Pinch to zoom, even while holding a piece', mouse: 'Scroll to zoom, drag the table to look around', ms: 7000 },
  lift: {
    icon: Fingerprint,
    touch: 'Quick drag to slide it, or press and hold to lift it',
    mouse: 'Quick drag to slide it, or press and hold to lift it',
    ms: 7000,
  },
};

export interface CoachEvents {
  placed(byMe: boolean): void;
  dropped(onBoard: boolean): void;
  zoomed(): void;
}

/**
 * Gentle one-line tips for a player's first games: each is shown once per
 * device, never blocks the table, and steps aside as soon as it's been acted on.
 */
export function useCoach(playing: boolean) {
  const seen = useTips((s) => s.seen);
  const [tip, setTip] = useState<TipId | null>(null);
  const tipRef = useRef<TipId | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
  const hide = useCallback((id: TipId) => {
    useTips.getState().markSeen(id);
    if (tipRef.current === id) {
      tipRef.current = null;
      setTip(null);
    }
  }, []);
  const show = useCallback(
    (id: TipId) => {
      if (useTips.getState().seen[id] || tipRef.current) return;
      tipRef.current = id;
      setTip(id);
      later(TIPS[id].ms, () => hide(id));
    },
    [hide],
  );

  useEffect(() => {
    if (!playing || seen.drag) return;
    const t = setTimeout(() => show('drag'), 900);
    return () => clearTimeout(t);
    // Only when a game starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const events = useRef<CoachEvents>({ placed() {}, dropped() {}, zoomed() {} });
  events.current = {
    placed(byMe) {
      if (!byMe) return;
      hide('drag');
      if (!useTips.getState().seen.zoom) later(1400, () => show('zoom'));
    },
    dropped(onBoard) {
      if (onBoard && playing && !useTips.getState().seen.lift) later(500, () => show('lift'));
    },
    zoomed() {
      if (tipRef.current === 'zoom') later(600, () => hide('zoom'));
      else if (playing) useTips.getState().markSeen('zoom');
    },
  };

  return { tip, events };
}

export function Coach({ tip }: { tip: TipId | null }) {
  if (!tip) return null;
  const t = TIPS[tip];
  const Icon = t.icon;
  return (
    <div className="coach" key={tip} role="status">
      <Icon size={16} aria-hidden="true" />
      <span>{coarse() ? t.touch : t.mouse}</span>
    </div>
  );
}
