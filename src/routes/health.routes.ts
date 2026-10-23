import type { FastifyInstance } from 'fastify';
import type { Db } from 'mongodb';

/**
 * Used by Docker/Kubernetes and load balancers. Returns 503 if a dependency
 * is down, so traffic is routed away from this instance.
 */
export function healthRoutes(app: FastifyInstance, db: Db): void {
  app.get('/health', async (request, reply) => {
    const mongo = await db
      .command({ ping: 1 })
      .then(() => 'up' as const)
      .catch((error: unknown) => {
        request.log.warn({ err: error }, 'MongoDB health check failed');
        return 'down' as const;
      });

    const healthy = mongo === 'up';
    return reply.status(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      checks: { mongo },
    });
  });
}
