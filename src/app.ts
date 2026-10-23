import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { Db } from 'mongodb';
import type { Config } from './config/env.js';
import { registerAuth } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { ClickRepository } from './repositories/click.repository.js';
import { CounterRepository } from './repositories/counter.repository.js';
import { LinkRepository } from './repositories/link.repository.js';
import { StatsRepository } from './repositories/stats.repository.js';
import { UserRepository } from './repositories/user.repository.js';
import { authRoutes } from './routes/auth.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { linksRoutes } from './routes/links.routes.js';
import { liveRoutes } from './routes/live.routes.js';
import { metricsRoutes } from './routes/metrics.routes.js';
import { redirectRoutes } from './routes/redirect.routes.js';
import { shortenRoutes } from './routes/shorten.routes.js';
import { statsRoutes } from './routes/stats.routes.js';
import { webRoutes } from './routes/web.routes.js';
import { AuthService } from './services/auth.service.js';
import { ClickProducer } from './services/click-producer.js';
import { IdAllocator } from './services/id-allocator.js';
import { DisabledLinkCache, RedisLinkCache, type LinkCache } from './services/link-cache.js';
import { LinkService } from './services/link.service.js';
import { LiveClickHub } from './services/live-click-hub.js';
import { RateLimiter } from './services/rate-limiter.js';
import { SessionStore } from './services/session-store.js';
import { StatsService } from './services/stats.service.js';

export interface AppDependencies {
  config: Config;
  db: Db;
  redis: Redis;
  /** A second connection, dedicated to Pub/Sub (a subscribed connection can't run other commands). */
  redisSubscriber: Redis;
  logger: FastifyBaseLogger;
}

/**
 * Builds the Fastify app without starting it. Tests call this and use
 * app.inject() to send requests without opening a real port.
 */
export function buildApp({ config, db, redis, redisSubscriber, logger }: AppDependencies): FastifyInstance {
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: 16 * 1024, // a URL plus a few fields; anything bigger is abuse
    trustProxy: config.TRUST_PROXY,
  });

  // Wire dependencies by hand: explicit, and easy to swap for fakes in tests.
  const cache: LinkCache = config.CACHE_ENABLED
    ? new RedisLinkCache(
        redis,
        { ttlSeconds: config.CACHE_TTL_SECONDS, negativeTtlSeconds: config.NEGATIVE_CACHE_TTL_SECONDS },
        logger,
      )
    : new DisabledLinkCache();
  const linkRepository = new LinkRepository(db);
  const idAllocator = new IdAllocator(new CounterRepository(db), config.ID_RANGE_SIZE);
  const linkService = new LinkService(linkRepository, idAllocator, cache, config.BASE_URL);
  const rateLimiter = new RateLimiter(redis, logger);
  const clickProducer = new ClickProducer(redis, config.CLICK_STREAM_MAX_LENGTH, logger);
  const statsService = new StatsService(linkService, new StatsRepository(db), new ClickRepository(db));
  const sessions = new SessionStore(redis, config.SESSION_TTL_SECONDS, logger);
  const authService = new AuthService(new UserRepository(db));
  const liveHub = new LiveClickHub(redisSubscriber, logger);

  registerErrorHandler(app);
  registerAuth(app, sessions);

  healthRoutes(app, db, redis);
  metricsRoutes(app, cache);
  authRoutes(app, authService, sessions, rateLimiter, config);
  shortenRoutes(app, linkService, rateLimiter, config);
  linksRoutes(app, linkService);
  statsRoutes(app, statsService);
  liveRoutes(app, statsService, liveHub);
  webRoutes(app, config.WEB_DIST_DIR);
  // Registered last for readability; Fastify always prefers static paths
  // like /health over the /:code wildcard regardless of order.
  redirectRoutes(app, linkService, clickProducer);

  return app;
}
