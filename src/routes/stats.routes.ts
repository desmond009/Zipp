import type { FastifyInstance } from 'fastify';
import type { StatsService } from '../services/stats.service.js';

const statsSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      days: { type: 'integer', minimum: 1, maximum: 365, default: 30 },
    },
  },
};

export function statsRoutes(app: FastifyInstance, statsService: StatsService): void {
  // Reads only the pre-aggregated daily_stats documents: at most `days`
  // small documents per request, however many clicks the link has had.
  app.get<{ Params: { code: string }; Querystring: { days: number } }>(
    '/api/links/:code/stats',
    { schema: statsSchema },
    async (request) => statsService.getStats(request.params.code, request.query.days),
  );
}
