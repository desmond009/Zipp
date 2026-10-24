import { randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { Redis } from 'ioredis';
import type { Db } from 'mongodb';
import { pino } from 'pino';
import { inject } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig, type Config } from '../../src/config/env.js';
import { connectMongo } from '../../src/db/mongo.js';
import { connectRedis } from '../../src/db/redis.js';
import { setupDatabase } from '../../src/db/setup.js';

/*
 * Integration tests need a real Redis. Locally that's docker-compose (port
 * 6380); CI sets TEST_REDIS_URL. Database 15 keeps test data away from the
 * dev data in database 0, and it's flushed before each test file.
 */
const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6380/15';

export const logger = pino({ level: 'silent' });

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  redis: Redis;
  config: Config;
  close: () => Promise<void>;
}

/** The real app, wired exactly like production, on a fresh database. */
export async function createTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    BASE_URL: 'http://short.test',
    MONGO_URI: inject('mongoUri'),
    MONGO_DB: `test_${randomUUID().slice(0, 8)}`,
    REDIS_URL,
    WEB_DIST_DIR: 'does-not-exist', // API only
    // High by default so ordinary tests don't trip it; rate-limit.test.ts sets low limits.
    SHORTEN_RATE_LIMIT_PER_IP: '10000',
    SHORTEN_RATE_LIMIT_GLOBAL: '10000',
    AUTH_RATE_LIMIT_PER_IP: '10000',
    ...env,
  });

  const mongo = await connectMongo(config.MONGO_URI, config.MONGO_DB);
  await setupDatabase(mongo.db);

  let redis: Redis;
  try {
    redis = await connectRedis(config.REDIS_URL, logger, { failFast: true });
  } catch (error) {
    throw new Error(`Integration tests need Redis at ${config.REDIS_URL} (run \`docker compose up -d redis\`)`, {
      cause: error,
    });
  }
  await redis.flushdb();
  const redisSubscriber = await connectRedis(config.REDIS_URL, logger, { failFast: true });

  const app = buildApp({ config, db: mongo.db, redis, redisSubscriber, logger });
  await app.ready();

  return {
    app,
    db: mongo.db,
    redis,
    config,
    close: async () => {
      await app.close();
      await mongo.db.dropDatabase();
      await mongo.client.close();
      await Promise.all([redis.quit(), redisSubscriber.quit()]);
    },
  };
}

export async function shorten(app: FastifyInstance, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return app.inject({ method: 'POST', url: '/api/shorten', payload: body, headers });
}

/** Creates a link and returns the response body; fails loudly unless the API answered 201. */
export async function createLink(
  app: FastifyInstance,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ code: string; shortUrl: string; longUrl: string; expiresAt: string | null; manageToken: string }> {
  const response = await shorten(app, body, headers);
  if (response.statusCode !== 201) {
    throw new Error(`Expected 201 from /api/shorten, got ${response.statusCode}: ${response.body}`);
  }
  return response.json();
}

/** "sid=abc; Max-Age=...; HttpOnly" -> "sid=abc", ready to send back as a Cookie header. */
export function sessionCookie(response: LightMyRequestResponse): string {
  const header = response.headers['set-cookie'];
  const cookie = (Array.isArray(header) ? header[0] : header)?.split(';')[0];
  if (!cookie) throw new Error('Response did not set a session cookie');
  return cookie;
}

/** Polls until `check` stops throwing (for async work like the worker), or fails after `timeoutMs`. */
export async function eventually<T>(check: () => Promise<T>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
