import { pino, type Logger } from 'pino';
import type { Config } from './env.js';

/**
 * Structured JSON logs in production (easy to ship to Loki/ELK/CloudWatch),
 * human-readable output in development.
 */
export function createLogger(config: Config): Logger {
  return pino({
    level: config.LOG_LEVEL,
    transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
  });
}
