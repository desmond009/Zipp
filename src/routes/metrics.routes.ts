import type { FastifyInstance } from 'fastify';
import type { LinkCache } from '../services/link-cache.js';

/**
 * Per-instance counters, used by the load tests to report the cache hit rate.
 * Kept in memory so measuring adds no extra Redis call to the redirect path.
 * In production you'd expose these in Prometheus format and aggregate across
 * instances there.
 */
export function metricsRoutes(app: FastifyInstance, cache: LinkCache): void {
  app.get('/metrics', async () => ({ cache: cache.stats() }));
}
