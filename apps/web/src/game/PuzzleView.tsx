import { useEffect, useMemo, useRef, useState } from 'react';
import { LocateFixed, Minus, Plus, WifiOff, X } from 'lucide-react';
import { buildPuzzleModel, PLAYER_COLORS, type PuzzleModel, type RoomSnapshot } from '@geolearn/shared';
import { loadPuzzle, loadPuzzleDetail } from '../app/api';
import { usePrefs } from '../app/stores';
import { roomClient, useRoomStore, type GameListener } from '../net/roomClient';
import { sound } from './engine/audio';
import { PALETTE_BY_ID, PALETTES } from './engine/palette';
import { PuzzleEngine } from './engine/PuzzleEngine';
import { formatTime } from './format';
import { PaletteMenu, SoundButton, VisibilityMenu } from './HudMenus';
import { Results } from './Results';

function useSafeAreas() {
  const [s, setS] = useState({ top: 0, bottom: 0 });
  useEffect(() => {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
    document.body.appendChild(probe);
    const read = () => {
      const cs = getComputedStyle(probe);
      setS({ top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 });
    };
    read();
    window.addEventListener('resize', read);
    return () => {
      window.removeEventListener('resize', read);
      probe.remove();
    };
  }, []);
  return s;
}

function ProgressRing({ value }: { value: number }) {
  const r = 10;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 26 26" aria-hidden="true">
      <circle cx="13" cy="13" r={r} fill="none" stroke="#ececE8" strokeWidth="3.2" />
      <circle
        cx="13"
        cy="13"
        r={r}
        fill="none"
        stroke="#2c8a7e"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeDasharray={`${c * value} ${c}`}
        transform="rotate(-90 13 13)"
        style={{ transition: 'stroke-dasharray .5s cubic-bezier(.2,.9,.2,1)' }}
      />
    </svg>
  );
}

