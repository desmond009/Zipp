/**
 * Base62 uses [0-9A-Za-z]: URL-safe without escaping, and 62^7 ≈ 3.5 trillion
 * values fit in 7 characters. BigInt keeps the math exact for large numbers.
 */
export const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = BigInt(BASE62_ALPHABET.length);

export function encodeBase62(value: bigint): string {
  if (value < 0n) {
    throw new RangeError('Cannot encode a negative number');
  }
  if (value === 0n) {
    return BASE62_ALPHABET[0]!;
  }

  let result = '';
  let remaining = value;
  while (remaining > 0n) {
    result = BASE62_ALPHABET[Number(remaining % BASE)] + result;
    remaining /= BASE;
  }
  return result;
}

export function decodeBase62(text: string): bigint {
  let value = 0n;
  for (const char of text) {
    const digit = BASE62_ALPHABET.indexOf(char);
    if (digit === -1) {
      throw new RangeError(`Invalid Base62 character: "${char}"`);
    }
    value = value * BASE + BigInt(digit);
  }
  return value;
}
