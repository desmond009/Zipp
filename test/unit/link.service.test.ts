import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashManageToken } from '../../src/domain/manage-token.js';
import { ConflictError, ForbiddenError, GoneError, NotFoundError, ValidationError } from '../../src/errors.js';
import type { CounterRepository } from '../../src/repositories/counter.repository.js';
import { DuplicateCodeError, type LinkDocument, type LinkRepository } from '../../src/repositories/link.repository.js';
import { IdAllocator } from '../../src/services/id-allocator.js';
import type { CachedLink, CacheStats, LinkCache } from '../../src/services/link-cache.js';
import { LinkService } from '../../src/services/link.service.js';

/** In-memory links collection with the same unique-code behavior as MongoDB. */
class FakeLinkRepository {
  links = new Map<string, LinkDocument>();
  reads = 0;

  async insert(link: LinkDocument) {
    if (this.links.has(link.code)) throw new DuplicateCodeError(link.code);
    this.links.set(link.code, { ...link });
  }
  async findByCode(code: string) {
    this.reads++;
    return this.links.get(code) ?? null;
  }
  async deleteByCode(code: string) {
    return this.links.delete(code);
  }
}

/** Records every cache call, and honors set vs setIfAbsent like Redis SET / SET NX. */
class FakeCache implements LinkCache {
  entries = new Map<string, CachedLink>();
  calls: string[] = [];

  async get(code: string) {
    this.calls.push(`get ${code}`);
    return this.entries.get(code) ?? null;
  }
  async set(code: string, entry: CachedLink) {
    this.calls.push(`set ${code} ${entry.status}`);
    this.entries.set(code, entry);
  }
  async setIfAbsent(code: string, entry: CachedLink) {
    this.calls.push(`setIfAbsent ${code} ${entry.status}`);
    if (!this.entries.has(code)) this.entries.set(code, entry);
  }
  stats(): CacheStats {
    return { hits: 0, misses: 0, hitRate: 0 };
  }
}

class FakeCounter {
  seq = 0;
  async reserveRange(size: number) {
    this.seq += size;
    return this.seq;
  }
}

const OWNER = { id: new ObjectId().toHexString(), email: 'ana@example.com' };
const STRANGER = { id: new ObjectId().toHexString(), email: 'bo@example.com' };

let repo: FakeLinkRepository;
let cache: FakeCache;
let service: LinkService;

beforeEach(() => {
  repo = new FakeLinkRepository();
  cache = new FakeCache();
  const allocator = new IdAllocator(new FakeCounter() as unknown as CounterRepository, 100);
  // Casts: the real repository class has private fields, so a structural fake needs one.
  service = new LinkService(repo as unknown as LinkRepository, allocator, cache, 'http://short.test');
});

function storeLink(overrides: Partial<LinkDocument> = {}): LinkDocument {
  const link: LinkDocument = {
    code: 'abc1234',
    longUrl: 'https://example.com/',
    isCustom: false,
    createdAt: new Date(),
    manageTokenHash: hashManageToken('the-token'),
    ...overrides,
  };
  repo.links.set(link.code, link);
  return link;
}

describe('LinkService.createLink', () => {
  it('generates a 7-character code and returns the short URL and a manage token', async () => {
    const created = await service.createLink({ url: 'https://Example.com/a' }, null);
    expect(created.code).toMatch(/^[0-9A-Za-z]{7}$/);
    expect(created.shortUrl).toBe(`http://short.test/${created.code}`);
    expect(created.longUrl).toBe('https://example.com/a');
    expect(created.manageToken.length).toBeGreaterThan(20);
    expect(repo.links.get(created.code)?.manageTokenHash).toBe(hashManageToken(created.manageToken));
  });

  it('writes the new link through to the cache, replacing any "notFound" entry', async () => {
    cache.entries.set('my-blog', { status: 'notFound' });
    await service.createLink({ url: 'https://example.com/', alias: 'my-blog' }, null);
    expect(cache.entries.get('my-blog')).toMatchObject({ status: 'found', longUrl: 'https://example.com/' });
  });

  it('records the owner when logged in, and none for guests', async () => {
    const owned = await service.createLink({ url: 'https://example.com/' }, OWNER);
    const guest = await service.createLink({ url: 'https://example.com/' }, null);
    expect(repo.links.get(owned.code)?.ownerId?.toHexString()).toBe(OWNER.id);
    expect(repo.links.get(guest.code)?.ownerId).toBeUndefined();
  });

  it('omits expiresAt entirely when there is no expiry (so the TTL index ignores it)', async () => {
    const created = await service.createLink({ url: 'https://example.com/' }, null);
    expect(repo.links.get(created.code)).not.toHaveProperty('expiresAt');
  });

  it('rejects a taken alias with 409', async () => {
    await service.createLink({ url: 'https://example.com/', alias: 'my-blog' }, null);
    await expect(service.createLink({ url: 'https://example.com/', alias: 'my-blog' }, null)).rejects.toThrow(
      ConflictError,
    );
  });

  it('rejects invalid aliases and expiry dates in the past', async () => {
    await expect(service.createLink({ url: 'https://example.com/', alias: 'abc1234' }, null)).rejects.toThrow(
      ValidationError,
    );
    await expect(
      service.createLink({ url: 'https://example.com/', expiresAt: '2020-01-01T00:00:00Z' }, null),
    ).rejects.toThrow(/in the future/);
  });
});

