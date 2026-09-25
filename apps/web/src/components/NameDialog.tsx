import { useEffect, useRef, useState } from 'react';
import { validateName } from '@geolearn/shared';
import { claimName } from '../app/api';
import { useIdentity } from '../app/stores';
import { useUi } from '../app/ui';
import { BrandMark } from './Brand';

export function NameDialog() {
  const open = useUi((s) => s.nameOpen);
  const close = useUi((s) => s.closeName);
  const { name, token, setName } = useIdentity();
  const [value, setValue] = useState(name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(useIdentity.getState().name ?? '');
      setError(null);
      setTimeout(() => input.current?.focus(), 60);
    }
  }, [open]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateName(value);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    const res = await claimName(value, token);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setName(res.name);
    close(res.name);
  };

  return (
    <div className="scrim" onClick={() => close(null)}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <BrandMark size={34} />
        <h2 style={{ marginTop: 12 }}>{name ? 'Change your name' : 'What should we call you?'}</h2>
        <p className="lead">Your name shows up to other players and on the leaderboards. No account needed.</p>
        <div className="field">
          <label htmlFor="player-name">Username</label>
          <input
            id="player-name"
            ref={input}
            className="input"
            value={value}
            maxLength={20}
            autoComplete="nickname"
            autoCapitalize="words"
            spellCheck={false}
            enterKeyHint="go"
            placeholder="e.g. Marco Polo"
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
          />
          {error && <div className="error-text">{error}</div>}
        </div>
        <div className="actions" style={{ marginTop: 18 }}>
          <button type="button" className="btn secondary" onClick={() => close(null)}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={busy || value.trim().length < 2}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}
