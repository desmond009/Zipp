import { describe, expect, it } from 'vitest';
import { validateAlias } from '../../src/domain/alias.js';
import { CODE_SPACE, GENERATED_CODE_PATTERN, idToCode } from '../../src/domain/short-code.js';

describe('idToCode', () => {
  it('always produces exactly 7 Base62 characters', () => {
    for (const id of [0, 1, 61, 62, 1000, 999_999, Number(CODE_SPACE) - 1]) {
      expect(idToCode(id)).toMatch(GENERATED_CODE_PATTERN);
    }
  });

  it('is deterministic', () => {
    expect(idToCode(42)).toBe(idToCode(42));
  });

  it('maps different ids to different codes in a sample', () => {
    const count = 200_000;
    const codes = new Set<string>();
    for (let id = 0; id < count; id++) {
      codes.add(idToCode(id));
    }
    expect(codes.size).toBe(count);
  });

  it('stays collision-free across the whole code space (multiplier is coprime with 62^7)', () => {
    // A sample can't catch a bad multiplier: if it shared the factor 2 with
    // 62^7, codes would only start repeating after 62^7 / 2 ≈ 1.8 trillion ids.
    // But that collision has a known shape: id 0 and id 62^7/p get the same
    // code exactly when the multiplier is divisible by p. 62 = 2 * 31.
    for (const primeFactor of [2n, 31n]) {
      expect(idToCode(Number(CODE_SPACE / primeFactor))).not.toBe(idToCode(0));
    }
  });

  it('does not look sequential: consecutive ids differ in most characters', () => {
    const a = idToCode(1000);
    const b = idToCode(1001);
    const samePositions = [...a].filter((char, i) => char === b[i]).length;
    expect(samePositions).toBeLessThanOrEqual(2);
  });

  it('rejects ids outside the code space', () => {
    expect(() => idToCode(-1)).toThrow(RangeError);
    expect(() => idToCode(1.5)).toThrow(RangeError);
    expect(() => idToCode(Number(CODE_SPACE))).toThrow(RangeError);
  });

  it('never produces a code that would be accepted as a custom alias', () => {
    for (let id = 0; id < 10_000; id++) {
      expect(validateAlias(idToCode(id))).not.toBeNull();
    }
  });
});
