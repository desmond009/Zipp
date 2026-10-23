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
