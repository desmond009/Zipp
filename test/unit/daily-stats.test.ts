import { describe, expect, it } from 'vitest';
import {
  buildDailyIncrements,
  decodeStatsKey,
  encodeStatsKey,
  startOfUtcDay,
  type ClickDimensions,
} from '../../src/domain/daily-stats.js';

function click(overrides: Partial<ClickDimensions> = {}): ClickDimensions {
  return {
    code: 'abc1234',
    ts: new Date('2026-10-23T10:00:00Z'),
    country: 'IN',
    device: 'mobile',
    browser: 'Chrome',
    os: 'Android',
    referrer: 'google.com',
    ...overrides,
  };
}

describe('buildDailyIncrements', () => {
  it('folds a batch into one increment per (code, day)', () => {
    const increments = buildDailyIncrements([
      click(),
      click({ country: 'US', device: 'desktop' }),
      click({ code: 'other12' }),
      click({ ts: new Date('2026-10-24T01:00:00Z') }),
    ]);

    expect(increments).toHaveLength(3);
    const first = increments.find((i) => i.code === 'abc1234' && i.day.toISOString().startsWith('2026-10-23'));
    expect(first?.inc).toMatchObject({
      total: 2,
      'countries.IN': 1,
      'countries.US': 1,
      'devices.mobile': 1,
      'devices.desktop': 1,
      'browsers.Chrome': 2,
    });
  });

  it('buckets by UTC day, not server-local time', () => {
    const [lateNight, earlyMorning] = [
      click({ ts: new Date('2026-10-23T23:59:59.999Z') }),
      click({ ts: new Date('2026-10-24T00:00:00.000Z') }),
    ];
    const increments = buildDailyIncrements([lateNight, earlyMorning]);
    expect(increments.map((i) => i.day.toISOString())).toEqual([
      '2026-10-23T00:00:00.000Z',
      '2026-10-24T00:00:00.000Z',
    ]);
  });

  it('encodes dots in keys so MongoDB does not treat them as nested paths', () => {
    const [increment] = buildDailyIncrements([click({ referrer: 'news.ycombinator.com' })]);
    const keys = Object.keys(increment!.inc);
    expect(keys).toContain(`referrers.${encodeStatsKey('news.ycombinator.com')}`);
    // Exactly one real dot: the one separating the field from the key.
    expect(keys.filter((k) => k.startsWith('referrers.'))[0]!.split('.')).toHaveLength(2);
  });

  it('returns nothing for an empty batch', () => {
    expect(buildDailyIncrements([])).toEqual([]);
  });
});

describe('stats key encoding', () => {
  it.each(['google.com', '$where', 'a.b.c', 'plain', 'Mac OS'])('round-trips %s', (key) => {
    const encoded = encodeStatsKey(key);
    expect(encoded).not.toContain('.');
    expect(encoded.startsWith('$')).toBe(false);
    expect(decodeStatsKey(encoded)).toBe(key);
  });
});

describe('startOfUtcDay', () => {
  it('truncates to UTC midnight', () => {
    expect(startOfUtcDay(new Date('2026-10-23T18:30:00+05:30')).toISOString()).toBe('2026-10-23T00:00:00.000Z');
  });
});
