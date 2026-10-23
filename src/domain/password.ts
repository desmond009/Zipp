import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/*
 * Password hashing with scrypt, built into Node (no bcrypt/argon2 dependency).
 *
 * scrypt is deliberately slow and memory-hungry, so an attacker with a
 * leaked database can only test a few guesses per second per core, and GPUs
 * don't help much. Parameters are one of OWASP's recommended scrypt configs
 * (N=2^14, r=8, p=5, ~16 MB per hash).
 *
 * Stored format: scrypt$N$r$p$salt$hash. The parameters travel with each
 * hash, so we can raise them later and old passwords still verify.
 */
const PARAMS = { N: 2 ** 14, r: 8, p: 5 };
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128; // caps the work an attacker can make us do per request

export async function hashPassword(password: string): Promise<string> {
  // A unique random salt per user: identical passwords get different hashes,
  // and precomputed (rainbow) tables are useless.
  const salt = randomBytes(SALT_BYTES);
  const hash = await scryptAsync(password, salt, KEY_LENGTH, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, n, r, p, saltB64, hashB64] = stored.split('$');
  if (algorithm !== 'scrypt' || !saltB64 || !hashB64) {
    return false;
  }
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(actual, expected);
}

/** crypto.scrypt with a promise instead of a callback. */
function scryptAsync(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}
