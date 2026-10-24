import { describe, expect, it } from 'vitest';
import { isPossibleCode, validateAlias } from '../../src/domain/alias.js';

describe('validateAlias', () => {
  it.each(['my-blog', 'abc', 'resume_2026', 'a'.repeat(30), 'abc-123', 'abc_123', 'abcdef', 'abcdefgh'])(
    'accepts %s',
    (alias) => {
      expect(validateAlias(alias)).toBeNull();
    },
  );

  it.each([
    ['too short', 'ab'],
    ['too long', 'a'.repeat(31)],
    ['a space', 'my blog'],
    ['a slash', 'a/b/c'],
    ['a dot', 'my.blog'],
    ['unicode', 'café-link'],
  ])('rejects an alias with %s', (_reason, alias) => {
    expect(validateAlias(alias)).toMatch(/3-30 characters/);
  });

  it('rejects 7 plain alphanumerics, the shape of generated codes', () => {
    expect(validateAlias('abc1234')).toMatch(/reserved for generated links/);
    expect(validateAlias('ABCDEFG')).toMatch(/reserved for generated links/);
  });

  it('accepts 7 characters when they include - or _', () => {
    expect(validateAlias('abc-123')).toBeNull();
    expect(validateAlias('abc_def')).toBeNull();
  });

  it('rejects reserved words, case-insensitively', () => {
    expect(validateAlias('api')).toMatch(/reserved/);
    expect(validateAlias('Health')).toMatch(/reserved/);
    expect(validateAlias('ASSETS')).toMatch(/reserved/);
  });
});

describe('isPossibleCode', () => {
  it('accepts anything that could be a generated code or alias', () => {
    expect(isPossibleCode('aU9YDJ5')).toBe(true);
    expect(isPossibleCode('my-blog')).toBe(true);
  });

  it('rejects paths that can never be a code, so they skip Redis and MongoDB', () => {
    expect(isPossibleCode('favicon.ico')).toBe(false);
    expect(isPossibleCode('ab')).toBe(false);
    expect(isPossibleCode('x'.repeat(31))).toBe(false);
  });
});
