import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';

/**
 * What we know about a code. Caching "not found" and "expired" too (negative
 * caching) stops requests for unknown codes, e.g. a bot scanning random
 * paths, from reaching MongoDB every time.
 */
export type CachedLink =
  | { status: 'found'; longUrl: string; expiresAt: number | null }
  | { status: 'notFound' }
  | { status: 'expired' };

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
}

export interface LinkCache {
  get(code: string): Promise<CachedLink | null>;
  /** Overwrites any existing entry. Used when a link is created or deleted. */
  set(code: string, entry: CachedLink): Promise<void>;
  /** Writes only if no entry exists. Used to fill the cache after a miss. */
  setIfAbsent(code: string, entry: CachedLink): Promise<void>;
  stats(): CacheStats;
}

export interface LinkCacheOptions {
  ttlSeconds: number;
  negativeTtlSeconds: number;
}

/*
 * Cache-aside with Redis.
 *
 * Why set() vs setIfAbsent(): a redirect that read MongoDB just before a
 * delete could write the stale "found" entry back after the delete
 * invalidated it, keeping a deleted link alive for a full TTL. So:
 *   - create/delete overwrite the entry (SET), the source of truth just changed
 *   - a reader filling the cache after a miss uses SET NX, so it can never
 *     overwrite what a create/delete wrote in the meantime
 *
 * Redis errors are logged and treated as a miss: a cache outage makes
 * redirects slower (every request hits MongoDB), but they keep working.
 */
export class RedisLinkCache implements LinkCache {
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly redis: Redis,
    private readonly options: LinkCacheOptions,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async get(code: string): Promise<CachedLink | null> {
    try {
      const value = await this.redis.get(cacheKey(code));
      if (value === null) {
        this.misses++;
        return null;
      }
      this.hits++;
      return JSON.parse(value) as CachedLink;
    } catch (error) {
      this.misses++;
      this.logger.warn({ err: error, code }, 'Cache read failed, falling back to MongoDB');
      return null;
    }
  }

  async set(code: string, entry: CachedLink): Promise<void> {
    await this.write(code, entry, false);
  }

  async setIfAbsent(code: string, entry: CachedLink): Promise<void> {
    await this.write(code, entry, true);
  }

  stats(): CacheStats {
    const total = this.hits + this.misses;
    return { hits: this.hits, misses: this.misses, hitRate: total === 0 ? 0 : this.hits / total };
  }

  private async write(code: string, entry: CachedLink, onlyIfAbsent: boolean): Promise<void> {
    const ttl = this.ttlFor(entry);
    try {
      if (onlyIfAbsent) {
        await this.redis.set(cacheKey(code), JSON.stringify(entry), 'EX', ttl, 'NX');
      } else {
        await this.redis.set(cacheKey(code), JSON.stringify(entry), 'EX', ttl);
      }
    } catch (error) {
      this.logger.warn({ err: error, code }, 'Cache write failed');
    }
  }

  /**
   * Found links live up to ttlSeconds, but never past their own expiry, so
   * the cache can't keep redirecting after a link has expired.
   */
  private ttlFor(entry: CachedLink): number {
    if (entry.status !== 'found') {
      return this.options.negativeTtlSeconds;
    }
    if (entry.expiresAt === null) {
      return this.options.ttlSeconds;
    }
    const secondsLeft = Math.ceil((entry.expiresAt - Date.now()) / 1000);
    return Math.max(1, Math.min(this.options.ttlSeconds, secondsLeft));
  }
}

/** Used when CACHE_ENABLED=false, to measure the uncached baseline. */
export class DisabledLinkCache implements LinkCache {
  private misses = 0;

  async get(): Promise<CachedLink | null> {
    this.misses++;
    return null;
  }
  async set(): Promise<void> {}
  async setIfAbsent(): Promise<void> {}
  stats(): CacheStats {
    return { hits: 0, misses: this.misses, hitRate: 0 };
  }
}

function cacheKey(code: string): string {
  return `link:${code}`;
}
