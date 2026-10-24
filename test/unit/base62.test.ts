import { describe, expect, it } from 'vitest';
import { decodeBase62, encodeBase62 } from '../../src/domain/base62.js';

describe('base62', () => {
  it('encodes known values', () => {
    expect(encodeBase62(0n)).toBe('0');
    expect(encodeBase62(9n)).toBe('9');
    expect(encodeBase62(10n)).toBe('A');
    expect(encodeBase62(61n)).toBe('z');
    expect(encodeBase62(62n)).toBe('10');
    expect(encodeBase62(62n ** 7n - 1n)).toBe('zzzzzzz');
  });

  it('round-trips encode -> decode', () => {
    for (const value of [0n, 1n, 61n, 62n, 3843n, 123_456_789n, 62n ** 7n - 1n, 2n ** 64n]) {
      expect(decodeBase62(encodeBase62(value))).toBe(value);
    }
  });

  it('ignores leading zero digits when decoding (they pad codes to a fixed length)', () => {
    expect(decodeBase62('0000A')).toBe(10n);
  });

  it('rejects negative numbers and invalid characters', () => {
    expect(() => encodeBase62(-1n)).toThrow(RangeError);
    expect(() => decodeBase62('ab-c')).toThrow(RangeError);
  });
});
