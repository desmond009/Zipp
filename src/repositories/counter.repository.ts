import { Long, type Collection, type Db } from 'mongodb';
import { COLLECTIONS } from '../db/collections.js';

interface CounterDocument {
  _id: string;
  seq: Long | number;
}

const LINK_ID_COUNTER = 'link_id';

export class CounterRepository {
  private readonly collection: Collection<CounterDocument>;

  constructor(db: Db) {
    this.collection = db.collection<CounterDocument>(COLLECTIONS.counters);
  }

  /** Creates the counter at 0 if it doesn't exist yet. */
  async ensureSeeded(): Promise<void> {
    await this.collection.updateOne(
      { _id: LINK_ID_COUNTER },
      // Stored as a 64-bit Long so it can grow past the 32-bit int limit (~2.1 billion).
      { $setOnInsert: { seq: Long.fromNumber(0) } },
      { upsert: true },
    );
  }

  /**
   * Atomically adds `size` to the counter and returns the new value.
   * The caller owns the IDs in [newValue - size, newValue).
   *
   * findOneAndUpdate on a single document is atomic, so two instances calling
   * this at the same moment always get different, non-overlapping ranges.
   */
  async reserveRange(size: number): Promise<number> {
    const counter = await this.collection.findOneAndUpdate(
      { _id: LINK_ID_COUNTER },
      { $inc: { seq: size } },
      { returnDocument: 'after' },
    );
    if (!counter) {
      throw new Error('ID counter is missing; was setupDatabase() run?');
    }
    return Number(counter.seq);
  }
}
