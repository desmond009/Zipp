import { MongoServerError, type Collection, type Db, type Filter, type ObjectId, type Sort } from 'mongodb';
import { COLLECTIONS } from '../db/collections.js';

export interface LinkDocument {
  code: string;
  longUrl: string;
  isCustom: boolean;
  createdAt: Date;
  /** Absent for links that never expire. */
  expiresAt?: Date;
  manageTokenHash: string;
  /** Absent for links created as a guest. */
  ownerId?: ObjectId;
  /**
   * Denormalized total, incremented by the analytics worker. Duplicates what
   * daily_stats could compute, so "my links sorted by clicks" is one indexed
   * query instead of an aggregation over every link's history.
   */
  clickCount?: number;
}

export type LinkSort = 'newest' | 'clicks' | 'az';

export interface OwnerLinksQuery {
  sort: LinkSort;
  /** Case-insensitive substring of the code or destination. */
  search?: string;
  page: number;
  pageSize: number;
}

/** Thrown when inserting a code that already exists (unique index violation). */
export class DuplicateCodeError extends Error {
  constructor(code: string) {
    super(`Code "${code}" already exists`);
    this.name = 'DuplicateCodeError';
  }
}

const DUPLICATE_KEY = 11000;

const SORTS: Record<LinkSort, Sort> = {
  newest: { createdAt: -1 },
  clicks: { clickCount: -1, createdAt: -1 },
  az: { code: 1 },
};

export class LinkRepository {
  private readonly collection: Collection<LinkDocument>;

  constructor(db: Db) {
    this.collection = db.collection<LinkDocument>(COLLECTIONS.links);
  }

  async insert(link: LinkDocument): Promise<void> {
    try {
      // Spread a copy: the driver adds _id to the object it is given.
      await this.collection.insertOne({ ...link });
    } catch (error) {
      if (error instanceof MongoServerError && error.code === DUPLICATE_KEY) {
        throw new DuplicateCodeError(link.code);
      }
      throw error;
    }
  }

  async findByCode(code: string): Promise<LinkDocument | null> {
    return this.collection.findOne({ code }, { projection: { _id: 0 } });
  }

  /** Returns true if a link was deleted. */
  async deleteByCode(code: string): Promise<boolean> {
    const result = await this.collection.deleteOne({ code });
    return result.deletedCount === 1;
  }

  /** One page of a user's links, plus how many match in total (for pagination). */
  async findByOwner(ownerId: ObjectId, query: OwnerLinksQuery): Promise<{ links: LinkDocument[]; total: number }> {
    const filter: Filter<LinkDocument> = { ownerId };
    if (query.search) {
      const pattern = new RegExp(escapeRegExp(query.search), 'i');
      filter.$or = [{ code: pattern }, { longUrl: pattern }];
    }

    // Offset pagination: simple, and fine for one user's links. For very deep
    // pages, cursor pagination ("after createdAt X") avoids skipping rows.
    const [links, total] = await Promise.all([
      this.collection
        .find(filter, { projection: { _id: 0 } })
        .sort(SORTS[query.sort])
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .toArray(),
      this.collection.countDocuments(filter),
    ]);
    return { links, total };
  }

  /** Link and click totals across all of a user's links. */
  async summarizeOwner(ownerId: ObjectId): Promise<{ linkCount: number; totalClicks: number }> {
    const [summary] = await this.collection
      .aggregate<{ linkCount: number; totalClicks: number }>([
        { $match: { ownerId } },
        { $group: { _id: null, linkCount: { $sum: 1 }, totalClicks: { $sum: { $ifNull: ['$clickCount', 0] } } } },
      ])
      .toArray();
    return summary ?? { linkCount: 0, totalClicks: 0 };
  }

  /** Called by the worker once per batch. No upsert: clicks on a deleted link are simply not counted. */
  async incrementClickCounts(countsByCode: Map<string, number>): Promise<void> {
    if (countsByCode.size === 0) return;
    await this.collection.bulkWrite(
      [...countsByCode].map(([code, count]) => ({
        updateOne: { filter: { code }, update: { $inc: { clickCount: count } } },
      })),
      { ordered: false },
    );
  }
}

/** So a search for "a.b" matches a literal dot instead of "any character". */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
