import { loadConfig } from './config/env.js';
import { createLogger } from './config/logger.js';
import { connectMongo } from './db/mongo.js';
import { connectRedis } from './db/redis.js';
import { setupDatabase } from './db/setup.js';
import { ClickRepository } from './repositories/click.repository.js';
import { LinkRepository } from './repositories/link.repository.js';
import { StatsRepository } from './repositories/stats.repository.js';
import { ClickConsumer } from './workers/click-consumer.js';
import { ClickEnricher } from './workers/click-enricher.js';
import type { GeoLookup } from './workers/geo/geo-lookup.js';
import { MaxMindGeoLookup } from './workers/geo/maxmind.js';
import { StaticGeoLookup } from './workers/geo/static.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const config = loadConfig();
const logger = createLogger(config);

const mongo = await connectMongo(config.MONGO_URI, config.MONGO_DB);
// The worker may start before the API, and the clicks time-series collection
// must exist before the first insert (otherwise MongoDB creates a normal one).
await setupDatabase(mongo.db);
const redis = await connectRedis(config.REDIS_URL, logger, { failFast: false });

let geo: GeoLookup;
if (config.GEOIP_DB_PATH) {
  geo = await MaxMindGeoLookup.open(config.GEOIP_DB_PATH);
  logger.info({ path: config.GEOIP_DB_PATH }, 'Loaded GeoLite2 database');
} else {
  geo = new StaticGeoLookup();
  logger.warn('GEOIP_DB_PATH not set; all countries will be recorded as "unknown"');
}

const consumer = new ClickConsumer(
  {
    redis,
    clicks: new ClickRepository(mongo.db),
    stats: new StatsRepository(mongo.db),
    links: new LinkRepository(mongo.db),
    enricher: new ClickEnricher(geo, config.IP_HASH_SECRET),
    logger,
  },
  {
    batchSize: config.WORKER_BATCH_SIZE,
    blockMs: config.WORKER_BLOCK_MS,
    claimIdleMs: config.WORKER_CLAIM_IDLE_MS,
  },
);

const running = consumer.run().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Click consumer crashed');
  process.exit(1);
});

/*
 * Graceful shutdown: let the current batch finish and be acked, then close
 * connections. Anything left unacked (e.g. if we're killed anyway) stays
 * pending in Redis and another worker reclaims it, so no click is lost.
 */
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down worker');

  const forceExit = setTimeout(() => {
    logger.error('Shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    consumer.stop();
    await running;
    await Promise.all([mongo.client.close(), redis.quit()]);
    logger.info('Worker shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
