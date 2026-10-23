import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/*
 * Serves the built React app. Only two kinds of URL belong to the frontend:
 *   /           -> index.html (the app routes itself with #/links, #/stats/abc)
 *   /assets/*   -> the hashed JS/CSS bundles Vite produces
 * Everything else stays free for short codes. "assets" is a reserved alias,
 * so no link can ever shadow the bundles.
 */
export function webRoutes(app: FastifyInstance, distDir: string): void {
  const root = resolve(distDir);
  if (!existsSync(resolve(root, 'index.html'))) {
    app.log.warn({ distDir: root }, 'Frontend build not found (run `npm run build:web`); serving the API only');
    return;
  }

  void app.register(fastifyStatic, {
    root: resolve(root, 'assets'),
    prefix: '/assets/',
    // Vite puts a content hash in every bundle name, so a file never changes:
    // browsers can cache it forever.
    immutable: true,
    maxAge: '1y',
  });

  // index.html must not be cached, or users would keep loading old bundles after a deploy.
  app.get('/', (_request, reply) => reply.sendFile('index.html', root, { maxAge: 0, immutable: false }));
}
