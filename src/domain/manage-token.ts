import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * A manage token lets the creator delete their link without user accounts.
 * We only store its SHA-256 hash, so a database leak does not leak tokens.
 *
 * A fast hash is fine here (unlike passwords): the token is 192 random bits,
 * so there is nothing to brute-force. bcrypt/argon2 would only add latency.
 */
export function generateManageToken(): string {
  return randomBytes(24).toString('base64url');
}

export function hashManageToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison so response timing doesn't reveal how much matched. */
export function verifyManageToken(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashManageToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
