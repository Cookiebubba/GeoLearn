import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { PUZZLES, type PartyBucket, type PuzzleId } from '@geolearn/shared';
import { fetchLeaderboard, type LeaderboardEntry } from '../app/api';
import { Link } from '../app/router';
import { useIdentity } from '../app/stores';
import { formatPercent, formatTime } from '../game/format';

type Kind = 'fastest' | 'precision' | 'points' | 'alltime';

const TABS: { id: Kind; label: string; hint: string }[] = [
  { id: 'fastest', label: 'Fastest', hint: 'Best completion times. Together mode; teams are ranked by their best run.' },
  { id: 'precision', label: 'Precision', hint: 'Share of drops that landed in exactly the right place. Ties go to the faster run.' },
  { id: 'points', label: 'Versus', hint: 'Highest scores in Versus and Teams games. Small countries and streaks score more.' },
  { id: 'alltime', label: 'All-time', hint: 'Most countries placed, across every map and mode.' },
];

export function Leaderboards() {
  const me = useIdentity((s) => s.name)?.toLowerCase();
  const [kind, setKind] = useState<Kind>('fastest');
  const [puzzle, setPuzzle] = useState<PuzzleId>('europe');
  const [party, setParty] = useState<PartyBucket>('solo');
  const [period, setPeriod] = useState<'all' | 'week'>('all');
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const effectiveParty: PartyBucket = kind === 'points' && party === 'solo' ? 'duo' : party;

  useEffect(() => {
    let alive = true;
    setEntries(null);
    setFailed(false);
    fetchLeaderboard(kind, puzzle, effectiveParty, period)
      .then((e) => alive && setEntries(e))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [kind, puzzle, effectiveParty, period]);

  const tab = TABS.find((t) => t.id === kind)!;
  const value = (e: LeaderboardEntry) => {
    if (kind === 'fastest') return { main: formatTime(e.value), sub: `${formatPercent(e.secondary)} precise` };
    if (kind === 'precision') return { main: formatPercent(e.value), sub: formatTime(e.secondary) };
    if (kind === 'points') return { main: `${e.value} pts`, sub: `${e.secondary} countries` };
    return { main: `${e.value.toLocaleString()}`, sub: `${e.secondary} maps` };
  };

  return (
    <div className="page">
      <header className="topnav">
        <Link to="/" className="btn ghost small">
          <ArrowLeft size={17} /> Home
        </Link>
      </header>
      <div className="picker-head">
        <h1>Leaderboards</h1>
      </div>

      <div className="lb-tabs" role="tablist" aria-label="Leaderboard">
        {TABS.map((t) => (
          <button key={t.id} className="lb-tab" role="tab" aria-selected={kind === t.id} onClick={() => setKind(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 14, margin: '8px 0 0' }}>
        {tab.hint}
      </p>

      <div className="lb-filters">
        {kind !== 'alltime' && (
          <select className="select" value={puzzle} onChange={(e) => setPuzzle(e.target.value as PuzzleId)} aria-label="Map">
            {PUZZLES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        {kind !== 'alltime' && (
          <div className="segmented">
            {(kind === 'points' ? (['duo', 'quad'] as PartyBucket[]) : (['solo', 'duo', 'quad'] as PartyBucket[])).map((p) => (
              <button key={p} aria-pressed={effectiveParty === p} onClick={() => setParty(p)}>
                {p === 'solo' ? 'Solo' : p === 'duo' ? 'Duo' : 'Quad'}
              </button>
            ))}
          </div>
        )}
        <div className="segmented">
          <button aria-pressed={period === 'all'} onClick={() => setPeriod('all')}>
            All time
          </button>
          <button aria-pressed={period === 'week'} onClick={() => setPeriod('week')}>
            This week
          </button>
        </div>
      </div>

      {failed ? (
        <div className="empty-state">Leaderboards are unavailable right now.</div>
      ) : entries === null ? (
        <div className="empty-state">
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      ) : entries.length === 0 ? (
        <div className="empty-state">No results yet. Be the first on this board.</div>
      ) : (
        <div className="lb-table">
          {entries.map((e) => {
            const v = value(e);
            const mine = !!me && e.names.toLowerCase().split(' & ').includes(me);
            return (
              <div key={`${e.rank}-${e.names}`} className={`lb-row${e.rank <= 3 ? ' top' : ''}`} style={mine ? { borderColor: 'var(--ink)' } : undefined}>
                <span className="rank">{e.rank}</span>
                <span className="names">
                  {e.names}
                  <small>{new Date(e.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small>
                </span>
                <span className="value">
                  {v.main}
                  <small>{v.sub}</small>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
