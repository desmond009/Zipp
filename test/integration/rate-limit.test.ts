import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, shorten, type TestApp } from './helpers.js';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp({
    TRUST_PROXY: 'true', // lets each test pretend to be a different client via X-Forwarded-For
    SHORTEN_RATE_LIMIT_PER_IP: '3',
    SHORTEN_RATE_LIMIT_GLOBAL: '5',
    AUTH_RATE_LIMIT_PER_IP: '2',
  });
});
afterAll(async () => {
  await t.close();
});

const from = (ip: string) => ({ 'x-forwarded-for': ip });

describe('shorten rate limits', () => {
  it('enforces the per-IP limit, then the global one, without charging rejected requests', async () => {
    const statuses = async (ip: string, count: number) => {
      const result = [];
      for (let i = 0; i < count; i++) {
        result.push((await shorten(t.app, { url: 'https://example.com/' }, from(ip))).statusCode);
      }
      return result;
    };

    // Client A: 3 allowed, then blocked by its own per-IP limit.
    expect(await statuses('1.1.1.1', 4)).toEqual([201, 201, 201, 429]);
    // Client B: only 2 left before the global limit of 5 is reached.
    expect(await statuses('2.2.2.2', 3)).toEqual([201, 201, 429]);
    // B's rejected request was not recorded against B's own window.
    expect(await t.redis.zcard('rl:shorten:ip:2.2.2.2')).toBe(2);
  });

  it('tells the client when to retry', async () => {
    const response = await shorten(t.app, { url: 'https://example.com/' }, from('1.1.1.1'));
    expect(response.statusCode).toBe(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(response.json().error.code).toBe('RATE_LIMITED');
  });

  it('counts a request before parsing it, so junk bodies are limited too', async () => {
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/shorten',
      headers: { 'content-type': 'application/json', ...from('1.1.1.1') },
      payload: '{not json',
    });
    expect(response.statusCode).toBe(429); // not 400: the limiter ran first
  });
});

describe('login rate limit', () => {
  it('slows down password guessing per IP', async () => {
    const attempt = () =>
      t.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: from('9.9.9.9'),
        payload: { email: 'victim@example.com', password: 'guess-guess' },
      });
    expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(429);
  });
});
