import type { FastifyInstance } from 'fastify';
import type { StatsService } from '../services/stats.service.js';

const statsSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      // Capped at the raw-click retention (90 days), which unique visitors need.
      days: { type: 'integer', minimum: 1, maximum: 90, default: 30 },
    },
  },
};

export function statsRoutes(app: FastifyInstance, statsService: StatsService): void {
  // Reads only the pre-aggregated daily_stats documents (plus one distinct
  // count over raw clicks), however many clicks the link has had.
  app.get<{ Params: { code: string }; Querystring: { days: number } }>(
    '/api/links/:code/stats',
    { schema: statsSchema },
    async (request) => statsService.getStats(request.params.code, request.query.days, request.user),
  );
}
