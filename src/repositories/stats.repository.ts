import type { Collection, Db, Document } from 'mongodb';
import { COLLECTIONS } from '../db/collections.js';
import { STATS_DIMENSIONS, type DailyIncrement, type StatsDimension } from '../domain/daily-stats.js';

interface DailyStatsDocument {
  code: string;
  day: Date;
  total: number;
  countries: Record<string, number>;
  devices: Record<string, number>;
  browsers: Record<string, number>;
  os: Record<string, number>;
  referrers: Record<string, number>;
}

export interface DailyCount {
  day: Date;
  clicks: number;
}

/** Raw aggregation output; keys are still encoded (see daily-stats.ts). */
export type StatsAggregate = { daily: DailyCount[] } & Record<StatsDimension, { key: string; count: number }[]>;

/** How many entries to return per breakdown (top countries, top referrers, ...). */
const TOP_N = 20;

export class StatsRepository {
  private readonly collection: Collection<DailyStatsDocument>;

  constructor(db: Db) {
    this.collection = db.collection<DailyStatsDocument>(COLLECTIONS.dailyStats);
  }

  /**
   * One upsert per (code, day): creates the day's document on its first
   * click, then just increments counters. $inc is atomic, so several workers
   * can update the same document without losing counts.
   *
   * If two workers insert the same new (code, day) at once, the unique index
   * rejects one; MongoDB retries such upserts as updates automatically.
   */
  async applyIncrements(increments: DailyIncrement[]): Promise<void> {
    if (increments.length === 0) return;
    await this.collection.bulkWrite(
      increments.map(({ code, day, inc }) => ({
        updateOne: {
          filter: { code, day },
          update: { $inc: inc },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  /** Total clicks in [from, to): used to compare with the previous period. */
  async totalClicks(code: string, from: Date, to: Date): Promise<number> {
    const [result] = await this.collection
      .aggregate<{ total: number }>([
        { $match: { code, day: { $gte: from, $lt: to } } },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ])
      .toArray();
    return result?.total ?? 0;
  }

  /**
   * Builds the dashboard data for one link since `from` in a single query.
   * $facet runs several sub-pipelines over the same matched documents:
   * - daily: one point per day for the line chart
   * - one per dimension: merge the per-day maps into totals
   */
  async aggregate(code: string, from: Date): Promise<StatsAggregate> {
    const facets: Record<string, Document[]> = {
      daily: [{ $sort: { day: 1 } }, { $project: { _id: 0, day: 1, clicks: '$total' } }],
    };
    for (const dimension of STATS_DIMENSIONS) {
      facets[dimension] = sumMapField(dimension);
    }

    const [result] = await this.collection
      .aggregate<StatsAggregate>([
        // Uses the { code, day } unique index, so only this link's days are read.
        { $match: { code, day: { $gte: from } } },
        { $facet: facets },
      ])
      .toArray();
    return result!; // $facet always returns exactly one document
  }
}

/**
 * Turns per-day maps into totals. For "countries" over three days:
 *   { countries: { IN: 2, US: 1 } }, { countries: { IN: 5 } }, ...
 *   -> $objectToArray: [{ k: "IN", v: 2 }, { k: "US", v: 1 }], ...
 *   -> $unwind:        one document per (day, country) pair
 *   -> $group:         { _id: "IN", count: 7 }, { _id: "US", count: 1 }
 */
function sumMapField(field: StatsDimension): Document[] {
  return [
    { $project: { pairs: { $objectToArray: `$${field}` } } },
    { $unwind: '$pairs' },
    { $group: { _id: '$pairs.k', count: { $sum: '$pairs.v' } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: TOP_N },
    { $project: { _id: 0, key: '$_id', count: 1 } },
  ];
}
