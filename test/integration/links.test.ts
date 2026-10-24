import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLICK_STREAM_KEY } from '../../src/domain/click-event.js';
import { createLink, createTestApp, eventually, shorten, type TestApp } from './helpers.js';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('health', () => {
  it('reports MongoDB and Redis as up', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', checks: { mongo: 'up', redis: 'up' } });
  });
});

describe('shorten + redirect', () => {
  it('creates a link and redirects to it with a 302', async () => {
    const created = await shorten(t.app, { url: 'https://Example.com/some/page?x=1' });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body).toMatchObject({ longUrl: 'https://example.com/some/page?x=1', expiresAt: null });
    expect(body.code).toMatch(/^[0-9A-Za-z]{7}$/);
    expect(body.shortUrl).toBe(`http://short.test/${body.code}`);

    const redirect = await t.app.inject({ method: 'GET', url: `/${body.code}` });
    expect(redirect.statusCode).toBe(302);
    expect(redirect.headers.location).toBe('https://example.com/some/page?x=1');
    // Shared caches/CDNs must not cache the redirect, or clicks would go uncounted.
    expect(redirect.headers['cache-control']).toBe('private, max-age=0');
  });

  it('supports custom aliases and rejects a taken one with 409', async () => {
    expect((await shorten(t.app, { url: 'https://example.com/', alias: 'my-resume' })).statusCode).toBe(201);
    const duplicate = await shorten(t.app, { url: 'https://example.com/', alias: 'my-resume' });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toEqual({ error: { code: 'CONFLICT', message: 'Alias "my-resume" is already taken' } });
  });

  it('returns 404 with the standard error shape for unknown codes', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/unknown1' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  it('returns 410 for an expired link that MongoDB has not deleted yet', async () => {
    // Inserted directly: the API refuses to create links that are already expired.
    await t.db.collection('links').insertOne({
      code: 'old-link',
      longUrl: 'https://example.com/',
      isCustom: true,
      createdAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() - 1000),
      manageTokenHash: 'x',
    });
    const response = await t.app.inject({ method: 'GET', url: '/old-link' });
    expect(response.statusCode).toBe(410);
    expect(response.json().error.code).toBe('LINK_EXPIRED');
  });

  it('has a TTL index so MongoDB deletes expired links by itself', async () => {
    const indexes = await t.db.collection('links').indexes();
    expect(indexes.find((index) => index.name === 'expiresAt_ttl')).toMatchObject({ expireAfterSeconds: 0 });
  });
});

describe('validation', () => {
  it.each([
    ['missing url', {}],
    ['javascript: url', { url: 'javascript:alert(1)' }],
    ['embedded credentials', { url: 'https://user:pass@example.com/' }],
    ['alias shaped like a generated code', { url: 'https://example.com/', alias: 'abc1234' }],
    ['expiry in the past', { url: 'https://example.com/', expiresAt: '2020-01-01T00:00:00Z' }],
    ['expiry that is not a date', { url: 'https://example.com/', expiresAt: 'tomorrow' }],
  ])('rejects %s with 400', async (_name, body) => {
    const response = await shorten(t.app, body);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed JSON with 400', async () => {
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/shorten',
      headers: { 'content-type': 'application/json' },
      payload: '{bad',
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('cache', () => {
  it('writes new links through to Redis, with a TTL', async () => {
    const { code } = await createLink(t.app, { url: 'https://example.com/cached' });
    expect(JSON.parse((await t.redis.get(`link:${code}`))!)).toEqual({
      status: 'found',
      longUrl: 'https://example.com/cached',
      expiresAt: null,
    });
    const ttl = await t.redis.ttl(`link:${code}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(t.config.CACHE_TTL_SECONDS);
  });

  it('never caches a link past its own expiry', async () => {
    const expiresAt = new Date(Date.now() + 30_000).toISOString();
    const { code } = await createLink(t.app, { url: 'https://example.com/', expiresAt });
    expect(await t.redis.ttl(`link:${code}`)).toBeLessThanOrEqual(30);
  });

  it('serves repeat redirects from Redis (hits show in /metrics)', async () => {
    const { code } = await createLink(t.app, { url: 'https://example.com/hot' });
    const before = (await t.app.inject({ method: 'GET', url: '/metrics' })).json().cache.hits;

    for (let i = 0; i < 5; i++) {
      await t.app.inject({ method: 'GET', url: `/${code}` });
    }

    const after = (await t.app.inject({ method: 'GET', url: '/metrics' })).json().cache.hits;
    expect(after - before).toBe(5);
  });

  it('caches unknown codes as "notFound" for a short time', async () => {
    await t.app.inject({ method: 'GET', url: '/missing1' });
    expect(await t.redis.get('link:missing1')).toBe('{"status":"notFound"}');
    expect(await t.redis.ttl('link:missing1')).toBeLessThanOrEqual(t.config.NEGATIVE_CACHE_TTL_SECONDS);
  });

  it('replaces a cached "notFound" when that alias is created', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/later-alias' })).statusCode).toBe(404);
    await shorten(t.app, { url: 'https://example.com/later', alias: 'later-alias' });
    expect((await t.app.inject({ method: 'GET', url: '/later-alias' })).statusCode).toBe(302);
  });

  it('keeps working on MongoDB alone when caching is disabled', async () => {
    const uncached = await createTestApp({ CACHE_ENABLED: 'false' });
    try {
      const { code } = await createLink(uncached.app, { url: 'https://example.com/nocache' });
      expect((await uncached.app.inject({ method: 'GET', url: `/${code}` })).statusCode).toBe(302);
      expect(await uncached.redis.exists(`link:${code}`)).toBe(0);
    } finally {
      await uncached.close();
    }
  });
});

describe('delete', () => {
  it('requires credentials, rejects a wrong token, and invalidates the cache', async () => {
    const { code, manageToken } = await createLink(t.app, { url: 'https://example.com/temp' });
    const remove = (authorization?: string) =>
      t.app.inject({ method: 'DELETE', url: `/api/links/${code}`, headers: authorization ? { authorization } : {} });

    expect((await remove()).statusCode).toBe(401);
    expect((await remove('Bearer wrong-token')).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: `/${code}` })).statusCode).toBe(302); // now cached as found

    expect((await remove(`Bearer ${manageToken}`)).statusCode).toBe(204);
    expect((await t.app.inject({ method: 'GET', url: `/${code}` })).statusCode).toBe(404);
    expect(await t.redis.get(`link:${code}`)).toBe('{"status":"notFound"}');
  });
});

describe('click events', () => {
  it('puts one event per redirect on the Redis stream, and none for failed lookups', async () => {
    const { code } = await createLink(t.app, { url: 'https://example.com/tracked' });
    const before = await t.redis.xlen(CLICK_STREAM_KEY);

    await t.app.inject({
      method: 'GET',
      url: `/${code}`,
      headers: { 'user-agent': 'test-agent', referer: 'https://ref.example/' },
    });
    await t.app.inject({ method: 'GET', url: '/nothere1' });

    // The redirect doesn't wait for XADD, so poll instead of assuming it already landed.
    await eventually(async () => expect(await t.redis.xlen(CLICK_STREAM_KEY)).toBe(before + 1));
    const [latest] = (await t.redis.xrevrange(CLICK_STREAM_KEY, '+', '-', 'COUNT', 1)) as [string, string[]][];
    const [, fields] = latest!;
    expect(fields).toEqual(expect.arrayContaining(['code', code, 'ua', 'test-agent', 'ref', 'https://ref.example/']));
  });
});
