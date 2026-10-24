import { describe, expect, it } from 'vitest';
import { fromStreamFields, toStreamFields, type ClickEvent } from '../../src/domain/click-event.js';
import { ClickEnricher } from '../../src/workers/click-enricher.js';
import { StaticGeoLookup } from '../../src/workers/geo/static.js';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function event(overrides: Partial<ClickEvent> = {}): ClickEvent {
  return {
    code: 'abc1234',
    timestamp: Date.parse('2026-10-23T10:00:00Z'),
    ip: '81.2.69.142',
    userAgent: IPHONE,
    referrer: 'https://www.twitter.com/some/post',
    ...overrides,
  };
}

describe('stream encoding', () => {
  it('round-trips an event through Redis stream fields', () => {
    const original = event();
    expect(fromStreamFields(toStreamFields(original))).toEqual(original);
  });

  it('caps attacker-controlled headers at 512 characters', () => {
    const fields = toStreamFields(event({ userAgent: 'x'.repeat(10_000), referrer: 'y'.repeat(10_000) }));
    const parsed = fromStreamFields(fields)!;
    expect(parsed.userAgent).toHaveLength(512);
    expect(parsed.referrer).toHaveLength(512);
  });

  it('returns null for malformed entries instead of throwing', () => {
    expect(fromStreamFields(['garbage', 'yes'])).toBeNull();
    expect(fromStreamFields(['code', 'abc', 'ts', 'not-a-number'])).toBeNull();
    expect(fromStreamFields([])).toBeNull();
  });
});

describe('ClickEnricher', () => {
  const enricher = new ClickEnricher(new StaticGeoLookup({ '81.2.69.142': 'GB' }), 'test-secret-0123456789');

  it('parses device, browser and OS from the user agent', () => {
    expect(enricher.enrich(event())).toMatchObject({ device: 'mobile', browser: 'Mobile Safari', os: 'iOS' });
    expect(enricher.enrich(event({ userAgent: WINDOWS_CHROME }))).toMatchObject({
      device: 'desktop',
      browser: 'Chrome',
      os: 'Windows',
    });
  });

  it('marks an empty user agent as unknown rather than desktop', () => {
    expect(enricher.enrich(event({ userAgent: '' }))).toMatchObject({
      device: 'unknown',
      browser: 'unknown',
      os: 'unknown',
    });
  });

  it('keeps only the referrer host, without www', () => {
    expect(enricher.enrich(event()).referrer).toBe('twitter.com');
    expect(enricher.enrich(event({ referrer: '' })).referrer).toBe('direct');
    expect(enricher.enrich(event({ referrer: 'not a url' })).referrer).toBe('unknown');
  });

  it('looks up the country, falling back to unknown', () => {
    expect(enricher.enrich(event()).country).toBe('GB');
    expect(enricher.enrich(event({ ip: '10.0.0.1' })).country).toBe('unknown');
  });

  it('stores a keyed hash of the IP, never the IP', () => {
    const click = enricher.enrich(event());
    expect(click.ipHash).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(click)).not.toContain('81.2.69.142');
    // Same IP -> same hash (so unique visitors can be counted)...
    expect(enricher.enrich(event()).ipHash).toBe(click.ipHash);
    // ...but a different secret gives a different hash.
    const other = new ClickEnricher(new StaticGeoLookup(), 'another-secret-0123456789');
    expect(other.enrich(event()).ipHash).not.toBe(click.ipHash);
  });

  it('stores the code as the time-series metaField', () => {
    const click = enricher.enrich(event());
    expect(click.meta).toEqual({ code: 'abc1234' });
    expect(click.ts.toISOString()).toBe('2026-10-23T10:00:00.000Z');
  });
});
