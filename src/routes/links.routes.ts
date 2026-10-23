import type { FastifyInstance } from 'fastify';
import { UnauthorizedError } from '../errors.js';
import type { LinkService } from '../services/link.service.js';

export function linksRoutes(app: FastifyInstance, linkService: LinkService): void {
  // Requires the manage token returned at creation: "Authorization: Bearer <token>".
  app.delete<{ Params: { code: string } }>('/api/links/:code', async (request, reply) => {
    const token = parseBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedError('Missing "Authorization: Bearer <manageToken>" header');
    }
    await linkService.deleteLink(request.params.code, token);
    return reply.status(204).send();
  });
}

function parseBearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer (\S+)$/);
  return match?.[1] ?? null;
}
