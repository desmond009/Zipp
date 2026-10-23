import { createHash, randomBytes } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';

/** The logged-in user, as attached to each request. */
export interface AuthUser {
  id: string;
  email: string;
}

/*
 * Server-side sessions in Redis.
 *
 * The browser only holds a random session ID (in an httpOnly cookie); the
 * data lives in Redis with a TTL. Unlike a JWT, logging out really ends the
 * session: we delete the key and the ID stops working everywhere at once.
 *
 * The Redis key is a SHA-256 of the session ID, so someone who can read
 * Redis (a backup, a debug dump) still can't hijack sessions with what they see.
 */
export class SessionStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async create(user: AuthUser): Promise<string> {
    const sessionId = randomBytes(32).toString('base64url'); // 256 bits: unguessable
    await this.redis.set(sessionKey(sessionId), JSON.stringify(user), 'EX', this.ttlSeconds);
    return sessionId;
  }

  /** Returns the session's user, or null if it doesn't exist or has expired. */
  async get(sessionId: string): Promise<AuthUser | null> {
    try {
      const value = await this.redis.get(sessionKey(sessionId));
      return value ? (JSON.parse(value) as AuthUser) : null;
    } catch (error) {
      // Fail closed: if Redis is down, treat the request as logged out. Public
      // features (shorten, redirect) keep working; account pages ask to log in.
      this.logger.warn({ err: error }, 'Session lookup failed, treating request as logged out');
      return null;
    }
  }

  async destroy(sessionId: string): Promise<void> {
    await this.redis.del(sessionKey(sessionId));
  }
}

function sessionKey(sessionId: string): string {
  return `session:${createHash('sha256').update(sessionId).digest('hex')}`;
}
