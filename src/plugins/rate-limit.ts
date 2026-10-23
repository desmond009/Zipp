import type { FastifyReply, FastifyRequest } from 'fastify';
import { TooManyRequestsError } from '../errors.js';
import type { RateLimiter, RateLimitRule } from '../services/rate-limiter.js';

/**
 * Builds an onRequest hook that enforces the given rules. onRequest runs
 * before body parsing and validation, so even malformed requests count
 * against the limit, and rejecting them costs almost nothing.
 */
export function rateLimitHook(rateLimiter: RateLimiter, rulesFor: (request: FastifyRequest) => RateLimitRule[]) {
  return async function enforceRateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const result = await rateLimiter.check(rulesFor(request));
    if (!result.allowed) {
      reply.header('Retry-After', result.retryAfterSeconds);
      throw new TooManyRequestsError();
    }
    reply.header('X-RateLimit-Remaining', result.remaining);
  };
}
