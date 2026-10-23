import { MongoServerError, type Collection, type Db } from 'mongodb';
import { COLLECTIONS } from '../db/collections.js';

export interface LinkDocument {
  code: string;
  longUrl: string;
  isCustom: boolean;
  createdAt: Date;
  /** Absent for links that never expire. */
  expiresAt?: Date;
  manageTokenHash: string;
}

/** Thrown when inserting a code that already exists (unique index violation). */
export class DuplicateCodeError extends Error {
  constructor(code: string) {
    super(`Code "${code}" already exists`);
    this.name = 'DuplicateCodeError';
  }
}

const DUPLICATE_KEY = 11000;

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
}
