/**
 * The message the API puts on the Redis stream for every redirect, and the
 * worker reads back. Kept raw on purpose: parsing the user agent and looking
 * up the country happen in the worker, off the redirect path.
 */
export interface ClickEvent {
  code: string;
  /** Unix epoch milliseconds. */
  timestamp: number;
  ip: string;
  userAgent: string;
  referrer: string;
}

export const CLICK_STREAM_KEY = 'clicks:stream';
export const CLICK_CONSUMER_GROUP = 'analytics';
/** Messages the worker could not parse are moved here instead of being retried forever. */
export const CLICK_DEAD_LETTER_KEY = 'clicks:dead';

// Headers are attacker-controlled: cap their size so one request can't put megabytes into Redis.
const MAX_HEADER_LENGTH = 512;

/** Flattens an event into the [field, value, field, value, ...] list XADD expects. */
export function toStreamFields(event: ClickEvent): string[] {
  return [
    'code', event.code,
    'ts', String(event.timestamp),
    'ip', event.ip,
    'ua', event.userAgent.slice(0, MAX_HEADER_LENGTH),
    'ref', event.referrer.slice(0, MAX_HEADER_LENGTH),
  ];
}

/** Parses a stream entry back into an event, or returns null if it's malformed. */
export function fromStreamFields(fields: string[]): ClickEvent | null {
  const map = new Map<string, string>();
  for (let i = 0; i + 1 < fields.length; i += 2) {
    map.set(fields[i]!, fields[i + 1]!);
  }

  const code = map.get('code');
  const timestamp = Number(map.get('ts'));
  if (!code || !Number.isFinite(timestamp)) {
    return null;
  }
  return {
    code,
    timestamp,
    ip: map.get('ip') ?? '',
    userAgent: map.get('ua') ?? '',
    referrer: map.get('ref') ?? '',
  };
}

/** What the live tail shows per click: the enriched fields, never the IP hash. */
export interface LiveClick {
  ts: string;
  country: string;
  device: string;
  browser: string;
  os: string;
  referrer: string;
}

export function toLiveClick(click: { ts: Date } & Omit<LiveClick, 'ts'>): LiveClick {
  return {
    ts: click.ts.toISOString(),
    country: click.country,
    device: click.device,
    browser: click.browser,
    os: click.os,
    referrer: click.referrer,
  };
}

/** Redis Pub/Sub channel the worker publishes each processed click to. One per link. */
export function liveClickChannel(code: string): string {
  return `clicks:live:${code}`;
}
