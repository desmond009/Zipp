import type { FastifyInstance } from 'fastify';
import type { ClickProducer } from '../services/click-producer.js';
import type { LinkService } from '../services/link.service.js';

export function redirectRoutes(app: FastifyInstance, linkService: LinkService, clickProducer: ClickProducer): void {
  // The hot path: one cache lookup (MongoDB only on a miss), no database writes.
  app.get<{ Params: { code: string } }>('/:code', async (request, reply) => {
    const longUrl = await linkService.resolve(request.params.code);

    // Fire-and-forget: no `await`, so the user gets their redirect without
    // waiting on Redis. publish() catches its own errors, so this can't crash.
    void clickProducer.publish({
      code: request.params.code,
      timestamp: Date.now(),
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      referrer: request.headers.referer ?? '',
    });

    // 302 (temporary), not 301 (permanent): browsers cache 301s and skip us on
    // later visits, so we'd lose those clicks and couldn't change or expire the
    // link. "private, max-age=0" also stops shared caches/CDNs from caching it.
    return reply.header('Cache-Control', 'private, max-age=0').redirect(longUrl, 302);
  });
}
