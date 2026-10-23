import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { Db } from 'mongodb';

type Status = 'up' | 'down';

/**
 * Used by Docker/Kubernetes and load balancers. Returns 503 if a dependency
 * is down, so traffic is routed away from this instance.
 */
export function healthRoutes(app: FastifyInstance, db: Db, redis: Redis): void {
  app.get('/health', async (request, reply) => {
    // Check both in parallel; a slow MongoDB shouldn't delay the Redis check.
    const [mongo, redisStatus] = await Promise.all([
      probe(() => db.command({ ping: 1 })),
      probe(() => redis.ping()),
    ]);

    if (mongo === 'down' || redisStatus === 'down') {
      request.log.warn({ mongo, redis: redisStatus }, 'Health check failed');
    }

    const healthy = mongo === 'up' && redisStatus === 'up';
    return reply.status(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      checks: { mongo, redis: redisStatus },
    });
  });
}

async function probe(check: () => Promise<unknown>): Promise<Status> {
  try {
    await check();
    return 'up';
  } catch {
    return 'down';
  }
}
