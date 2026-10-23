import { useState, type FormEvent } from 'react';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { Command, Panel } from '../components/Panel';
import { navigate } from '../router';

export function LoginPage() {
  const { user, login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    return (
      <Panel title={<Command>whoami</Command>}>
        <p>{user.email}</p>
        <a className="btn btn-primary" href="#/links">
          go to [2] links →
        </a>
      </Panel>
    );
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await (mode === 'login' ? login(email, password) : register(email, password));
      navigate('/links');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="narrow">
      <Panel title={<Command>clickpulse {mode}</Command>}>
        <form className="stack" onSubmit={onSubmit}>
          <label className="stack-field">
            <span className="flag">--email</span>
            <input
              className="input"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoFocus
            />
          </label>
          <label className="stack-field">
            <span className="flag">--password</span>
            <input
              className="input"
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {mode === 'register' && <p className="muted small">at least 8 characters</p>}
          {error && <p className="error">✗ error: {error}</p>}
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? '[ … ]' : '[ enter ↵ ]'}
          </button>
        </form>
        <p className="muted small">
          {mode === 'login' ? 'no account? ' : 'have an account? '}
          <button className="link-action accent" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            $ clickpulse {mode === 'login' ? 'register' : 'login'}
          </button>
        </p>
      </Panel>
    </section>
  );
}

/** Shown on pages that need an account. */
export function LoginRequired({ command }: { command: string }) {
  return (
    <Panel title={<Command>{command}</Command>}>
      <p className="error">✗ error: not logged in</p>
      <p className="muted">
        run <a href="#/login">$ clickpulse login</a> to see your links. Guests can still shorten links on [1].
      </p>
    </Panel>
  );
}
