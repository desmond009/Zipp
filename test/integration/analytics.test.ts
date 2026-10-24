import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectRedis } from '../../src/db/redis.js';
import { CLICK_CONSUMER_GROUP, CLICK_DEAD_LETTER_KEY, CLICK_STREAM_KEY } from '../../src/domain/click-event.js';
import { ClickRepository } from '../../src/repositories/click.repository.js';
import { LinkRepository } from '../../src/repositories/link.repository.js';
import { StatsRepository } from '../../src/repositories/stats.repository.js';
import { ClickConsumer } from '../../src/workers/click-consumer.js';
import { ClickEnricher } from '../../src/workers/click-enricher.js';
import { StaticGeoLookup } from '../../src/workers/geo/static.js';
import { createLink, createTestApp, eventually, logger, type TestApp } from './helpers.js';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

let t: TestApp;
let workerRedis: Redis;
let consumer: ClickConsumer;
let consumerDone: Promise<void>;

beforeAll(async () => {
  t = await createTestApp({ TRUST_PROXY: 'true' });

  // The worker, wired as in src/worker.ts, with its own (blocking) Redis connection.
  workerRedis = await connectRedis(t.config.REDIS_URL, logger, { failFast: false });
  consumer = new ClickConsumer(
    {
      redis: workerRedis,
      clicks: new ClickRepository(t.db),
      stats: new StatsRepository(t.db),
      links: new LinkRepository(t.db),
      enricher: new ClickEnricher(new StaticGeoLookup({ '81.2.69.142': 'GB', '216.160.83.56': 'US' }), 'test-secret-0123456789'),
      logger,
    },
    { batchSize: 100, blockMs: 100, claimIdleMs: 60_000 },
  );
  consumerDone = consumer.run();
});

afterAll(async () => {
  consumer.stop();
  await consumerDone;
  await workerRedis.quit();
  await t.close();
});

function click(code: string, ip: string, userAgent: string, referer?: string) {
  return t.app.inject({
    method: 'GET',
    url: `/${code}`,
    headers: { 'x-forwarded-for': ip, 'user-agent': userAgent, ...(referer ? { referer } : {}) },
  });
}

describe('click analytics pipeline', () => {
  it('turns redirects into aggregated stats', async () => {
    const { code } = await createLink(t.app, { url: 'https://example.com/analytics' });

    await click(code, '81.2.69.142', IPHONE, 'https://www.twitter.com/post/1');
    await click(code, '81.2.69.142', IPHONE, 'https://www.twitter.com/post/2');
    await click(code, '216.160.83.56', WINDOWS_CHROME, 'https://news.ycombinator.com/item?id=1');
    await click(code, '10.0.0.1', WINDOWS_CHROME);

    const stats = await eventually(async () => {
      const response = await t.app.inject({ method: 'GET', url: `/api/links/${code}/stats?days=7` });
      const body = response.json();
      expect(body.totalClicks).toBe(4);
      return body;
    });

    expect(stats.uniqueVisitors).toBe(3); // two clicks came from the same IP
    expect(stats.daily).toHaveLength(7);
    expect(stats.daily.at(-1).clicks).toBe(4); // all today
    expect(stats.breakdowns.countries).toEqual([
      { key: 'GB', count: 2 },
      { key: 'US', count: 1 },
      { key: 'unknown', count: 1 },
    ]);
    expect(stats.breakdowns.devices).toEqual([
      { key: 'desktop', count: 2 },
      { key: 'mobile', count: 2 },
    ]);
    // Dotted hosts survive the round trip through MongoDB field names.
    expect(stats.breakdowns.referrers).toEqual(
      expect.arrayContaining([
        { key: 'twitter.com', count: 2 },
        { key: 'news.ycombinator.com', count: 1 },
        { key: 'direct', count: 1 },
      ]),
    );
  });

  it('keeps raw clicks in the time-series collection and the per-link total in sync', async () => {
    const { code } = await createLink(t.app, { url: 'https://example.com/counted' });
    for (let i = 0; i < 3; i++) await click(code, '81.2.69.142', IPHONE);

    await eventually(async () => {
      const link = await t.db.collection('links').findOne({ code });
      expect(link?.clickCount).toBe(3);
    });

    const raw = await t.db.collection('clicks').find({ 'meta.code': code }).toArray();
    expect(raw).toHaveLength(3);
    expect(raw[0]).toMatchObject({ country: 'GB', device: 'mobile', referrer: 'direct' });
    expect(raw[0]).not.toHaveProperty('ip'); // only the keyed hash is stored
    const info = await t.db.listCollections({ name: 'clicks' }).next();
    expect(info?.type).toBe('timeseries');
  });

  it('acks everything it processed, leaving nothing pending', async () => {
    await eventually(async () => {
      const [pending] = (await t.redis.xpending(CLICK_STREAM_KEY, CLICK_CONSUMER_GROUP)) as [number];
      expect(pending).toBe(0);
    });
  });

  it('moves malformed messages to the dead-letter stream instead of retrying them forever', async () => {
    await t.redis.xadd(CLICK_STREAM_KEY, '*', 'garbage', 'yes');

    // The worker copies to the dead-letter stream first and acks right after
    // (so a crash in between duplicates the copy rather than losing the
    // message). Wait for both, not just the first.
    await eventually(async () => {
      expect(await t.redis.xlen(CLICK_DEAD_LETTER_KEY)).toBe(1);
      const [pending] = (await t.redis.xpending(CLICK_STREAM_KEY, CLICK_CONSUMER_GROUP)) as [number];
      expect(pending).toBe(0);
    });
  });
});

describe('live tail (SSE)', () => {
  it('streams recent clicks, then new ones as the worker processes them', async () => {
    const { code } = await createLink(t.app, { url: 'https://example.com/live' });
    await click(code, '81.2.69.142', IPHONE);
    await eventually(async () => {
      expect((await t.db.collection('links').findOne({ code }))?.clickCount).toBe(1);
    });

    // app.inject buffers the whole response, so a stream needs a real HTTP server.
    const address = await t.app.listen({ port: 0, host: '127.0.0.1' });
    const response = await fetch(`${address}/api/links/${code}/live`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');

    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let received = '';
    const readEvents = async (count: number) => {
      while ((received.match(/^data: /gm) ?? []).length < count) {
        const { value, done } = await reader.read();
        if (done) throw new Error('stream ended early');
        received += value;
      }
    };

    await readEvents(1); // the history replay
    expect(received).toContain('"country":"GB"');

    await click(code, '216.160.83.56', WINDOWS_CHROME, 'https://news.ycombinator.com/');
    await readEvents(2); // published by the worker over Redis Pub/Sub

    const live = JSON.parse(received.trim().split('\n').filter((line) => line.startsWith('data: ')).at(-1)!.slice(6));
    expect(live).toMatchObject({ country: 'US', device: 'desktop', browser: 'Chrome', referrer: 'news.ycombinator.com' });
    expect(live).not.toHaveProperty('ipHash');

    await reader.cancel();
  });
});
