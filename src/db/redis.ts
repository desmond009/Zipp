import { Redis } from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';

export interface RedisConnectionOptions {
  /**
   * API (true): if Redis is down, fail commands immediately instead of
   * queueing them until it comes back. Callers fall back (cache -> MongoDB,
   * rate limiter -> allow), so an outage degrades performance, not availability.
   *
   * Worker (false): nobody is waiting on it, so it's better to queue commands
   * and retry until Redis returns than to fail.
   */
  failFast: boolean;
}

export async function connectRedis(
  url: string,
  logger: FastifyBaseLogger,
  { failFast }: RedisConnectionOptions,
): Promise<Redis> {
  const redis = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: !failFast,
    maxRetriesPerRequest: failFast ? 1 : null, // null = retry forever
  });

  // Without a listener, ioredis prints every reconnect error to stderr.
  redis.on('error', (error) => logger.warn({ err: error }, 'Redis connection error'));

  await redis.connect();
  return redis;
}
