import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createLogger } from './config/logger.js';
import { connectMongo } from './db/mongo.js';
import { connectRedis } from './db/redis.js';
import { setupDatabase } from './db/setup.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const config = loadConfig();
const logger = createLogger(config);

const mongo = await connectMongo(config.MONGO_URI, config.MONGO_DB);
await setupDatabase(mongo.db);
logger.info('Connected to MongoDB and ensured indexes');
const redis = await connectRedis(config.REDIS_URL, logger, { failFast: true });
logger.info('Connected to Redis');

const app = buildApp({ config, db: mongo.db, redis, logger });
await app.listen({ port: config.PORT, host: config.HOST });

/*
 * Graceful shutdown (e.g. on `docker stop` or a Kubernetes rollout):
 *  1. app.close() stops accepting new connections and waits for in-flight
 *     requests to finish, so no user sees a dropped request.
 *  2. Only then close MongoDB and Redis, which those requests may still be using.
 * If something hangs, a timer force-exits so the orchestrator isn't blocked.
 */
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');

  const forceExit = setTimeout(() => {
    logger.error('Shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    await app.close();
    await Promise.all([mongo.client.close(), redis.quit()]);
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
