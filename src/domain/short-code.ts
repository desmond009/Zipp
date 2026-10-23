import { encodeBase62 } from './base62.js';

/** Every generated code is exactly this many Base62 characters. */
export const GENERATED_CODE_LENGTH = 7;

/** Matches the shape of a generated code (used to keep custom aliases out of this space). */
export const GENERATED_CODE_PATTERN = /^[0-9A-Za-z]{7}$/;

/** Number of distinct generated codes: 62^7 ≈ 3.5 trillion. */
export const CODE_SPACE = 62n ** BigInt(GENERATED_CODE_LENGTH);

/*
 * Scrambling: code = (id * MULTIPLIER + OFFSET) mod CODE_SPACE
 *
 * Because MULTIPLIER shares no factor with CODE_SPACE (62 = 2 * 31, and the
 * multiplier is odd and not divisible by 31), this is a bijection: every id in
 * [0, CODE_SPACE) maps to a different code. Uniqueness comes from the math, so
 * we never need a "does this code exist?" check.
 *
 * MULTIPLIER is ~0.618 (golden ratio) of CODE_SPACE, so consecutive ids land
 * far apart and every character changes: 0 -> LjaL3EZ, 1 -> y3J8vZe.
 * A small multiplier would only change the last few characters.
 *
 * This hides the sequence from casual enumeration (abc0001, abc0002, ...).
 * It is obfuscation, not security: someone with a few known (id, code) pairs
 * can solve for the constants.
 *
 * Never change these constants once links exist, or new ids could map onto
 * codes that are already taken.
 */
const MULTIPLIER = 2_176_477_521_739n;
const OFFSET = 1_234_567_890_123n;

export function idToCode(id: number): string {
  if (!Number.isSafeInteger(id) || id < 0 || BigInt(id) >= CODE_SPACE) {
    throw new RangeError(`Id ${id} is outside the code space`);
  }
  const scrambled = (BigInt(id) * MULTIPLIER + OFFSET) % CODE_SPACE;
  // Pad with '0' (the Base62 zero digit) so every code has the same length.
  return encodeBase62(scrambled).padStart(GENERATED_CODE_LENGTH, '0');
}
