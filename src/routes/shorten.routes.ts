import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config/env.js';
import { MAX_URL_LENGTH } from '../domain/url.js';
import { TooManyRequestsError } from '../errors.js';
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

  // onRequest runs before body parsing and validation, so even malformed
  // requests count against the limit, and rejecting them costs almost nothing.
  async function enforceRateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const result = await rateLimiter.check([
      { key: `rl:shorten:ip:${request.ip}`, max: config.SHORTEN_RATE_LIMIT_PER_IP, windowSeconds },
      { key: 'rl:shorten:global', max: config.SHORTEN_RATE_LIMIT_GLOBAL, windowSeconds },
    ]);
    if (!result.allowed) {
      reply.header('Retry-After', result.retryAfterSeconds);
      throw new TooManyRequestsError();
    }
    reply.header('X-RateLimit-Remaining', result.remaining);
  }

  app.post<{ Body: CreateLinkInput }>(
    '/api/shorten',
    { schema: shortenSchema, onRequest: enforceRateLimit },
    async (request, reply) => {
      const link = await linkService.createLink(request.body);
      return reply.status(201).send({
        ...link,
        expiresAt: link.expiresAt?.toISOString() ?? null,
      });
    },
  );
}
