import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type LinkStats } from '../api';
import { useAuth } from '../auth';
import { BarList } from '../components/BarList';
import { CopyButton } from '../components/CopyButton';
import { LiveTail } from '../components/LiveTail';
import { Command, Panel } from '../components/Panel';
import { QrModal } from '../components/QrCode';
import { displayUrl, formatDate, formatNumber, percent } from '../format';
import { navigate } from '../router';

const RANGES = [7, 14, 30];

export function StatsPage({ code }: { code: string | null }) {
  return code ? <LinkStatsView code={code} /> : <PickLink />;
}

/** [3] stats without a code: ask for one. */
function PickLink() {
  const [code, setCode] = useState('');
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (code.trim()) navigate(`/stats/${encodeURIComponent(code.trim())}`);
  };
  return (
    <Panel title={<Command>clickpulse stats &lt;code&gt;</Command>}>
      <form className="field-row" onSubmit={onSubmit}>
        <input
          className="input grow"
          placeholder="a8Xk2 or my-alias"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoFocus
        />
        <button className="btn btn-primary" type="submit">
          [ enter ↵ ]
        </button>
      </form>
      <p className="muted small">or pick one from [2] links</p>
    </Panel>
  );
}

function LinkStatsView({ code }: { code: string }) {
  const { user } = useAuth();
  const [days, setDays] = useState(14);
  const [stats, setStats] = useState<LinkStats | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.stats(code, days).then(
      (result) => !cancelled && (setStats(result), setError(null)),
      (err) => !cancelled && setError(err instanceof ApiError ? err : new ApiError(0, 'NETWORK', 'Could not reach the server')),
    );
    return () => {
      cancelled = true;
    };
  }, [code, days]);

  const back = <a className="accent back" href={user ? '#/links' : '#/'}>cd ..</a>;

  if (error) {
    const message =
      error.status === 403 ? 'permission denied: stats for this link are private'
      : error.status === 404 ? `no such link: ${code}`
      : error.message;
    return (
      <>
        {back}
        <Panel title={<Command>clickpulse stats {code}</Command>}>
          <p className="error">✗ {message}</p>
          {error.status === 403 && !user && (
            <p className="muted">
              is it yours? <a href="#/login">$ login</a>
            </p>
          )}
        </Panel>
      </>
    );
  }
  if (!stats) return <p className="muted">loading…</p>;

  const { link, breakdowns, totalClicks } = stats;
  const maxDaily = Math.max(1, ...stats.daily.map((day) => day.clicks));
  const topCountry = breakdowns.countries[0];
  const topDevice = breakdowns.devices[0];

  return (
    <>
      {back}

      <Panel
        className="stats-heading"
        title={
          <Command>
            clickpulse stats {code} --range=<span className="flag">{days}d</span>
          </Command>
        }
        actions={
          <>
            <CopyButton text={link.shortUrl} label="cp link" />
            <button className="btn" onClick={() => setShowQr(true)}>
              qr
            </button>
            <button className="btn" onClick={() => downloadCsv(stats)}>
              export --csv
            </button>
          </>
        }
      >
        <p className="break">
          <span className={link.status === 'active' ? 'accent' : 'flag'}>[{link.status}]</span>{' '}
          <span className="muted">
            {displayUrl(link.shortUrl)} → {link.longUrl}
          </span>
        </p>
        <p className="muted small">
          created {formatDate(link.createdAt)} · expires {formatDate(link.expiresAt)}
        </p>
      </Panel>

      <div className="tiles">
        <Tile label="total_clicks" value={formatNumber(totalClicks)} note={changeNote(stats, days)} />
        <Tile label="unique_visitors" value={formatNumber(stats.uniqueVisitors)} note="by ip hash" />
        <Tile
          label="top_country"
          value={topCountry?.key ?? '—'}
          note={topCountry ? `${percent(topCountry.count, totalClicks)}% of clicks` : 'no clicks yet'}
        />
        <Tile
          label="top_device"
          value={topDevice?.key ?? '—'}
          note={topDevice ? `${percent(topDevice.count, totalClicks)}% of clicks` : 'no clicks yet'}
        />
      </div>

      <Panel
        title={
          <>
            <span className="accent">clicks/day</span>{' '}
            <span className="muted">· {formatNumber(totalClicks)} total</span>
          </>
        }
        actions={RANGES.map((range) => (
          <button key={range} className={range === days ? 'btn btn-outline' : 'btn'} onClick={() => setDays(range)}>
            --range={range}d
          </button>
        ))}
      >
        <ul className="daily">
          {stats.daily.map((day) => (
            <li key={day.date} className="daily-row">
              <span className="muted">{day.date.slice(5)}</span>
              <span className="daily-track">
                {day.clicks > 0 && <span className="bar-fill" style={{ width: `${(day.clicks / maxDaily) * 100}%` }} />}
              </span>
              <span className="num">{formatNumber(day.clicks)}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="grid-3">
        <BarList title="countries" items={breakdowns.countries} total={totalClicks} />
        <BarList title="devices" items={breakdowns.devices} total={totalClicks} />
        <BarList title="browsers" items={breakdowns.browsers} total={totalClicks} />
        <BarList title="os" items={breakdowns.os} total={totalClicks} />
        <BarList title="referrers" items={breakdowns.referrers} total={totalClicks} />
      </div>

      <LiveTail code={code} />

      {showQr && <QrModal text={link.shortUrl} onClose={() => setShowQr(false)} />}
    </>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="tile">
      <p className="muted small">{label}</p>
      <p className="tile-value">{value}</p>
      <p className="accent small">{note}</p>
    </div>
  );
}

/** "+15.5% vs prev 7d". With no clicks in the previous period there's nothing to compare. */
function changeNote(stats: LinkStats, days: number): string {
  if (stats.previousTotalClicks === 0) {
    return `no clicks in prev ${days}d`;
  }
  const change = ((stats.totalClicks - stats.previousTotalClicks) / stats.previousTotalClicks) * 100;
  return `${change >= 0 ? '+' : ''}${change.toFixed(1)}% vs prev ${days}d`;
}

/** Builds a CSV in the browser and downloads it; no server round-trip needed. */
function downloadCsv(stats: LinkStats): void {
  const lines = ['date,clicks', ...stats.daily.map((day) => `${day.date},${day.clicks}`)];
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `clickpulse-${stats.link.code}-${stats.from}-to-${stats.to}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
