import type { FastifyInstance } from 'fastify';
import type { LinkService } from '../services/link.service.js';

export function redirectRoutes(app: FastifyInstance, linkService: LinkService): void {
  // The hot path: keep it to one lookup and no writes.
  app.get<{ Params: { code: string } }>('/:code', async (request, reply) => {
    const longUrl = await linkService.resolve(request.params.code);

    // 302 (temporary), not 301 (permanent): browsers cache 301s and skip us on
    // later visits, so we'd lose those clicks and couldn't change or expire the
    // link. "private, max-age=0" also stops shared caches/CDNs from caching it.
    return reply.header('Cache-Control', 'private, max-age=0').redirect(longUrl, 302);
  });
}
