import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';

export interface RateLimitRule {
  /** Redis key for this limit, e.g. "rl:shorten:ip:1.2.3.4". */
  key: string;
  max: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requests left before the tightest rule is hit. */
  remaining: number;
  /** When blocked: seconds until a slot frees up. */
  retryAfterSeconds: number;
}

/*
 * Sliding-window log: each rule's key is a sorted set of request timestamps.
 * To check a request we drop timestamps older than the window and count
 * what's left. Unlike a fixed window ("10 per calendar minute"), a client
 * can't send 10 at 12:00:59 and 10 more at 12:01:00.
 *
 * Tradeoff: memory grows with the limit (one entry per request in the window).
 * Fine for 10/min per IP; for very high limits a sliding-window *counter*
 * (two fixed buckets, weighted) uses O(1) memory but is approximate.
 *
 * Why Lua: "count, then add" must be atomic. As two separate commands, two
 * API instances could both read count=9 and both let a request through.
 * Redis runs a script without interleaving any other command.
 *
 * The script checks every rule first and records the request only if all
 * pass, so a request rejected by the global limit doesn't use up the
 * client's per-IP quota. It reads the clock with TIME so all API instances
 * share Redis's clock instead of their own (possibly skewed) ones.
 *
 * KEYS:  one sorted set per rule
 * ARGV:  [1] unique member for this request, then (windowMs, max) per rule
 * Returns { allowed (1/0), remaining, retryAfterMs }
 */
const SLIDING_WINDOW_SCRIPT = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local member = ARGV[1]
local remaining = math.huge

for i, key in ipairs(KEYS) do
  local windowMs = tonumber(ARGV[i * 2])
  local max = tonumber(ARGV[i * 2 + 1])
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windowMs)
  local count = redis.call('ZCARD', key)
  if count >= max then
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local retryAfterMs = tonumber(oldest[2]) + windowMs - now
    return {0, 0, retryAfterMs}
  end
  remaining = math.min(remaining, max - count - 1)
end

for i, key in ipairs(KEYS) do
  local windowMs = tonumber(ARGV[i * 2])
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, windowMs)
end

return {1, remaining, 0}
`;

type RedisWithRateLimit = Redis & {
  slidingWindowLimit(numKeys: number, ...args: (string | number)[]): Promise<[number, number, number]>;
};

export class RateLimiter {
  private readonly redis: RedisWithRateLimit;

  constructor(
    redis: Redis,
    private readonly logger: FastifyBaseLogger,
  ) {
    // defineCommand loads the script once and then calls it by its SHA1
    // (EVALSHA), instead of sending the whole script on every request.
    redis.defineCommand('slidingWindowLimit', { lua: SLIDING_WINDOW_SCRIPT });
    this.redis = redis as RedisWithRateLimit;
  }

  async check(rules: RateLimitRule[]): Promise<RateLimitResult> {
    const args = rules.flatMap((rule) => [rule.windowSeconds * 1000, rule.max]);
    try {
      const [allowed, remaining, retryAfterMs] = await this.redis.slidingWindowLimit(
        rules.length,
        ...rules.map((rule) => rule.key),
        randomUUID(), // unique member, so two requests in the same millisecond both count
        ...args,
      );
      return {
        allowed: allowed === 1,
        remaining,
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      };
    } catch (error) {
      // Fail open: if Redis is down we'd rather accept some extra link
      // creations than reject every request. (A payments API might fail closed.)
      this.logger.warn({ err: error }, 'Rate limiter unavailable, allowing request');
      return { allowed: true, remaining: 0, retryAfterSeconds: 0 };
    }
  }
}
