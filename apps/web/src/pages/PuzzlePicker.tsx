import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { modeLabel, PUZZLES, validModes, type GameMode, type PartySize } from '@geolearn/shared';
import { CATALOG_BY_ID } from '../app/api';
import { Link, useRouter } from '../app/router';
import { useBests } from '../app/stores';
import { Silhouette } from '../components/Silhouette';
import { formatTime } from '../game/format';

export function PuzzlePicker() {
  const { navigate } = useRouter();
  const [party, setParty] = useState<PartySize>(1);
  const [mode, setMode] = useState<GameMode>('coop');
  const [isPublic, setPublic] = useState(true);
  const bests = useBests((s) => s.best);
  const modes = validModes(party);
  const activeMode = modes.includes(mode) ? mode : 'coop';

  const start = (puzzle: string) => {
    const q = new URLSearchParams({ puzzle, party: String(party), mode: activeMode });
    if (party > 1) q.set('public', isPublic ? '1' : '0');
    navigate(`/room/new?${q}`);
  };

  return (
    <div className="page">
      <header className="topnav">
        <Link to="/" className="btn ghost small">
          <ArrowLeft size={17} /> Home
        </Link>
      </header>
      <div className="picker-head">
        <h1>Map Puzzle</h1>
        <p className="muted" style={{ margin: '6px 0 0' }}>
          Pick a map. {party === 1 ? 'You start right away.' : 'You’ll get a code to share with friends.'}
        </p>
      </div>

      <div className="picker-controls">
        <div className="segmented" role="group" aria-label="Players">
          {([1, 2, 4] as PartySize[]).map((n) => (
            <button key={n} aria-pressed={party === n} onClick={() => setParty(n)}>
              {n === 1 ? 'Solo' : n === 2 ? 'Duo' : 'Quad'}
            </button>
          ))}
        </div>
        {party > 1 && (
          <div className="segmented" role="group" aria-label="Mode">
            {modes.map((m) => (
              <button key={m} aria-pressed={activeMode === m} onClick={() => setMode(m)}>
                {modeLabel(m)}
              </button>
            ))}
          </div>
        )}
        {party > 1 && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 600, color: 'var(--ink-2)' }}>
            <button type="button" className="toggle" role="switch" aria-checked={isPublic} onClick={() => setPublic(!isPublic)} />
            Open to anyone
          </label>
        )}
      </div>
      {party > 1 && (
        <p className="muted" style={{ margin: '-6px 0 16px', fontSize: 14 }}>
          {activeMode === 'coop'
            ? 'Together: everyone builds the same map. Your team is timed.'
            : activeMode === 'versus'
              ? 'Versus: one shared table, every country you place scores points. Small countries score more.'
              : 'Teams: two against two on one table. Team points win.'}
        </p>
      )}

      <div className="maps">
        {PUZZLES.map((p) => {
          const entry = CATALOG_BY_ID.get(p.id);
          const best = bests[`${p.id}:solo`];
          return (
            <button key={p.id} className={`map-card${p.id === 'world' ? ' world' : ''}`} onClick={() => start(p.id)}>
              <div className="thumb">
                <Silhouette id={p.id} />
              </div>
              <div className="name">{p.name}</div>
              <div className="sub">
                <span>{entry?.pieces} countries</span>
                {best !== undefined && party === 1 && <span>· best {formatTime(best)}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
