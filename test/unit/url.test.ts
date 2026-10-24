import { describe, expect, it } from 'vitest';
import { MAX_URL_LENGTH, normalizeUrl } from '../../src/domain/url.js';
import { ValidationError } from '../../src/errors.js';

const OWN_HOST = 'short.test';

describe('normalizeUrl', () => {
  it.each([
    ['lowercases scheme and host', 'HTTPS://Example.COM/Path', 'https://example.com/Path'],
    ['drops the default https port', 'https://example.com:443/a', 'https://example.com/a'],
    ['drops the default http port', 'http://example.com:80/a', 'http://example.com/a'],
    ['keeps a non-default port', 'https://example.com:8443/a', 'https://example.com:8443/a'],
    ['percent-encodes spaces', 'https://example.com/a b', 'https://example.com/a%20b'],
    ['adds a trailing slash to a bare host', 'https://example.com', 'https://example.com/'],
    ['keeps query and fragment', 'https://example.com/?q=1#top', 'https://example.com/?q=1#top'],
    ['trims surrounding whitespace', '  https://example.com/x  ', 'https://example.com/x'],
  ])('%s', (_name, input, expected) => {
    expect(normalizeUrl(input, OWN_HOST)).toBe(expected);
  });

  it.each(['javascript:alert(1)', 'data:text/html,<h1>x</h1>', 'file:///etc/passwd', 'ftp://example.com/'])(
    'rejects the non-http(s) URL %s',
    (input) => {
      expect(() => normalizeUrl(input, OWN_HOST)).toThrow(/Only http and https/);
    },
  );

  it('rejects text that is not a URL', () => {
    expect(() => normalizeUrl('not a url', OWN_HOST)).toThrow(ValidationError);
  });

  it('rejects URLs with embedded credentials (a phishing trick)', () => {
    expect(() => normalizeUrl('https://google.com@evil.com/', OWN_HOST)).toThrow(/credentials/);
  });

  it('rejects links back to this service (redirect loops)', () => {
    expect(() => normalizeUrl('https://short.test/abc1234', OWN_HOST)).toThrow(/points to this service/);
  });

  it('rejects empty and overly long URLs', () => {
    expect(() => normalizeUrl('   ', OWN_HOST)).toThrow(ValidationError);
    const long = `https://example.com/${'a'.repeat(MAX_URL_LENGTH)}`;
    expect(() => normalizeUrl(long, OWN_HOST)).toThrow(ValidationError);
  });
});
