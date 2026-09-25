import { useEffect } from 'react';
import { match, RouterProvider, useRouter, Link } from './app/router';
import { usePrefs } from './app/stores';
import { NameDialog, Toasts } from './components/NameDialog';
import { sound } from './game/engine/audio';
import { Home } from './pages/Home';
import { Leaderboards } from './pages/Leaderboards';
import { PuzzlePicker } from './pages/PuzzlePicker';
import { RoomPage } from './pages/Room';

function Routes() {
  const { path } = useRouter();
  if (path === '/') return <Home />;
  if (path === '/puzzle') return <PuzzlePicker />;
  if (path === '/leaderboards') return <Leaderboards />;
  const room = match('/room/:code', path);
  if (room) return <RoomPage code={room.code} />;
  return (
    <div className="page">
      <div className="center-screen">
        <div>
          <h1 className="serif" style={{ fontWeight: 520 }}>
            Off the map
          </h1>
          <p className="muted">There’s nothing here.</p>
          <Link to="/" className="btn">
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}

export function App() {
  useEffect(() => {
    const { muted, volume } = usePrefs.getState();
    sound.setMuted(muted);
    sound.setVolume(volume);
    // Browsers only allow audio after a gesture; unlock on the first one.
    const unlock = () => sound.unlock();
    window.addEventListener('pointerdown', unlock, { once: true, capture: true });
    window.addEventListener('keydown', unlock, { once: true, capture: true });
    // Safari: stop pinch-zooming the whole page.
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', stop, { passive: false });
    return () => document.removeEventListener('gesturestart', stop);
  }, []);

  return (
    <RouterProvider>
      <Routes />
      <NameDialog />
      <Toasts />
    </RouterProvider>
  );
}
