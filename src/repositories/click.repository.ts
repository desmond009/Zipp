import type { Collection, Db } from 'mongodb';
import { COLLECTIONS } from '../db/collections.js';

/** One raw click in the time-series collection. */
export interface ClickDocument {
  ts: Date;
  /** The metaField: MongoDB stores clicks with the same meta together in compressed buckets. */
  meta: { code: string };
  country: string;
  device: string;
  browser: string;
  os: string;
  referrer: string;
  /** Keyed hash, never the raw IP: lets you count unique visitors without storing personal data. */
  ipHash: string;
}

export class ClickRepository {
  private readonly collection: Collection<ClickDocument>;

  constructor(db: Db) {
    this.collection = db.collection<ClickDocument>(COLLECTIONS.clicks);
  }

  /**
   * Distinct visitors (by IP hash) since `from`. Needs the raw clicks: daily
   * counters can't answer this, because the same visitor on two days would
   * be counted twice. Uses the { meta.code, ts } index.
   */
  async countUniqueVisitors(code: string, from: Date): Promise<number> {
    const [result] = await this.collection
      .aggregate<{ visitors: number }>([
        { $match: { 'meta.code': code, ts: { $gte: from } } },
        { $group: { _id: '$ipHash' } },
        { $count: 'visitors' },
      ])
      .toArray();
    return result?.visitors ?? 0;
  }

  /** The latest clicks, newest first: the backlog shown when the live tail opens. */
  async findRecent(code: string, limit: number): Promise<ClickDocument[]> {
    return this.collection
      .find({ 'meta.code': code }, { projection: { _id: 0 } })
      .sort({ ts: -1 })
      .limit(limit)
      .toArray();
  }

  async insertMany(clicks: ClickDocument[]): Promise<void> {
    if (clicks.length === 0) return;
    // ordered: false lets MongoDB insert in parallel and not stop at the first error.
    // Copies, because the driver adds _id to the objects it is given.
    await this.collection.insertMany(
      clicks.map((click) => ({ ...click })),
      { ordered: false },
    );
  }
}
