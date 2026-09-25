import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowLeftRight, Check, Copy, Crown, Share2, UserMinus } from 'lucide-react';
import {
  isPuzzleId,
  modeLabel,
  normalizeRoomCode,
  PLAYER_COLORS,
  PUZZLE_BY_ID,
  PUZZLES,
  TEAM_NAMES,
  validModes,
  type GameMode,
  type PartySize,
  type PlayerInfo,
  type RoomSettings,
} from '@geolearn/shared';
import { CATALOG_BY_ID } from '../app/api';
import { Link, useRouter } from '../app/router';
import { useIdentity } from '../app/stores';
import { ensureName, useUi } from '../app/ui';
import { Silhouette } from '../components/Silhouette';
import { sound } from '../game/engine/audio';
import { PuzzleView } from '../game/PuzzleView';
import { roomClient, useRoomStore } from '../net/roomClient';

function settingsFromQuery(q: URLSearchParams): RoomSettings | null {
  const puzzle = q.get('puzzle');
  if (!isPuzzleId(puzzle)) return null;
  const party = Number(q.get('party') ?? '1');
  const partySize = (party === 2 || party === 4 ? party : 1) as PartySize;
  const modeRaw = q.get('mode') as GameMode | null;
  const mode = modeRaw && validModes(partySize).includes(modeRaw) ? modeRaw : 'coop';
  return { puzzleId: puzzle, mode, partySize, isPublic: partySize > 1 && q.get('public') !== '0' };
}

