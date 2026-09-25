import { Check, Eye, Palette as PaletteIcon, Volume2, VolumeX } from 'lucide-react';
import { usePrefs } from '../app/stores';
import { Popover } from '../components/Popover';
import { sound } from './engine/audio';
import { PALETTES } from './engine/palette';
import type { Visibility } from './engine/types';

const ITEMS: { key: keyof Visibility; label: string }[] = [
  { key: 'names', label: 'Country names' },
  { key: 'capitals', label: 'Capitals' },
  { key: 'flags', label: 'Flags' },
  { key: 'revealOnPlace', label: 'Name on placement' },
];

export function VisibilityMenu() {
  const visibility = usePrefs((s) => s.visibility);
  const set = usePrefs((s) => s.setVisibility);
  return (
    <Popover label="What to show" button={<Eye size={19} />}>
      {() => (
        <>
          <div className="menu-title">Show on the map</div>
          {ITEMS.map((it) => (
            <button
              key={it.key}
              className="menu-item"
              role="menuitemcheckbox"
              aria-checked={visibility[it.key]}
              onClick={() => {
                sound.ui();
                set({ [it.key]: !visibility[it.key] });
              }}
            >
              {it.label}
              <span className={`check${visibility[it.key] ? ' on' : ''}`}>{visibility[it.key] && <Check size={15} strokeWidth={3} />}</span>
            </button>
          ))}
        </>
      )}
    </Popover>
  );
}

export function PaletteMenu() {
  const current = usePrefs((s) => s.palette);
  const set = usePrefs((s) => s.setPalette);
  return (
    <Popover label="Colours" button={<PaletteIcon size={19} />}>
      {(close) => (
        <>
          <div className="menu-title">Colours</div>
          <div className="swatches">
            {PALETTES.map((p) => (
              <button
                key={p.id}
                className="swatch-row"
                aria-pressed={current === p.id}
                onClick={() => {
                  sound.ui();
                  set(p.id);
                  close();
                }}
              >
                <span className="swatch">
                  {p.colors.map((c) => (
                    <i key={c} style={{ background: c }} />
                  ))}
                </span>
                {p.name}
              </button>
            ))}
          </div>
        </>
      )}
    </Popover>
  );
}

export function SoundButton() {
  const muted = usePrefs((s) => s.muted);
  const setMuted = usePrefs((s) => s.setMuted);
  return (
    <button
      className="icon-btn"
      aria-label={muted ? 'Unmute' : 'Mute'}
      onClick={() => {
        sound.unlock();
        setMuted(!muted);
      }}
    >
      {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
    </button>
  );
}
