import { useEffect, useState } from 'react';
import { Map as MapIcon, RotateCcw, Sparkles, Trophy } from 'lucide-react';
import { modeLabel, partyBucket, PLAYER_COLORS, PUZZLE_BY_ID, TEAM_NAMES, type LeaderboardPlacement, type RoomSnapshot } from '@geolearn/shared';
import { useRouter } from '../app/router';
import { useBests } from '../app/stores';
import { roomClient } from '../net/roomClient';
import { formatPercent, formatTime, ordinal } from './format';

function placementText(p: LeaderboardPlacement, party: string): string {
  const board = p.board === 'fastest' ? 'fastest' : p.board === 'precision' ? 'most precise' : 'top scores';
  return `${ordinal(p.rank)} ${board} · ${party}`;
}

export function Results({ room, you, offline, onHide, onLeave }: { room: RoomSnapshot; you: string; offline: boolean; onHide: () => void; onLeave: () => void }) {
  const { navigate } = useRouter();
  const r = room.results!;
  const me = room.players.find((p) => p.id === you);
  const isHost = !!me?.host;
  const solo = room.settings.partySize === 1;
  const puzzle = PUZZLE_BY_ID.get(r.puzzleId);
  const bestKey = `${r.puzzleId}:solo`;
  // Compare against the best from *before* this game (recording is idempotent).
  const [previousBest] = useState(() => useBests.getState().best[bestKey]);
  const localBest = solo && r.completed && (previousBest === undefined || r.durationMs < previousBest);
  const mine = r.players.find((p) => p.id === you);
  const party = partyBucket(r.playerCount);

  useEffect(() => {
    if (solo && r.completed) useBests.getState().record(bestKey, r.durationMs);
  }, [solo, r, bestKey]);

  let title = r.completed ? 'Map complete' : 'Game over';
  if (r.mode === 'versus') {
    const winners = r.players.filter((p) => r.winners.includes(p.id));
    title = winners.some((w) => w.id === you) ? (winners.length > 1 ? 'A shared win!' : 'You win!') : `${winners.map((w) => w.name).join(' & ')} wins`;
  } else if (r.mode === 'teams') {
    title = r.winningTeam === null ? 'A perfect tie' : mine && mine.team === r.winningTeam ? `Team ${TEAM_NAMES[r.winningTeam]} wins — that's you!` : `Team ${TEAM_NAMES[r.winningTeam]} wins`;
  }

  const stats =
    r.mode === 'coop'
      ? [
          { v: formatTime(r.durationMs), l: 'Time' },
          { v: formatPercent(r.precision), l: 'Precision' },
          { v: `${r.placedPieces}`, l: 'Countries' },
        ]
      : [
          { v: `${mine?.points ?? 0}`, l: 'Your points' },
          { v: `${mine?.placed ?? 0}`, l: 'You placed' },
          { v: formatTime(r.durationMs), l: 'Time' },
        ];

  const teamTotals = r.mode === 'teams' ? [0, 1].map((t) => r.players.filter((p) => p.team === t).reduce((n, p) => n + p.points, 0)) : null;

  return (
    <div className="results">
      <div className="results-card" role="dialog" aria-label="Results">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 13, fontWeight: 600 }}>
          <Sparkles size={15} />
          {puzzle?.name} · {solo ? 'Solo' : `${modeLabel(r.mode)} · ${r.playerCount} players`}
        </div>
        <h2 style={{ marginTop: 6 }}>{title}</h2>

        <div className="big-stats">
          {stats.map((s) => (
            <div key={s.l} className="big-stat">
              <b>{s.v}</b>
              <span>{s.l}</span>
            </div>
          ))}
        </div>

        {(offline || localBest || (r.leaderboard && r.leaderboard.length > 0)) && (
          <div className="placements">
            {offline && <span className="placement" style={{ background: 'var(--bg-soft)', color: 'var(--muted)' }}>Offline · not ranked</span>}
            {localBest && (
              <span className="placement">
                <Trophy size={14} /> Personal best
              </span>
            )}
            {r.leaderboard?.map((p) => (
              <span key={p.board} className="placement">
                <Trophy size={14} /> {placementText(p, party)}
              </span>
            ))}
          </div>
        )}

        {teamTotals && (
          <div className="teams" style={{ marginBottom: 10 }}>
            {teamTotals.map((t, i) => (
              <div key={i} className="big-stat">
                <b>{t}</b>
                <span>Team {TEAM_NAMES[i]}</span>
              </div>
            ))}
          </div>
        )}

        {r.players.length > 1 && (
          <div className="result-rows">
            {r.players.map((p) => (
              <div key={p.id} className="result-row">
                <span className="rank">{p.rank}</span>
                <span className="who">
                  <span className="dot" style={{ background: PLAYER_COLORS[p.color % PLAYER_COLORS.length] }} />
                  <span>
                    {p.name}
                    {p.id === you ? ' (you)' : ''}
                  </span>
                </span>
                <span className="val">
                  {r.mode === 'coop' ? `${p.placed} placed` : `${p.points} pts`}
                  <small>{formatPercent(p.precision)}</small>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="actions">
          <button className="btn secondary" onClick={onHide} aria-label="View the map">
            <MapIcon size={17} /> Map
          </button>
          {isHost ? (
            <button className="btn" onClick={() => roomClient.send({ t: 'rematch' })}>
              <RotateCcw size={17} /> {solo ? 'Play again' : 'Rematch'}
            </button>
          ) : (
            <button className="btn" disabled>
              Waiting for host…
            </button>
          )}
        </div>
        <div className="actions" style={{ marginTop: 8 }}>
          <button className="btn ghost" onClick={() => navigate('/leaderboards')}>
            Leaderboards
          </button>
          <button className="btn ghost" onClick={onLeave}>
            {solo ? 'Other maps' : 'Leave room'}
          </button>
        </div>
      </div>
    </div>
  );
}