export function PuzzleView({ room, you, onLeave }: { room: RoomSnapshot; you: string; onLeave: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const staticRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<PuzzleEngine | null>(null);
  const [model, setModel] = useState<PuzzleModel | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [progress, setProgress] = useState({ placed: 0, total: 0 });
  const [now, setNow] = useState(() => roomClient.serverNow());
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [resultsMode, setResultsMode] = useState<'waiting' | 'open' | 'hidden'>('waiting');
  const gameEpoch = useRoomStore((s) => s.gameEpoch);
  const conn = useRoomStore((s) => s.conn);
  const offline = useRoomStore((s) => s.offline);
  const { palette, visibility, muted, volume, haptics } = usePrefs();
  const safe = useSafeAreas();
  const puzzleId = room.settings.puzzleId;
  const status = room.status;

  // Puzzle geometry.
  useEffect(() => {
    let alive = true;
    setModel(null);
    loadPuzzle(puzzleId)
      .then((d) => alive && setModel(buildPuzzleModel(d)))
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, [puzzleId]);

  // Engine lifecycle.
  useEffect(() => {
    const canvas = canvasRef.current;
    const staticCanvas = staticRef.current;
    if (!model || !canvas || !staticCanvas) return;
    const prefs = usePrefs.getState();
    const engine = new PuzzleEngine(
      { staticCanvas, dynamicCanvas: canvas },
      {
        model,
        you,
        palette: PALETTE_BY_ID.get(prefs.palette) ?? PALETTES[0],
        visibility: prefs.visibility,
        sound,
        haptics: prefs.haptics,
        callbacks: {
          grab: (p, m) => roomClient.send({ t: 'grab', p, m }),
          move: (p, x, y) => roomClient.send({ t: 'move', p, x, y }),
          drop: (p, x, y, z) => roomClient.send({ t: 'drop', p, x, y, z }),
          cursor: (x, y) => roomClient.send({ t: 'cursor', x, y }),
          progress: (placed, total) => setProgress({ placed, total }),
        },
      },
    );
    engineRef.current = engine;
    (window as unknown as { __geolearn?: unknown }).__geolearn = { engine };
    const listener: GameListener = {
      onGrabbed: (p, by, m) => engine.onGrabbed(p, by, m),
      onDenied: (p) => engine.onDenied(p),
      onMoved: (p, x, y, by) => engine.onMoved(p, x, y, by),
      onDropped: (p, x, y, z, by, placed, miss) => engine.onDropped(p, x, y, z, by, placed, miss),
      onCursor: (id, x, y) => engine.onCursor(id, x, y),
    };
    roomClient.setListener(listener);
    const state = useRoomStore.getState();
    if (state.room?.game) engine.load(state.room.game);
    if (state.room) {
      engine.setPlayers(state.room.players);
      engine.setInteractive(state.room.status === 'playing');
    }
    let alive = true;
    // The detailed outlines are only needed once you zoom in; fetch them quietly.
    const t = setTimeout(() => {
      loadPuzzleDetail(model.id)
        .then((d) => alive && engine.loadDetail(d))
        .catch(() => {});
    }, 1200);
    return () => {
      alive = false;
      clearTimeout(t);
      roomClient.setListener(null);
      engine.destroy();
      engineRef.current = null;
    };
  }, [model, you]);

  // New game snapshot (start / rematch / reconnect).
  useEffect(() => {
    const game = useRoomStore.getState().room?.game;
    if (engineRef.current && game) engineRef.current.load(game);
  }, [gameEpoch]);

  useEffect(() => {
    engineRef.current?.setPlayers(room.players);
  }, [room.players]);

  useEffect(() => {
    engineRef.current?.setInteractive(status === 'playing');
    if (status !== 'finished') setResultsMode('waiting');
  }, [status, model]);

  useEffect(() => {
    engineRef.current?.setPalette(PALETTE_BY_ID.get(palette) ?? PALETTES[0]);
  }, [palette, model]);

  useEffect(() => {
    engineRef.current?.setVisibility(visibility);
  }, [visibility, model]);

  useEffect(() => {
    engineRef.current?.setHaptics(haptics);
  }, [haptics]);

  useEffect(() => {
    sound.setVolume(volume);
    sound.setMuted(muted);
  }, [muted, volume]);

  useEffect(() => {
    engineRef.current?.setInsets({ top: 58 + safe.top, right: 0, bottom: 10 + safe.bottom, left: 0 });
  }, [safe.top, safe.bottom, model]);

  // Clock for the timer and countdown.
  useEffect(() => {
    const t = setInterval(() => setNow(roomClient.serverNow()), 200);
    return () => clearInterval(t);
  }, []);

  // Countdown blips.
  const countdown = status === 'countdown' && room.countdownEndsAt ? Math.max(0, Math.ceil((room.countdownEndsAt - now) / 1000)) : null;
  const lastBlip = useRef<number | null>(null);
  useEffect(() => {
    if (countdown === null) {
      lastBlip.current = null;
      return;
    }
    if (countdown !== lastBlip.current && countdown > 0 && countdown <= 3) {
      lastBlip.current = countdown;
      sound.countdown(countdown);
    }
  }, [countdown]);
  const [go, setGo] = useState(false);
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === 'countdown' && status === 'playing') {
      sound.countdown(0);
      setGo(true);
      const t = setTimeout(() => setGo(false), 700);
      prevStatus.current = status;
      return () => clearTimeout(t);
    }
    prevStatus.current = status;
  }, [status]);

  // Results appear after the celebration has had a moment.
  useEffect(() => {
    if (status === 'finished' && room.results) {
      const t = setTimeout(() => setResultsMode((m) => (m === 'waiting' ? 'open' : m)), room.results.completed ? 1900 : 300);
      return () => clearTimeout(t);
    }
  }, [status, room.results]);

  const leave = () => {
    if (status === 'playing' && !confirmLeave && progress.placed > 0 && progress.placed < progress.total) {
      setConfirmLeave(true);
      setTimeout(() => setConfirmLeave(false), 3000);
      return;
    }
    onLeave();
  };

  const startedAt = room.game?.startedAt ?? null;
  const elapsed = status === 'finished' && room.results ? room.results.durationMs : startedAt && status === 'playing' ? now - startedAt : 0;
  const total = progress.total || model?.pieces.length || 0;
  const players = room.players;
  const versus = room.settings.mode !== 'coop';
  const sortedPlayers = useMemo(() => [...players].sort((a, b) => (versus ? b.stats.points - a.stats.points : 0)), [players, versus]);

  return (
    <div className="game">
      <div className="stage">
        <canvas ref={staticRef} className="layer-static" aria-hidden="true" />
        <canvas ref={canvasRef} className="layer-dynamic" aria-label={`${room.settings.puzzleId} map puzzle`} />
      </div>

      <div className="hud-top">
        <div className="hud-group">
          <button
            className={`icon-btn${confirmLeave ? ' active' : ''}`}
            aria-label="Leave game"
            onClick={leave}
            style={confirmLeave ? { width: 'auto', padding: '0 14px', fontSize: 14, fontWeight: 650 } : undefined}
          >
            {confirmLeave ? 'Leave?' : <X size={20} />}
          </button>
        </div>
        <div className="progress-pill" aria-live="polite">
          <ProgressRing value={total ? progress.placed / total : 0} />
          <span className="count">
            {progress.placed}
            <span> / {total}</span>
          </span>
          <span className="time">{formatTime(elapsed)}</span>
        </div>
        <div className="hud-group">
          <VisibilityMenu />
          <PaletteMenu />
          <SoundButton />
        </div>
      </div>

      {players.length > 1 && (
        <div className="hud-players">
          {sortedPlayers.map((p) => (
            <div key={p.id} className={`hud-player${p.connected ? '' : ' away'}`}>
              <span className="dot" style={{ background: PLAYER_COLORS[p.color % PLAYER_COLORS.length] }} />
              <span>{p.id === you ? 'You' : p.name}</span>
              <span className="score">{versus ? p.stats.points : p.stats.placed}</span>
            </div>
          ))}
        </div>
      )}

      <div className="hud-zoom">
        <button className="icon-btn zoom-step" aria-label="Zoom in" onClick={() => engineRef.current?.zoomBy(1.6)}>
          <Plus size={19} />
        </button>
        <button className="icon-btn zoom-step" aria-label="Zoom out" onClick={() => engineRef.current?.zoomBy(1 / 1.6)}>
          <Minus size={19} />
        </button>
        <button className="icon-btn" aria-label="Show everything" onClick={() => engineRef.current?.fitTable()}>
          <LocateFixed size={18} />
        </button>
      </div>

      {countdown !== null && countdown > 0 && (
        <div className="countdown" key={countdown}>
          <span>{countdown}</span>
        </div>
      )}
      {go && (
        <div className="countdown">
          <span style={{ fontSize: 64 }}>Go</span>
        </div>
      )}

      {conn === 'reconnecting' && !offline && (
        <div className="banner">
          <WifiOff size={15} /> Reconnecting…
        </div>
      )}
      {!model && !loadError && (
        <div className="countdown">
          <div className="spinner" />
        </div>
      )}
      {loadError && <div className="banner">Couldn’t load this map. Check your connection.</div>}

      {status === 'finished' && room.results && resultsMode === 'open' && (
        <Results room={room} you={you} offline={offline} onHide={() => setResultsMode('hidden')} onLeave={onLeave} />
      )}
      {status === 'finished' && room.results && resultsMode === 'hidden' && (
        <div className="results" style={{ pointerEvents: 'none' }}>
          <button className="btn" style={{ pointerEvents: 'auto', marginBottom: 6 }} onClick={() => setResultsMode('open')}>
            Results
          </button>
        </div>
      )}
    </div>
  );
}
