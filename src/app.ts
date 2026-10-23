import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Db } from 'mongodb';
import type { Config } from './config/env.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { CounterRepository } from './repositories/counter.repository.js';
import { LinkRepository } from './repositories/link.repository.js';
import { healthRoutes } from './routes/health.routes.js';
import { linksRoutes } from './routes/links.routes.js';
import { redirectRoutes } from './routes/redirect.routes.js';
import { shortenRoutes } from './routes/shorten.routes.js';
import { IdAllocator } from './services/id-allocator.js';
import { LinkService } from './services/link.service.js';

export interface AppDependencies {
  config: Config;
  db: Db;
  logger: FastifyBaseLogger;
}

/**
 * Builds the Fastify app without starting it. Tests call this and use
 * app.inject() to send requests without opening a real port.
 */
export function buildApp({ config, db, logger }: AppDependencies): FastifyInstance {
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: 16 * 1024, // a URL plus a few fields; anything bigger is abuse
  });

  // Wire dependencies by hand: explicit, and easy to swap for fakes in tests.
  const linkRepository = new LinkRepository(db);
  const idAllocator = new IdAllocator(new CounterRepository(db), config.ID_RANGE_SIZE);
  const linkService = new LinkService(linkRepository, idAllocator, config.BASE_URL);

  registerErrorHandler(app);
  healthRoutes(app, db);
  shortenRoutes(app, linkService);
  linksRoutes(app, linkService);
  // Registered last for readability; Fastify always prefers static paths
  // like /health over the /:code wildcard regardless of order.
  redirectRoutes(app, linkService);

  return app;
}
