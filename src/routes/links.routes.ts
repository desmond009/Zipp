import type { FastifyInstance } from 'fastify';
import { UnauthorizedError } from '../errors.js';
import { requireUser } from '../plugins/auth.js';
import type { LinkSort } from '../repositories/link.repository.js';
import type { LinkService } from '../services/link.service.js';

const PAGE_SIZE = 20;

const myLinksSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      sort: { type: 'string', enum: ['newest', 'clicks', 'az'], default: 'newest' },
      q: { type: 'string', maxLength: 100 },
      page: { type: 'integer', minimum: 1, default: 1 },
    },
  },
};

export function linksRoutes(app: FastifyInstance, linkService: LinkService): void {
  // The logged-in user's links, for the "ls" page.
  app.get<{ Querystring: { sort: LinkSort; q?: string; page: number } }>(
    '/api/me/links',
    { schema: myLinksSchema },
    async (request) => {
      const user = requireUser(request);
      return linkService.listForOwner(user, {
        sort: request.query.sort,
        search: request.query.q?.trim() || undefined,
        page: request.query.page,
        pageSize: PAGE_SIZE,
      });
    },
  );

  // Allowed for the owner (session cookie) or anyone holding the manage token
  // returned at creation ("Authorization: Bearer <token>"), which is how guests delete.
  app.delete<{ Params: { code: string } }>('/api/links/:code', async (request, reply) => {
    const manageToken = parseBearerToken(request.headers.authorization);
    if (!manageToken && !request.user) {
      throw new UnauthorizedError('Log in, or send "Authorization: Bearer <manageToken>"');
    }
    await linkService.deleteLink(request.params.code, { user: request.user, manageToken });
    return reply.status(204).send();
  });
}

function parseBearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer (\S+)$/);
  return match?.[1] ?? null;
}
