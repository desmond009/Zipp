import { useEffect, useState } from 'react';
import { api, type LiveClick } from '../api';
import { formatTime } from '../format';

const MAX_LINES = 50;

type Status = 'connecting' | 'streaming' | 'reconnecting';

/**
 * Subscribes to the server's SSE stream for one link. EventSource reconnects
 * by itself after network errors or a server restart; we only reflect its state.
 */
export function LiveTail({ code }: { code: string }) {
  const [clicks, setClicks] = useState<LiveClick[]>([]);
  const [status, setStatus] = useState<Status>('connecting');

  useEffect(() => {
    setClicks([]);
    const source = new EventSource(api.liveUrl(code));

    source.onopen = () => {
      // The server replays recent history on every (re)connect, so start fresh to avoid duplicates.
      setClicks([]);
      setStatus('streaming');
    };
    source.onerror = () => setStatus('reconnecting');
    source.onmessage = (event: MessageEvent<string>) => {
      const click = JSON.parse(event.data) as LiveClick;
      // Newest first, like the design; cap the list so a busy link can't grow it forever.
      setClicks((current) => [click, ...current].slice(0, MAX_LINES));
    };

    return () => source.close(); // leaving the page closes the stream
  }, [code]);

  return (
    <section className="panel tail">
      <div className="panel-heading">
        <h2 className="panel-title">
          <span className="accent">$</span> clickpulse tail {code}
        </h2>
        <span className={status === 'streaming' ? 'accent small' : 'flag small'}>
          {status === 'streaming' ? '● streaming' : `○ ${status}`}
        </span>
      </div>
      <ol className="tail-lines">
        {clicks.length === 0 && <li className="muted">waiting for clicks… open the short link in another tab</li>}
        {clicks.map((click, index) => (
          <li key={`${click.ts}-${index}`}>
            <span className="muted">[{formatTime(click.ts)}]</span> GET /{code} <span className="accent">302</span>
            {' · '}
            <span className="flag">{click.country}</span> · {click.device} · {click.browser.toLowerCase()}
            <span className="muted"> · ref={click.referrer}</span>
          </li>
        ))}
        <li className="accent">$</li>
      </ol>
    </section>
  );
}
