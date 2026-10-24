import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLink, createTestApp, sessionCookie, type TestApp } from './helpers.js';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

async function register(email: string, password = 'correct horse') {
  const response = await t.app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password } });
  expect(response.statusCode).toBe(201);
  return sessionCookie(response);
}

const as = (cookie: string) => ({ cookie });

describe('register / login / logout', () => {
  it('registers, sets a hardened session cookie, and knows who you are', async () => {
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'Ana@Example.com', password: 'correct horse' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().user.email).toBe('ana@example.com'); // normalized

    const setCookie = String(response.headers['set-cookie']);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).not.toMatch(/Secure/); // BASE_URL is http in tests

    const me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: as(sessionCookie(response)) });
    expect(me.json()).toEqual({ user: { id: expect.any(String), email: 'ana@example.com' } });
  });

  it('rejects a second account with the same email, in any case', async () => {
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'ANA@example.com', password: 'other password' },
    });
    expect(response.statusCode).toBe(409);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const login = (email: string, password: string) =>
      t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });

    const wrongPassword = await login('ana@example.com', 'wrong password');
    const unknownEmail = await login('ghost@example.com', 'wrong password');
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownEmail.json());

    expect((await login('ana@example.com', 'correct horse')).statusCode).toBe(200);
  });

  it('validates email and password length', async () => {
    const attempt = (payload: object) => t.app.inject({ method: 'POST', url: '/api/auth/register', payload });
    expect((await attempt({ email: 'not-an-email', password: 'long enough' })).statusCode).toBe(400);
    expect((await attempt({ email: 'x@example.com', password: 'short' })).statusCode).toBe(400);
  });

  it('logout revokes the session on the server, not just in the browser', async () => {
    const cookie = await register('logout@example.com');
    expect((await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: as(cookie) })).statusCode).toBe(200);

    await t.app.inject({ method: 'POST', url: '/api/auth/logout', headers: as(cookie) });

    // Replaying the old cookie (e.g. one an attacker copied) no longer works.
    expect((await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: as(cookie) })).statusCode).toBe(401);
  });

  it('stores only a hash of the session ID in Redis', async () => {
    const cookie = await register('hashed@example.com');
    const sessionId = cookie.split('=')[1]!;
    const keys = await t.redis.keys('session:*');
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((key) => key.includes(sessionId))).toBe(false);
  });
});

describe('link ownership', () => {
  let owner: string;
  let stranger: string;

  beforeAll(async () => {
    owner = await register('owner@example.com');
    stranger = await register('stranger@example.com');
  });

  it('keeps stats of owned links private, and guest links public', async () => {
    const owned = await createLink(t.app, { url: 'https://example.com/private' }, as(owner));
    const guest = await createLink(t.app, { url: 'https://example.com/public' });
    const stats = (code: string, headers = {}) =>
      t.app.inject({ method: 'GET', url: `/api/links/${code}/stats`, headers });

    expect((await stats(owned.code, as(owner))).statusCode).toBe(200);
    expect((await stats(owned.code, as(stranger))).statusCode).toBe(403);
    expect((await stats(owned.code)).statusCode).toBe(403);
    expect((await stats(guest.code)).statusCode).toBe(200);
    expect((await stats(guest.code, as(stranger))).statusCode).toBe(200);
  });

  it('lets only the owner delete with their session', async () => {
    const { code } = await createLink(t.app, { url: 'https://example.com/mine' }, as(owner));
    const remove = (cookie: string) => t.app.inject({ method: 'DELETE', url: `/api/links/${code}`, headers: as(cookie) });

    expect((await remove(stranger)).statusCode).toBe(403);
    expect((await remove(owner)).statusCode).toBe(204);
  });
});

describe('GET /api/me/links', () => {
  let cookie: string;

  beforeAll(async () => {
    cookie = await register('lister@example.com');
    for (const alias of ['bravo-link', 'alpha-link', 'charlie-link']) {
      await createLink(t.app, { url: `https://example.com/${alias}`, alias }, as(cookie));
    }
    // Clicks are counted by the worker; set them directly to test sorting.
    await t.db.collection('links').updateOne({ code: 'bravo-link' }, { $set: { clickCount: 7 } });
  });

  const list = (query = '') => t.app.inject({ method: 'GET', url: `/api/me/links${query}`, headers: as(cookie) });
  const codes = async (query: string) => (await list(query)).json().links.map((link: { code: string }) => link.code);

  it('requires login', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/me/links' })).statusCode).toBe(401);
  });

  it('lists only your own links, with totals', async () => {
    const body = (await list()).json();
    expect(body).toMatchObject({ total: 3, linkCount: 3, totalClicks: 7, page: 1 });
    expect(body.links[0]).toMatchObject({ shortUrl: expect.stringContaining('http://short.test/'), status: 'active' });
    expect(body.links[0]).not.toHaveProperty('manageTokenHash');
    expect(body.links[0]).not.toHaveProperty('ownerId');
  });

  it('sorts by newest, clicks, or code', async () => {
    expect(await codes('?sort=newest')).toEqual(['charlie-link', 'alpha-link', 'bravo-link']);
    expect((await codes('?sort=clicks'))[0]).toBe('bravo-link');
    expect(await codes('?sort=az')).toEqual(['alpha-link', 'bravo-link', 'charlie-link']);
  });

  it('searches code and destination, treating the query as literal text', async () => {
    expect(await codes('?q=ALPHA')).toEqual(['alpha-link']);
    expect(await codes('?q=example.com%2Fcharlie')).toEqual(['charlie-link']);
    expect(await codes('?q=.*')).toEqual([]); // not a regex
  });

  it('rejects unknown sort values', async () => {
    expect((await list('?sort=random')).statusCode).toBe(400);
  });
});
