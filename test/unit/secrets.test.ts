import { describe, expect, it } from 'vitest';
import { generateManageToken, hashManageToken, verifyManageToken } from '../../src/domain/manage-token.js';
import { hashPassword, verifyPassword } from '../../src/domain/password.js';

describe('manage tokens', () => {
  it('verifies the token it was created from, and nothing else', () => {
    const token = generateManageToken();
    const hash = hashManageToken(token);
    expect(verifyManageToken(token, hash)).toBe(true);
    expect(verifyManageToken(generateManageToken(), hash)).toBe(false);
    expect(verifyManageToken('', hash)).toBe(false);
  });

  it('never stores the token itself', () => {
    const token = generateManageToken();
    expect(hashManageToken(token)).not.toContain(token);
  });

  it('rejects a malformed stored hash instead of throwing', () => {
    expect(verifyManageToken(generateManageToken(), 'not-hex')).toBe(false);
  });
});

describe('passwords', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', stored)).toBe(true);
    expect(await verifyPassword('correct horsf', stored)).toBe(false);
  });

  it('salts each hash, so equal passwords get different hashes', async () => {
    const [a, b] = await Promise.all([hashPassword('same password'), hashPassword('same password')]);
    expect(a).not.toBe(b);
  });

  it('stores the algorithm and parameters with the hash, never the password', async () => {
    const stored = await hashPassword('correct horse');
    expect(stored).toMatch(/^scrypt\$16384\$8\$5\$/);
    expect(stored).not.toContain('correct horse');
  });

  it('rejects an unknown or malformed stored hash', async () => {
    expect(await verifyPassword('anything', 'bcrypt$whatever')).toBe(false);
    expect(await verifyPassword('anything', '')).toBe(false);
  });
});
