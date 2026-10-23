import { Command, Panel } from '../components/Panel';

const ENDPOINTS = [
  { method: 'POST', path: '/api/shorten', auth: 'optional', description: 'create a link: { url, alias?, expiresAt? }' },
  { method: 'GET', path: '/:code', auth: 'none', description: '302 redirect; 404 unknown, 410 expired' },
  { method: 'GET', path: '/api/links/:code/stats?days=', auth: 'owner*', description: 'aggregated analytics (1-90 days)' },
  { method: 'GET', path: '/api/links/:code/live', auth: 'owner*', description: 'live clicks (Server-Sent Events)' },
  { method: 'DELETE', path: '/api/links/:code', auth: 'owner or token', description: 'delete; Bearer <manageToken> for guests' },
  { method: 'GET', path: '/api/me/links?sort=&q=&page=', auth: 'required', description: 'your links (newest | clicks | az)' },
  { method: 'POST', path: '/api/auth/register', auth: 'none', description: '{ email, password } → session cookie' },
  { method: 'POST', path: '/api/auth/login', auth: 'none', description: '{ email, password } → session cookie' },
  { method: 'POST', path: '/api/auth/logout', auth: 'session', description: 'end the session' },
  { method: 'GET', path: '/health', auth: 'none', description: 'MongoDB + Redis status (503 if degraded)' },
];

export function ApiPage() {
  return (
    <>
      <h1 className="page-title">
        <Command>clickpulse api --help</Command>
      </h1>
      <p className="muted">
        JSON in, JSON out. Errors always look like <code className="text">{'{ "error": { "code", "message" } }'}</code>.
      </p>

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>method</th>
              <th>path</th>
              <th>auth</th>
              <th>description</th>
            </tr>
          </thead>
          <tbody>
            {ENDPOINTS.map((endpoint) => (
              <tr key={`${endpoint.method} ${endpoint.path}`}>
                <td className="flag">{endpoint.method}</td>
                <td className="strong">{endpoint.path}</td>
                <td className="muted">{endpoint.auth}</td>
                <td className="muted">{endpoint.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">* links created while logged in are private to their owner; guest links are public.</p>

      <Panel title={<Command>rate limits</Command>}>
        <p className="muted">
          shorten: 10/min per IP plus a global ceiling · login/register: 10/min per IP · over the limit returns 429
          with a <span className="text">Retry-After</span> header.
        </p>
      </Panel>
    </>
  );
}
