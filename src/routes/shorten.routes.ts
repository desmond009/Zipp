import type { FastifyInstance } from 'fastify';
import { MAX_URL_LENGTH } from '../domain/url.js';
import type { CreateLinkInput, LinkService } from '../services/link.service.js';

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

export function shortenRoutes(app: FastifyInstance, linkService: LinkService): void {
  app.post<{ Body: CreateLinkInput }>('/api/shorten', { schema: shortenSchema }, async (request, reply) => {
    const link = await linkService.createLink(request.body);
    return reply.status(201).send({
      ...link,
      expiresAt: link.expiresAt?.toISOString() ?? null,
    });
  });
}
