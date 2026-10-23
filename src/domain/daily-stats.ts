/** The breakdowns kept per link per day. Each is a map like { "IN": 12, "US": 4 }. */
export const STATS_DIMENSIONS = ['countries', 'devices', 'browsers', 'os', 'referrers'] as const;
export type StatsDimension = (typeof STATS_DIMENSIONS)[number];

/** The fields of a click that feed each dimension. */
export interface ClickDimensions {
  code: string;
  ts: Date;
  country: string;
  device: string;
  browser: string;
  os: string;
  referrer: string;
}

/** Everything one batch adds to one (code, day) stats document. */
export interface DailyIncrement {
  code: string;
  day: Date;
  /** Ready for $inc: { total: 3, "countries.IN": 2, "devices.mobile": 3, ... } */
  inc: Record<string, number>;
}

/**
 * Folds a batch of clicks into one increment per (code, day).
 *
 * 500 clicks on a viral link become a single upsert instead of 500. That's
 * the main reason the worker reads in batches.
 */
export function buildDailyIncrements(clicks: ClickDimensions[]): DailyIncrement[] {
  const byCodeAndDay = new Map<string, DailyIncrement>();

  for (const click of clicks) {
    const day = startOfUtcDay(click.ts);
    const groupKey = `${click.code}|${day.toISOString()}`;

    let increment = byCodeAndDay.get(groupKey);
    if (!increment) {
      increment = { code: click.code, day, inc: {} };
      byCodeAndDay.set(groupKey, increment);
    }

    const values: Record<StatsDimension, string> = {
      countries: click.country,
      devices: click.device,
      browsers: click.browser,
      os: click.os,
      referrers: click.referrer,
    };
    bump(increment.inc, 'total');
    for (const dimension of STATS_DIMENSIONS) {
      bump(increment.inc, `${dimension}.${encodeStatsKey(values[dimension])}`);
    }
  }

  return [...byCodeAndDay.values()];
}

function bump(counters: Record<string, number>, field: string): void {
  counters[field] = (counters[field] ?? 0) + 1;
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/*
 * MongoDB reads "referrers.google.com" as the path referrers -> google -> com,
 * and field names can't start with "$". So we swap those characters for their
 * full-width Unicode lookalikes before writing, and back when reading. Unlike
 * replacing "." with "_", this is reversible.
 */
const DOT = '.';
const FULLWIDTH_DOT = '．';
const DOLLAR = '$';
const FULLWIDTH_DOLLAR = '＄';

export function encodeStatsKey(key: string): string {
  return key.replaceAll(DOT, FULLWIDTH_DOT).replaceAll(DOLLAR, FULLWIDTH_DOLLAR);
}

export function decodeStatsKey(key: string): string {
  return key.replaceAll(FULLWIDTH_DOT, DOT).replaceAll(FULLWIDTH_DOLLAR, DOLLAR);
}
