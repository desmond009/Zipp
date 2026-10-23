import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '../errors.js';
import type { AuthUser, SessionStore } from '../services/session-store.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The logged-in user, or null for guests. Only loaded on /api/ routes. */
    user: AuthUser | null;
  }
}

const SESSION_COOKIE = 'sid';

/**
 * Attaches request.user from the session cookie on every /api/ request.
 *
 * Deliberately skipped for everything else: the redirect hot path never
 * needs to know who you are, so it never pays for a session lookup.
 */
export function registerAuth(app: FastifyInstance, sessions: SessionStore): void {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/')) return;
    const sessionId = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (sessionId) {
      request.user = await sessions.get(sessionId);
    }
  });
}

/** For routes that only make sense when logged in. */
export function requireUser(request: FastifyRequest): AuthUser {
  if (!request.user) {
    throw new UnauthorizedError('Please log in');
  }
  return request.user;
}

export function getSessionId(request: FastifyRequest): string | null {
  return readCookie(request.headers.cookie, SESSION_COOKIE);
}

/*
 * Cookie flags, each closing a specific attack:
 * - HttpOnly: JavaScript can't read it, so an XSS bug can't steal the session.
 * - SameSite=Lax: the browser doesn't send it on cross-site POST/DELETE, which
 *   blocks CSRF (another site submitting a form to our API as you).
 * - Secure: only sent over HTTPS (enabled when BASE_URL is https).
 */
export function setSessionCookie(reply: FastifyReply, sessionId: string, maxAgeSeconds: number, secure: boolean): void {
  const flags = [`Max-Age=${maxAgeSeconds}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', ...(secure ? ['Secure'] : [])];
  reply.header('Set-Cookie', `${SESSION_COOKIE}=${sessionId}; ${flags.join('; ')}`);
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.header('Set-Cookie', `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
}

/** Reads one cookie from a "Cookie: a=1; b=2" header. */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      return rest.join('=') || null;
    }
  }
  return null;
}
