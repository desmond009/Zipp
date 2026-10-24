import { useEffect, useState } from 'react';
import { api, ApiError, type LinkSort, type MyLinksPage } from '../api';
import { useAuth } from '../auth';
import { CopyButton } from '../components/CopyButton';
import { Command } from '../components/Panel';
import { displayUrl, formatDate, formatNumber } from '../format';
import { useDebouncedValue, useKeyboardShortcuts } from '../hooks';
import { navigate } from '../router';
import { LoginRequired } from './LoginPage';

const SORTS: { value: LinkSort; label: string }[] = [
  { value: 'newest', label: 'newest' },
  { value: 'clicks', label: 'clicks' },
  { value: 'az', label: 'a-z' },
];

export function LinksPage() {
  const { user } = useAuth();
  if (user === undefined) return <p className="muted">loading…</p>;
  if (!user) return <LoginRequired command="zipp ls" />;
  return <LinksTable />;
}

function LinksTable() {
  const [sort, setSort] = useState<LinkSort>('newest');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MyLinksPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a delete to refetch the current page.
  const [reloadKey, setReloadKey] = useState(0);

  // Wait until typing pauses before querying, instead of one request per keystroke.
  const query = useDebouncedValue(search.trim(), 250);

  useEffect(() => {
    let cancelled = false;
    api.myLinks({ sort, q: query, page }).then(
      (result) => !cancelled && (setData(result), setError(null)),
      (err) => !cancelled && setError(err instanceof ApiError ? err.message : 'Could not load links'),
    );
    // If sort/search/page changes before this request returns, drop its result
    // so a slow old response can't overwrite a newer one.
    return () => {
      cancelled = true;
    };
  }, [sort, query, page, reloadKey]);

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  useKeyboardShortcuts({
    n: () => setPage((current) => Math.min(current + 1, pageCount)),
    p: () => setPage((current) => Math.max(current - 1, 1)),
    q: () => navigate('/'),
  });

  const remove = async (code: string) => {
    if (!window.confirm(`Delete ${code}? Its short URL will stop working immediately.`)) return;
    try {
      await api.deleteLink(code);
      setReloadKey((key) => key + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete link');
    }
  };

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <h1 className="page-title">
            <Command>
              zipp ls --sort=<span className="flag">{SORTS.find((s) => s.value === sort)?.label}</span>
            </Command>
          </h1>
          {data && (
            <p className="muted">
              {formatNumber(data.linkCount)} links · {formatNumber(data.totalClicks)} clicks total
            </p>
          )}
        </div>
        <a className="btn btn-primary" href="#/">
          + new link
        </a>
      </div>

      <div className="toolbar">
        <label className="search">
          <span className="flag">grep</span>
          <input
            className="input-bare grow"
            placeholder="alias or destination…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1); // a new search starts from the first page
            }}
          />
        </label>
        <div className="segmented">
          {SORTS.map((option) => (
            <button
              key={option.value}
              className={sort === option.value ? 'btn btn-outline' : 'btn'}
              onClick={() => {
                setSort(option.value);
                setPage(1);
              }}
            >
              --sort={option.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error">✗ error: {error}</p>}

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>status</th>
              <th>code</th>
              <th>destination</th>
              <th className="num">clicks</th>
              <th>created</th>
              <th>expires</th>
              <th className="actions">actions</th>
            </tr>
          </thead>
          <tbody>
            {data?.links.map((link) => (
              <tr key={link.code}>
                <td className={link.status === 'active' ? 'accent' : 'flag'}>[{link.status}]</td>
                <td className="strong">{displayUrl(link.shortUrl)}</td>
                <td className="muted truncate" title={link.longUrl}>
                  {link.longUrl}
                </td>
                <td className="num">{formatNumber(link.clickCount)}</td>
                <td className="muted">{formatDate(link.createdAt)}</td>
                <td className="muted">{formatDate(link.expiresAt)}</td>
                <td className="actions">
                  <div className="row-actions">
                    <a className="link-action accent" href={`#/stats/${encodeURIComponent(link.code)}`}>
                      stats
                    </a>
                    <CopyButton text={link.shortUrl} label="cp" className="link-action" />
                    <button className="link-action danger" onClick={() => remove(link.code)}>
                      rm
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {data && data.links.length === 0 && (
              <tr>
                <td colSpan={7} className="muted empty">
                  {query ? `no links match "${query}"` : 'no links yet: create one with [1] shorten'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && (
        <p className="muted pager">
          -- {data.links.length} of {formatNumber(data.total)} shown · page {page}/{pageCount} --{' '}
          <button className="link-action" onClick={() => navigate('/')}>
            (q) quit
          </button>{' '}
          <button className="link-action" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
            (n) next
          </button>{' '}
          <button className="link-action" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            (p) prev
          </button>
        </p>
      )}
    </section>
  );
}
