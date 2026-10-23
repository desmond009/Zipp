import { Redis } from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';

export async function connectRedis(url: string, logger: FastifyBaseLogger): Promise<Redis> {
  const redis = new Redis(url, {
    lazyConnect: true,
    // If Redis is down, fail commands immediately instead of queueing them
    // until it comes back. Callers fall back (cache -> MongoDB, rate limiter
    // -> allow), so a Redis outage degrades performance but not availability.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });

  // Without a listener, ioredis prints every reconnect error to stderr.
  redis.on('error', (error) => logger.warn({ err: error }, 'Redis connection error'));

  await redis.connect();
  return redis;
}
