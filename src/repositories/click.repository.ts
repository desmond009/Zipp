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
