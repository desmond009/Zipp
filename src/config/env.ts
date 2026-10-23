import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  BASE_URL: z.url().default('http://localhost:3000'),
  MONGO_URI: z.string().min(1),
  MONGO_DB: z.string().min(1).default('url_shortener'),
  ID_RANGE_SIZE: z.coerce.number().int().positive().default(1000),
  // Only enable behind a proxy you control; otherwise clients can spoof X-Forwarded-For
  // and dodge per-IP rate limits. (z.stringbool: z.coerce.boolean() would turn "false" into true.)
  TRUST_PROXY: z.stringbool().default(false),

  REDIS_URL: z.string().min(1),
  // Turn off to measure the uncached baseline in load tests.
  CACHE_ENABLED: z.stringbool().default(true),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  NEGATIVE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),

  // Link creation limits: a strict one per IP, and a global ceiling that protects the database.
  SHORTEN_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  SHORTEN_RATE_LIMIT_PER_IP: z.coerce.number().int().positive().default(10),
  SHORTEN_RATE_LIMIT_GLOBAL: z.coerce.number().int().positive().default(1000),

  // Click events. The stream is capped so a long worker outage can't fill Redis;
  // past the cap the oldest unprocessed clicks are dropped.
  CLICK_STREAM_MAX_LENGTH: z.coerce.number().int().positive().default(1_000_000),
  WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  WORKER_BLOCK_MS: z.coerce.number().int().positive().default(2000),
  // A message unacknowledged this long is assumed abandoned by a crashed worker.
  WORKER_CLAIM_IDLE_MS: z.coerce.number().int().positive().default(60_000),
  // Optional path to GeoLite2-Country.mmdb. Without it, every country is "unknown".
  GEOIP_DB_PATH: z.string().optional(),
  // Secret mixed into IP hashes; without it, the 4 billion IPv4 hashes could be brute-forced.
  IP_HASH_SECRET: z.string().min(16).default('dev-only-secret-change-me'),
});

export type Config = z.infer<typeof envSchema>;

/**
 * Parses and validates environment variables once at startup.
 * A bad or missing value crashes the process immediately with a readable
 * message instead of failing later on the first request.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
