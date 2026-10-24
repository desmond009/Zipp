import { useState, type FormEvent } from 'react';
import { api, ApiError, type CreatedLink } from '../api';
import { useAuth } from '../auth';
import { CopyButton } from '../components/CopyButton';
import { Command, Panel } from '../components/Panel';
import { QrCode } from '../components/QrCode';
import { displayUrl, formatDate } from '../format';

const EXPIRY_OPTIONS = [
  { value: 'never', label: 'never', ms: 0 },
  { value: '1h', label: '1 hour', ms: 60 * 60 * 1000 },
  { value: '24h', label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { value: '7d', label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { value: '30d', label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
];

export function ShortenPage() {
  const { user } = useAuth();
  const [url, setUrl] = useState('');
  const [alias, setAlias] = useState('');
  const [expiry, setExpiry] = useState('never');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreatedLink | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const ms = EXPIRY_OPTIONS.find((option) => option.value === expiry)?.ms ?? 0;
      const link = await api.shorten({
        url: url.trim(),
        alias: alias.trim() || undefined,
        expiresAt: ms ? new Date(Date.now() + ms).toISOString() : undefined,
      });
      setResult(link);
      setUrl('');
      setAlias('');
    } catch (err) {
      setResult(null);
      setError(err instanceof ApiError ? err.message : 'Could not reach the server');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <section className="hero">
        <p className="comment">// url shortener + real-time click analytics</p>
        <h1 className="hero-title">zipp</h1>
        <p className="hero-text">
          Shorten links from the browser, the CLI or the API. Every click is logged, parsed and streamed to your
          stats, without slowing the redirect.
        </p>
      </section>

      <section className="terminal">
        <div className="terminal-bar">
          <span>zsh — zipp shorten</span>
          <span>session: {user ? user.email : 'guest'}</span>
        </div>

        <form className="terminal-body" onSubmit={onSubmit}>
          <label className="field-row">
            <span className="prompt">
              <Command>zipp shorten</Command>
            </span>
            <input
              className="input grow"
              type="url"
              required
              placeholder="https://paste-your-long-url.here/…"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              autoFocus
            />
          </label>

          <div className="field-row options">
            <label className="option">
              <span className="flag">--alias</span>
              <input
                className="input grow"
                placeholder="my-resume"
                value={alias}
                onChange={(event) => setAlias(event.target.value)}
                pattern="[A-Za-z0-9_\-]{3,30}"
                title="3-30 letters, digits, - or _"
              />
            </label>
            <label className="option">
              <span className="flag">--expires</span>
              <select className="input grow" value={expiry} onChange={(event) => setExpiry(event.target.value)}>
                {EXPIRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn-primary" type="submit" disabled={submitting}>
              {submitting ? '[ … ]' : '[ enter ↵ ]'}
            </button>
          </div>

          {error && (
            <div className="result">
              <p className="error">✗ error: {error}</p>
            </div>
          )}
          {result && <CreatedResult link={result} isGuest={!user} />}
        </form>
      </section>

      <div className="grid-2">
        <Panel title={<Command>zipp --help</Command>}>
          <dl className="help">
            <dt>shorten</dt>
            <dd>create a short link (alias, expiry)</dd>
            <dt>ls</dt>
            <dd>list your links and click counts</dd>
            <dt>stats</dt>
            <dd>clicks by day, country, device, referrer</dd>
            <dt>tail</dt>
            <dd>stream clicks live as they happen</dd>
            <dt>rm</dt>
            <dd>delete a link and purge its cache</dd>
          </dl>
        </Panel>
        <Panel title={<Command>curl the API</Command>}>
          <pre className="code">
            <span className="muted"># create a link</span>
            {`
curl -X POST ${window.location.origin}/api/shorten \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com","alias":"demo"}'

`}
            <span className="muted"># → 201 Created</span>
            {`
{ "code": "demo", "shortUrl": "…/demo", … }`}
          </pre>
        </Panel>
      </div>

      <Panel title={<Command>cat architecture.txt</Command>}>
        <pre className="code diagram">{`GET /a8Xk2 ──▶ [ api ] ──▶ [ redis cache ] ──hit──▶ 302 redirect
               │                 └──miss──▶ [ mongodb ]
               └──▶ [ redis stream ] ──▶ [ worker ] ──▶ geo · ua parse · aggregate
                                             └──▶ [ pub/sub ] ──▶ live tail (SSE)`}</pre>
      </Panel>
    </>
  );
}

function CreatedResult({ link, isGuest }: { link: CreatedLink; isGuest: boolean }) {
  return (
    <div className="result created">
      <div className="result-text">
        <p className="result-title">
          <span className="accent">✓ created</span> <strong>{displayUrl(link.shortUrl)}</strong>
        </p>
        <p className="muted break">→ {link.longUrl}</p>
        <p className="muted">
          code: <span className="text">{link.code}</span> · cache: <span className="accent">warm</span> · expires:{' '}
          <span className="text">{formatDate(link.expiresAt)}</span>
        </p>
        {isGuest && (
          <p className="muted small break">
            manage token (save it to delete this link later): <code className="text">{link.manageToken}</code>
          </p>
        )}
      </div>
      <QrCode text={link.shortUrl} size={128} />
      <div className="result-actions">
        <CopyButton text={link.shortUrl} className="btn btn-outline" />
        <a className="btn" href={`#/stats/${encodeURIComponent(link.code)}`}>
          open stats →
        </a>
      </div>
    </div>
  );
}