export function RoomPage({ code: rawCode }: { code: string }) {
  const { navigate, query } = useRouter();
  const token = useIdentity((s) => s.token);
  const toast = useUi((s) => s.toast);
  const { room, you, conn, error, left } = useRoomStore();
  const [needsName, setNeedsName] = useState(false);
  const isNew = rawCode === 'new';
  const code = isNew ? null : normalizeRoomCode(rawCode);
  const started = useRef<string | null>(null);

  // Connect (create or join) once we know who you are.
  useEffect(() => {
    const key = isNew ? `new:${query.toString()}` : `join:${code}`;
    if (started.current === key) return;
    let cancelled = false;
    void (async () => {
      const name = await ensureName();
      if (cancelled) return;
      if (!name) {
        setNeedsName(true);
        return;
      }
      setNeedsName(false);
      started.current = key;
      if (isNew) {
        const settings = settingsFromQuery(query);
        if (!settings) {
          navigate('/puzzle', { replace: true });
          return;
        }
        roomClient.create(name, token, settings);
      } else if (code) {
        roomClient.join(name, token, code);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, code, token]);

  // Leave the room when navigating away.
  useEffect(() => () => roomClient.leave(), []);

  // Once created, show the real code in the address bar.
  useEffect(() => {
    if (isNew && room && room.code !== 'SOLO') {
      started.current = `join:${room.code}`;
      navigate(`/room/${room.code}`, { replace: true });
    }
  }, [isNew, room?.code]);

  // Solo games start straight away (and again after "Play again").
  const me = room?.players.find((p) => p.id === you);
  useEffect(() => {
    if (room && room.settings.partySize === 1 && room.status === 'lobby' && me?.host) roomClient.send({ t: 'start' });
  }, [room?.status, room?.settings.partySize, me?.host]);

  // Friendly chime when someone joins the lobby.
  const count = room?.players.length ?? 0;
  const prevCount = useRef(count);
  useEffect(() => {
    if (room?.status === 'lobby' && count > prevCount.current) sound.join();
    prevCount.current = count;
  }, [count, room?.status]);

  useEffect(() => {
    if (error && room) toast(error.message);
  }, [error?.at]);

  useEffect(() => {
    if (left === 'kicked') toast('The host removed you from the room');
  }, [left]);

  const leave = () => {
    roomClient.leave();
    navigate(room?.settings.partySize === 1 ? '/puzzle' : '/');
  };

  if (needsName) {
    return (
      <div className="page">
        <div className="center-screen">
          <div>
            <p>Choose a name to join this game.</p>
            <button className="btn" onClick={() => void ensureName().then((n) => n && window.location.reload())}>
              Choose a name
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!room || !you) {
    const fatal = conn === 'closed' && error;
    return (
      <div className="page">
        <header className="topnav">
          <Link to="/" className="btn ghost small">
            <ArrowLeft size={17} /> Home
          </Link>
        </header>
        <div className="center-screen">
          {fatal ? (
            <div>
              <h2 className="serif" style={{ fontWeight: 520, fontSize: 28 }}>
                {error.code === 'room-not-found' ? 'That room has closed' : error.code === 'rate-limited' ? 'One moment' : 'Can’t join'}
              </h2>
              <p className="muted">{error.message}</p>
              <Link to="/puzzle" className="btn" onClick={() => roomClient.leave()}>
                Start a new game
              </Link>
            </div>
          ) : left ? (
            <div>
              <p className="muted">{left === 'kicked' ? 'You were removed from this room.' : 'This room has closed.'}</p>
              <Link to="/" className="btn">
                Home
              </Link>
            </div>
          ) : (
            <div style={{ display: 'grid', justifyItems: 'center', gap: 12 }}>
              <div className="spinner" />
              <span className="muted">{conn === 'reconnecting' ? 'Reconnecting…' : isNew ? 'Setting up your table…' : 'Joining…'}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (room.status === 'lobby' && room.settings.partySize > 1) return <Lobby onLeave={leave} />;
  return <PuzzleView room={room} you={you} onLeave={leave} />;
}

function Lobby({ onLeave }: { onLeave: () => void }) {
  const { room, you } = useRoomStore();
  const toast = useUi((s) => s.toast);
  const [copied, setCopied] = useState(false);
  if (!room || !you) return null;
  const me = room.players.find((p) => p.id === you);
  const isHost = !!me?.host;
  const s = room.settings;
  const puzzle = PUZZLE_BY_ID.get(s.puzzleId)!;
  const link = `${window.location.origin}/room/${room.code}`;
  const canStart =
    s.mode === 'coop' ? room.players.length >= 1 : s.mode === 'teams' ? new Set(room.players.map((p) => p.team)).size === 2 : room.players.length >= 2;

  const update = (patch: Partial<RoomSettings>) => {
    const next = { ...s, ...patch };
    if (!validModes(next.partySize).includes(next.mode)) next.mode = 'coop';
    if (next.partySize < room.players.length) {
      toast('Too many players for that size');
      return;
    }
    roomClient.send({ t: 'settings', settings: next });
  };

  const share = async () => {
    const text = `Join my ${puzzle.name} puzzle on GeoLearn — code ${room.code}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'GeoLearn', text, url: link });
        return;
      } catch {
        /* cancelled */
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast(link);
    }
  };

  const canShare = typeof navigator.share === 'function';
  const seats = Array.from({ length: s.partySize }, (_, i) => room.players[i] ?? null);

  const playerRow = (p: PlayerInfo | null, i: number) =>
    p ? (
      <div key={p.id} className="player-row" style={{ opacity: p.connected ? 1 : 0.5 }}>
        <span className="avatar" style={{ background: PLAYER_COLORS[p.color % PLAYER_COLORS.length] }}>
          {p.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="name">
          {p.name}
          {p.id === you ? ' (you)' : ''}
        </span>
        {p.host && <Crown size={16} color="#c99a2e" aria-label="Host" />}
        {s.mode === 'teams' && (isHost || p.id === you) && (
          <button
            className="btn small secondary switch-btn"
            aria-label={p.id === you ? `Switch to Team ${TEAM_NAMES[p.team === 0 ? 1 : 0]}` : `Move ${p.name} to Team ${TEAM_NAMES[p.team === 0 ? 1 : 0]}`}
            title={`Move to Team ${TEAM_NAMES[p.team === 0 ? 1 : 0]}`}
            onClick={() => roomClient.send({ t: 'team', id: p.id, team: p.team === 0 ? 1 : 0 })}
          >
            <ArrowLeftRight size={15} />
            <span className="switch-label">Switch</span>
          </button>
        )}
        {isHost && p.id !== you && (
          <button
            className="icon-btn"
            style={{ width: 34, height: 34 }}
            aria-label={`Remove ${p.name}`}
            onClick={() => roomClient.send({ t: 'kick', id: p.id })}
          >
            <UserMinus size={15} />
          </button>
        )}
      </div>
    ) : (
      <div key={`empty-${i}`} className="player-row empty">
        <span className="avatar" style={{ background: 'transparent', border: '1.5px dashed var(--line-2)' }} />
        <span className="name">Waiting for a player…</span>
      </div>
    );

  return (
    <div className="page">
      <header className="topnav">
        <button className="btn ghost small" onClick={onLeave}>
          <ArrowLeft size={17} /> Leave
        </button>
        <span className="badge live">
          {room.players.length} / {s.partySize} here
        </span>
      </header>

      <div className="lobby">
        <section className="card lobby-card">
          <div className="section-title">Invite friends</div>
          <div className="code-display" style={{ marginTop: 10 }}>
            <span className="code">{room.code}</span>
            <button className="btn small" onClick={share}>
              {copied ? <Check size={16} /> : canShare ? <Share2 size={16} /> : <Copy size={16} />}
              {copied ? 'Copied' : canShare ? 'Share' : 'Copy link'}
            </button>
          </div>
          <p className="muted" style={{ fontSize: 13.5, margin: '10px 2px 0' }}>
            Friends can open the link, or enter the code on the home page.
          </p>

          <div className="section-title" style={{ marginTop: 22 }}>
            Players
          </div>
          {s.mode === 'teams' ? (
            <div className="team-cols" style={{ marginTop: 10 }}>
              {[0, 1].map((t) => {
                const members = room.players.filter((p) => p.team === t);
                const open = Math.max(0, s.partySize / 2 - members.length);
                return (
                  <div key={t} className="team-col">
                    <div className="muted" style={{ fontSize: 13, fontWeight: 650, marginBottom: 6 }}>
                      Team {TEAM_NAMES[t]}
                    </div>
                    <div className="players" style={{ marginTop: 0 }}>
                      {members.map((p, i) => playerRow(p, i))}
                      {Array.from({ length: open }, (_, i) => playerRow(null, t * 10 + i))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="players">{seats.map((p, i) => playerRow(p, i))}</div>
          )}
        </section>

        <section className="card lobby-card">
          <div className="lobby-map">
            <div className="mini">
              <Silhouette id={s.puzzleId} className="silhouette" />
            </div>
            <div>
              <div style={{ fontWeight: 650, fontSize: 18 }}>{puzzle.name}</div>
              <div className="muted" style={{ fontSize: 13.5 }}>
                {CATALOG_BY_ID.get(s.puzzleId)?.pieces} countries · {modeLabel(s.mode)}
              </div>
            </div>
          </div>

          {isHost ? (
            <div style={{ marginTop: 10 }}>
              <div className="setting-row">
                <span className="label">Map</span>
                <select className="select" value={s.puzzleId} onChange={(e) => update({ puzzleId: e.target.value as RoomSettings['puzzleId'] })}>
                  {PUZZLES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="setting-row">
                <span className="label">Players</span>
                <div className="segmented">
                  {([2, 4] as PartySize[]).map((n) => (
                    <button key={n} aria-pressed={s.partySize === n} onClick={() => update({ partySize: n })}>
                      {n === 2 ? 'Duo' : 'Quad'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="setting-row">
                <span className="label">Mode</span>
                <div className="segmented">
                  {validModes(s.partySize).map((m) => (
                    <button key={m} aria-pressed={s.mode === m} onClick={() => update({ mode: m })}>
                      {modeLabel(m)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="setting-row">
                <span className="label">Open to anyone</span>
                <button className="toggle" role="switch" aria-checked={s.isPublic} onClick={() => update({ isPublic: !s.isPublic })} />
              </div>
              <button className="btn block accent" style={{ marginTop: 16, height: 52 }} disabled={!canStart} onClick={() => roomClient.send({ t: 'start' })}>
                {canStart ? 'Start game' : s.mode === 'coop' ? 'Start game' : s.mode === 'teams' ? 'Each team needs a player' : 'Waiting for a second player'}
              </button>
              {s.mode === 'coop' && room.players.length < s.partySize && (
                <p className="muted" style={{ fontSize: 13, textAlign: 'center', margin: '10px 0 0' }}>
                  You can start now — friends can still drop in.
                </p>
              )}
            </div>
          ) : (
            <div style={{ marginTop: 16 }}>
              <p className="muted" style={{ margin: 0 }}>
                {s.mode === 'coop'
                  ? 'Together: build the map as a team, against the clock.'
                  : s.mode === 'versus'
                    ? 'Versus: every country you place scores points. Small countries score more, streaks add a bonus.'
                    : 'Teams: two against two. Team points win.'}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
                <div className="spinner" />
                <span className="muted">Waiting for {room.players.find((p) => p.host)?.name ?? 'the host'} to start…</span>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