describe('LinkService.resolve (cache-aside)', () => {
  it('serves a cache hit without reading the database', async () => {
    cache.entries.set('abc1234', { status: 'found', longUrl: 'https://cached.example/', expiresAt: null });
    await expect(service.resolve('abc1234')).resolves.toBe('https://cached.example/');
    expect(repo.reads).toBe(0);
  });

  it('on a miss, reads the database and fills the cache with SET NX', async () => {
    storeLink();
    await expect(service.resolve('abc1234')).resolves.toBe('https://example.com/');
    expect(repo.reads).toBe(1);
    expect(cache.calls).toContain('setIfAbsent abc1234 found');
  });

  it('caches "not found" too, so repeated misses never reach the database', async () => {
    await expect(service.resolve('nope123')).rejects.toThrow(NotFoundError);
    await expect(service.resolve('nope123')).rejects.toThrow(NotFoundError);
    expect(repo.reads).toBe(1);
  });

  it('returns 410 for an expired link that MongoDB has not deleted yet', async () => {
    storeLink({ expiresAt: new Date(Date.now() - 1000) });
    await expect(service.resolve('abc1234')).rejects.toThrow(GoneError);
  });

  it('returns 410 when a cached link expires before its cache entry does', async () => {
    cache.entries.set('abc1234', { status: 'found', longUrl: 'https://x.example/', expiresAt: Date.now() - 1 });
    await expect(service.resolve('abc1234')).rejects.toThrow(GoneError);
  });

  it('rejects impossible codes without touching cache or database', async () => {
    await expect(service.resolve('favicon.ico')).rejects.toThrow(NotFoundError);
    expect(cache.calls).toEqual([]);
    expect(repo.reads).toBe(0);
  });
});

describe('LinkService.deleteLink', () => {
  it('lets a guest delete with the manage token, and overwrites the cache with "notFound"', async () => {
    storeLink();
    cache.entries.set('abc1234', { status: 'found', longUrl: 'https://example.com/', expiresAt: null });

    await service.deleteLink('abc1234', { user: null, manageToken: 'the-token' });

    expect(repo.links.has('abc1234')).toBe(false);
    expect(cache.entries.get('abc1234')).toEqual({ status: 'notFound' });
  });

  it('lets the owner delete without a token', async () => {
    storeLink({ ownerId: new ObjectId(OWNER.id) });
    await service.deleteLink('abc1234', { user: OWNER, manageToken: null });
    expect(repo.links.has('abc1234')).toBe(false);
  });

  it('refuses anyone else', async () => {
    storeLink({ ownerId: new ObjectId(OWNER.id) });
    await expect(service.deleteLink('abc1234', { user: STRANGER, manageToken: null })).rejects.toThrow(ForbiddenError);
    await expect(service.deleteLink('abc1234', { user: null, manageToken: 'wrong' })).rejects.toThrow(ForbiddenError);
    expect(repo.links.has('abc1234')).toBe(true);
  });

  it('returns 404 for an unknown link', async () => {
    await expect(service.deleteLink('nope123', { user: OWNER, manageToken: null })).rejects.toThrow(NotFoundError);
  });
});

describe('LinkService.getViewableLink (stats access)', () => {
  it('shows guest links to everyone', async () => {
    storeLink();
    await expect(service.getViewableLink('abc1234', null)).resolves.toMatchObject({ code: 'abc1234' });
    await expect(service.getViewableLink('abc1234', STRANGER)).resolves.toMatchObject({ code: 'abc1234' });
  });

  it('shows owned links only to their owner', async () => {
    storeLink({ ownerId: new ObjectId(OWNER.id) });
    await expect(service.getViewableLink('abc1234', OWNER)).resolves.toMatchObject({ code: 'abc1234' });
    await expect(service.getViewableLink('abc1234', STRANGER)).rejects.toThrow(ForbiddenError);
    await expect(service.getViewableLink('abc1234', null)).rejects.toThrow(ForbiddenError);
  });
});
