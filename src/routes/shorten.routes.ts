import type { FastifyInstance } from 'fastify';
import type { Config } from '../config/env.js';
import { MAX_URL_LENGTH } from '../domain/url.js';
import { rateLimitHook } from '../plugins/rate-limit.js';
import type { CreateLinkInput, LinkService } from '../services/link.service.js';
import type { RateLimiter } from '../services/rate-limiter.js';

/*
 * Fastify compiles these JSON schemas once at startup. The body schema
 * rejects malformed input before the handler runs; the response schema makes
 * serialization faster and guarantees we never return extra fields.
 */
const shortenSchema = {
  body: {
    type: 'object',
    required: ['url'],
    additionalProperties: false,
    properties: {
      url: { type: 'string', minLength: 1, maxLength: MAX_URL_LENGTH },
      alias: { type: 'string', minLength: 3, maxLength: 30 },
      expiresAt: { type: 'string', format: 'date-time' },
    },
  },
  response: {
    201: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        shortUrl: { type: 'string' },
        longUrl: { type: 'string' },
        expiresAt: { type: ['string', 'null'] },
        manageToken: { type: 'string' },
      },
    },
  },
};

export function shortenRoutes(
  app: FastifyInstance,
  linkService: LinkService,
  rateLimiter: RateLimiter,
  config: Config,
): void {
  const windowSeconds = config.SHORTEN_RATE_LIMIT_WINDOW_SECONDS;
  const limitShorten = rateLimitHook(rateLimiter, (request) => [
    { key: `rl:shorten:ip:${request.ip}`, max: config.SHORTEN_RATE_LIMIT_PER_IP, windowSeconds },
    { key: 'rl:shorten:global', max: config.SHORTEN_RATE_LIMIT_GLOBAL, windowSeconds },
  ]);

  app.post<{ Body: CreateLinkInput }>(
    '/api/shorten',
    { schema: shortenSchema, onRequest: limitShorten },
    async (request, reply) => {
      // Logged in: the link is owned and appears under "my links". Guest: no owner.
      const link = await linkService.createLink(request.body, request.user);
      return reply.status(201).send({
        ...link,
        expiresAt: link.expiresAt?.toISOString() ?? null,
      });
    },
  );
}
