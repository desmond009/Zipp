import type { Breakdown } from '../api';
import { formatNumber, percent } from '../format';

const TOP = 4;

/**
 * "# countries" style breakdown: the top 4 entries plus an "other" row, each
 * as a share of all clicks. The server returns the top 20; "other" is the
 * total minus the rows we show, so the percentages add up to ~100%.
 */
export function BarList({ title, items, total }: { title: string; items: Breakdown[]; total: number }) {
  const top = items.slice(0, TOP);
  const otherCount = total - top.reduce((sum, item) => sum + item.count, 0);
  const rows = otherCount > 0 ? [...top, { key: 'other', count: otherCount }] : top;

  return (
    <section className="panel">
      <h3 className="panel-title flag"># {title}</h3>
      {rows.length === 0 ? (
        <p className="muted">no clicks yet</p>
      ) : (
        <ul className="bar-list">
          {rows.map((row) => (
            <li key={row.key} className="bar-row" title={`${formatNumber(row.count)} clicks`}>
              <span className="bar-label">{row.key}</span>
              <span className="bar-track">
                {row.count > 0 && <span className="bar-fill" style={{ width: `${percent(row.count, total)}%` }} />}
              </span>
              <span className="bar-value">{percent(row.count, total)}%</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
