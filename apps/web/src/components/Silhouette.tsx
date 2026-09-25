import { useId } from 'react';
import type { PuzzleId } from '@geolearn/shared';
import { CATALOG_BY_ID } from '../app/api';

/**
 * A map's empty silhouette, set into the page like the game board:
 * light grey, with a soft shadow falling from the upper-left.
 */
export function Silhouette({ id, className, tone = 'inset' }: { id: PuzzleId; className?: string; tone?: 'inset' | 'ink' }) {
  const uid = useId().replace(/:/g, '');
  const entry = CATALOG_BY_ID.get(id);
  if (!entry) return null;
  const h = entry.silhouetteHeight;
  return (
    <svg className={className ?? 'silhouette'} viewBox={`-2 -2 104 ${h + 4}`} role="img" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id={`inner-${uid}`} x="-10%" y="-10%" width="120%" height="120%">
          <feOffset dx="0.45" dy="0.7" in="SourceAlpha" result="off" />
          <feGaussianBlur in="off" stdDeviation="0.7" result="blur" />
          <feComposite in="SourceAlpha" in2="blur" operator="out" result="inverse" />
          <feFlood floodColor="#2a2c28" floodOpacity="0.28" result="color" />
          <feComposite in="color" in2="inverse" operator="in" result="shadow" />
          <feComposite in="shadow" in2="SourceAlpha" operator="in" result="inner" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="inner" />
          </feMerge>
        </filter>
      </defs>
      <path d={entry.silhouette} fill={tone === 'ink' ? '#1c1e23' : '#e6e6e1'} fillRule="nonzero" filter={tone === 'inset' ? `url(#inner-${uid})` : undefined} />
    </svg>
  );
}
