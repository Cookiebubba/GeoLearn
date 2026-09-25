import { useEffect, useState } from 'react';
import { ArrowRight, Flag, Landmark, Shapes, Trophy, Users } from 'lucide-react';
import { modeLabel, normalizeRoomCode, partyLabel, PUZZLE_BY_ID, ROOM_CODE_LENGTH, type OpenRoomSummary } from '@geolearn/shared';
import { fetchOpenRooms, fetchStats } from '../app/api';
import { Link, useRouter } from '../app/router';
import { useIdentity } from '../app/stores';
import { useUi } from '../app/ui';
import { Brand } from '../components/Brand';
import { Silhouette } from '../components/Silhouette';

export function TopNav() {
  const name = useIdentity((s) => s.name);
  const openName = useUi((s) => s.openName);
  return (
    <header className="topnav">
      <Brand />
      <nav className="nav-links">
        <Link to="/leaderboards" className="btn ghost small">
          <Trophy size={16} />
          <span className="nav-label">Leaderboards</span>
        </Link>
        <button className="chip" onClick={() => void openName()} title="Change name">
          <span className="dot" style={{ background: name ? '#2c8a7e' : '#c9c9c4' }} />
          {name ?? 'Set name'}
        </button>
      </nav>
    </header>
  );
}

export function Home() {
  const { navigate } = useRouter();
  const [code, setCode] = useState('');
  const [rooms, setRooms] = useState<OpenRoomSummary[]>([]);
  const [stats, setStats] = useState<{ online: number; countries: number; games: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchOpenRooms()
        .then((r) => alive && setRooms(r))
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 6000);
    fetchStats()
      .then((s) => alive && setStats(s))
      .catch(() => {});
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const c = normalizeRoomCode(code);
    if (c.length === ROOM_CODE_LENGTH) navigate(`/room/${c}`);
  };

  return (
    <div className="page">
      <TopNav />
      <section className="hero">
        <h1>Rebuild the world, one country at a time.</h1>
        <p>Calm geography games to play on your own or together. No accounts, no clutter, just the map.</p>
      </section>

      <section className="games">
        <Link to="/puzzle" className="card game-card primary">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="badge live">Multiplayer · Live</span>
            <span className="muted" style={{ fontSize: 13 }}>
              7 maps
            </span>
          </div>
          <div className="art">
            <Silhouette id="world" className="silhouette" />
          </div>
          <h2>Map Puzzle</h2>
          <p>Every country is a piece. Drop them into the empty continent — alone, as a duo, or four at once.</p>
          <span className="btn" style={{ alignSelf: 'flex-start' }}>
            Play <ArrowRight size={17} />
          </span>
        </Link>

        <div className="soon-list">
          <div className="card soon">
            <div className="glyph">
              <Landmark size={20} />
            </div>
            <div>
              <h3>Capital Quest</h3>
              <p>Pin every capital on the map.</p>
            </div>
            <span className="badge" style={{ marginLeft: 'auto' }}>
              Soon
            </span>
          </div>
          <div className="card soon">
            <div className="glyph">
              <Flag size={20} />
            </div>
            <div>
              <h3>Flag Match</h3>
              <p>Match flags to countries, fast.</p>
            </div>
            <span className="badge" style={{ marginLeft: 'auto' }}>
              Soon
            </span>
          </div>
          <div className="card soon">
            <div className="glyph">
              <Shapes size={20} />
            </div>
            <div>
              <h3>Borderlines</h3>
              <p>Name the country from its shape.</p>
            </div>
            <span className="badge" style={{ marginLeft: 'auto' }}>
              Soon
            </span>
          </div>
        </div>
      </section>

      <section className="block-gap">
        <div className="section-title">Join friends</div>
        <form className="join-row" onSubmit={join}>
          <input
            className="input code"
            value={code}
            onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
            placeholder="CODE"
            aria-label="Room code"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            maxLength={ROOM_CODE_LENGTH}
          />
          <button className="btn" disabled={normalizeRoomCode(code).length !== ROOM_CODE_LENGTH}>
            Join
          </button>
        </form>

        {rooms.length > 0 && (
          <div className="rooms">
            {rooms.map((r) => (
              <Link key={r.code} to={`/room/${r.code}`} className="card room-row">
                <Users size={18} className="muted" />
                <div className="meta">
                  <strong>
                    {PUZZLE_BY_ID.get(r.puzzleId)?.name} · {modeLabel(r.mode)}
                  </strong>
                  <span>
                    {r.host}'s {partyLabel(r.partySize).toLowerCase()} · {r.players}/{r.partySize} players{r.status !== 'lobby' ? ' · in progress' : ''}
                  </span>
                </div>
                <span className="btn small secondary">Join</span>
              </Link>
            ))}
          </div>
        )}
        {stats && (stats.online > 0 || stats.games > 0) && (
          <div className="stats-line">
            {stats.online > 0 && <span>{stats.online} playing now</span>}
            {stats.countries > 0 && <span>{stats.countries.toLocaleString()} countries placed</span>}
            {stats.games > 0 && <span>{stats.games.toLocaleString()} maps finished</span>}
          </div>
        )}
      </section>

      <footer className="footer">Borders follow the internationally recognised (UN) view · Map data: Natural Earth · Flags: flag-icons</footer>
    </div>
  );
}
