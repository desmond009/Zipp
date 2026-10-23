import { MongoServerError, type Db } from 'mongodb';
import { COLLECTIONS } from './collections.js';
import { CounterRepository } from '../repositories/counter.repository.js';

const RAW_CLICK_RETENTION_SECONDS = 60 * 60 * 24 * 90; // 90 days
const NAMESPACE_EXISTS = 48;

/**
 * Creates collections and indexes. Safe to run on every startup and from
 * several instances at once: createIndex is a no-op when the index exists.
 */
export async function setupDatabase(db: Db): Promise<void> {
  await createClicksTimeSeries(db);

  const links = db.collection(COLLECTIONS.links);
  const clicks = db.collection(COLLECTIONS.clicks);
  const dailyStats = db.collection(COLLECTIONS.dailyStats);
  const users = db.collection(COLLECTIONS.users);

  await Promise.all([
    // Every redirect looks up by code; unique also guards against duplicate codes.
    links.createIndex({ code: 1 }, { unique: true, name: 'code_unique' }),
    // TTL index: Mongo's background job deletes a link once expiresAt has passed.
    // Documents without expiresAt are never deleted.
    links.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expiresAt_ttl' }),
    // "My links" sorted by newest or by clicks. Partial: guest links (no owner)
    // never appear in these queries, so they don't take up space in the index.
    links.createIndex(
      { ownerId: 1, createdAt: -1 },
      { name: 'owner_newest', partialFilterExpression: { ownerId: { $exists: true } } },
    ),
    links.createIndex(
      { ownerId: 1, clickCount: -1 },
      { name: 'owner_clicks', partialFilterExpression: { ownerId: { $exists: true } } },
    ),
    users.createIndex({ email: 1 }, { unique: true, name: 'email_unique' }),
    // "Recent clicks for this link" queries.
    clicks.createIndex({ 'meta.code': 1, ts: -1 }, { name: 'code_ts' }),
    // One stats document per link per day; the worker upserts into it.
    dailyStats.createIndex({ code: 1, day: 1 }, { unique: true, name: 'code_day_unique' }),
  ]);

  await new CounterRepository(db).ensureSeeded();
}

/**
 * Time-series collections must be created explicitly (an insert would create a
 * normal collection). Mongo groups clicks for the same code into compressed
 * buckets, which makes them much cheaper to store and scan.
 */
async function createClicksTimeSeries(db: Db): Promise<void> {
  try {
    await db.createCollection(COLLECTIONS.clicks, {
      timeseries: { timeField: 'ts', metaField: 'meta', granularity: 'seconds' },
      expireAfterSeconds: RAW_CLICK_RETENTION_SECONDS,
    });
  } catch (error) {
    // Already created by a previous run or by another instance starting at the same time.
    if (!(error instanceof MongoServerError && error.code === NAMESPACE_EXISTS)) {
      throw error;
    }
  }
}
