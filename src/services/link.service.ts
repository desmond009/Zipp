import { validateAlias, isPossibleCode } from '../domain/alias.js';
import { generateManageToken, hashManageToken, verifyManageToken } from '../domain/manage-token.js';
import { idToCode } from '../domain/short-code.js';
import { normalizeUrl } from '../domain/url.js';
import { ConflictError, ForbiddenError, GoneError, NotFoundError, ValidationError } from '../errors.js';
import { DuplicateCodeError, type LinkDocument, type LinkRepository } from '../repositories/link.repository.js';
import type { IdAllocator } from './id-allocator.js';
import type { CachedLink, LinkCache } from './link-cache.js';

export interface CreateLinkInput {
  url: string;
  alias?: string;
  /** ISO 8601 date-time string. */
  expiresAt?: string;
}

export interface CreatedLink {
  code: string;
  shortUrl: string;
  longUrl: string;
  expiresAt: Date | null;
  /** Shown once; required to delete the link later. */
  manageToken: string;
}

export class LinkService {
  private readonly ownHost: string;

  constructor(
    private readonly links: LinkRepository,
    private readonly idAllocator: IdAllocator,
    private readonly cache: LinkCache,
    private readonly baseUrl: string,
  ) {
    this.ownHost = new URL(baseUrl).host;
  }

  async createLink(input: CreateLinkInput): Promise<CreatedLink> {
    const longUrl = normalizeUrl(input.url, this.ownHost);
    const expiresAt = input.expiresAt ? parseExpiry(input.expiresAt) : undefined;

    if (input.alias !== undefined) {
      const aliasError = validateAlias(input.alias);
      if (aliasError) {
        throw new ValidationError(aliasError);
      }
    }

    const code = input.alias ?? idToCode(await this.idAllocator.next());
    const manageToken = generateManageToken();

    const link: LinkDocument = {
      code,
      longUrl,
      isCustom: input.alias !== undefined,
      createdAt: new Date(),
      manageTokenHash: hashManageToken(manageToken),
      // Leave the field out entirely when there's no expiry, so the TTL index ignores it.
      ...(expiresAt && { expiresAt }),
    };

    try {
      await this.links.insert(link);
    } catch (error) {
      // Generated codes can't collide (see short-code.ts), so a duplicate
      // here can only be a custom alias someone already took.
      if (error instanceof DuplicateCodeError && link.isCustom) {
        throw new ConflictError(`Alias "${code}" is already taken`);
      }
      throw error;
    }

    // Write-through on create: new links tend to be clicked right away, and
    // this also replaces any cached "notFound" for this code (e.g. someone
    // tried /my-blog before the alias existed).
    await this.cache.set(code, toCacheEntry(link));

    return {
      code,
      shortUrl: `${this.baseUrl}/${code}`,
      longUrl,
      expiresAt: expiresAt ?? null,
      manageToken,
    };
  }

  /**
   * Returns the destination URL for a code, or throws 404 / 410.
   * Cache-aside: try Redis first; on a miss read MongoDB and fill the cache.
   */
  async resolve(code: string): Promise<string> {
    // Reject obviously invalid paths without touching Redis or MongoDB.
    if (!isPossibleCode(code)) {
      throw new NotFoundError();
    }

    let entry = await this.cache.get(code);
    if (!entry) {
      const link = await this.links.findByCode(code);
      entry = link ? toCacheEntry(link) : { status: 'notFound' };
      await this.cache.setIfAbsent(code, entry);
    }

    if (entry.status === 'notFound') {
      throw new NotFoundError();
    }
    // The TTL index deletes expired links only about once a minute, so an
    // expired link can still be in the database (or cache) for a short while.
    if (entry.status === 'expired' || (entry.expiresAt !== null && entry.expiresAt <= Date.now())) {
      throw new GoneError();
    }
    return entry.longUrl;
  }

  async deleteLink(code: string, manageToken: string): Promise<void> {
    const link = isPossibleCode(code) ? await this.links.findByCode(code) : null;
    if (!link) {
      throw new NotFoundError();
    }
    if (!verifyManageToken(manageToken, link.manageTokenHash)) {
      throw new ForbiddenError('Invalid manage token');
    }
    await this.links.deleteByCode(code);
    // Overwrite rather than delete the cache entry; see link-cache.ts for why.
    await this.cache.set(code, { status: 'notFound' });
  }
}

function toCacheEntry(link: LinkDocument): CachedLink {
  if (link.expiresAt && link.expiresAt <= new Date()) {
    return { status: 'expired' };
  }
  return { status: 'found', longUrl: link.longUrl, expiresAt: link.expiresAt?.getTime() ?? null };
}

function parseExpiry(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError('expiresAt must be a valid ISO 8601 date-time');
  }
  if (date <= new Date()) {
    throw new ValidationError('expiresAt must be in the future');
  }
  return date;
}
