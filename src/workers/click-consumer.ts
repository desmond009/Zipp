import { hostname } from 'node:os';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import {
  CLICK_CONSUMER_GROUP,
  CLICK_DEAD_LETTER_KEY,
  CLICK_STREAM_KEY,
  fromStreamFields,
} from '../domain/click-event.js';
import { buildDailyIncrements } from '../domain/daily-stats.js';
import type { ClickDocument, ClickRepository } from '../repositories/click.repository.js';
import type { StatsRepository } from '../repositories/stats.repository.js';
import type { ClickEnricher } from './click-enricher.js';

/** A stream entry as Redis returns it: [id, [field, value, field, value, ...]]. */
type StreamEntry = [id: string, fields: string[]];

export interface ClickConsumerOptions {
  batchSize: number;
  blockMs: number;
  claimIdleMs: number;
}

export interface ClickConsumerDependencies {
  redis: Redis;
  clicks: ClickRepository;
  stats: StatsRepository;
  enricher: ClickEnricher;
  logger: FastifyBaseLogger;
}

const RECLAIM_INTERVAL_MS = 10_000;
const ERROR_BACKOFF_MS = 1000;
const DEAD_LETTER_MAX_LENGTH = 10_000;
const BUSYGROUP = 'BUSYGROUP';

/*
 * Reads click events from the Redis stream through a consumer group.
 *
 * Consumer groups give us:
 * - Load balancing: run N workers with the same group and each message goes
 *   to exactly one of them.
 * - At-least-once delivery: a message stays "pending" until we XACK it. If a
 *   worker crashes mid-batch, its pending messages are claimed by another
 *   worker after claimIdleMs (XAUTOCLAIM) and processed again.
 *
 * The flip side of at-least-once: if a worker crashes after writing to
 * MongoDB but before XACK, that batch is counted twice. The window is tiny
 * (two back-to-back calls); closing it fully would need a transaction that
 * records processed IDs together with the counters.
 */
export class ClickConsumer {
  /** Unique per process, so Redis can tell which worker holds which pending messages. */
  private readonly consumerName = `${hostname()}-${process.pid}`;
  private stopping = false;
  private lastReclaimAt = 0;

  constructor(
    private readonly deps: ClickConsumerDependencies,
    private readonly options: ClickConsumerOptions,
  ) {}

  /** Runs until stop() is called. */
  async run(): Promise<void> {
    await this.ensureConsumerGroup();
    this.deps.logger.info({ consumer: this.consumerName }, 'Click consumer started');

    while (!this.stopping) {
      try {
        await this.reclaimAbandonedMessages();
        const entries = await this.readNewMessages();
        if (entries.length > 0) {
          await this.processBatch(entries);
        }
      } catch (error) {
        // Most likely MongoDB or Redis is down. The batch was not acked, so
        // nothing is lost: it will be reclaimed and retried. Back off briefly
        // instead of spinning.
        this.deps.logger.error({ err: error }, 'Failed to process click batch, will retry');
        await sleep(ERROR_BACKOFF_MS);
      }
    }
    this.deps.logger.info('Click consumer stopped');
  }

  /**
   * Asks the loop to finish its current batch and exit. Because reads block
   * for at most blockMs, this takes at most about that long.
   */
  stop(): void {
    this.stopping = true;
  }

  private async ensureConsumerGroup(): Promise<void> {
    try {
      // "0": a brand-new group starts from the beginning of the stream, so
      // clicks recorded before the first worker ever ran are still processed.
      // MKSTREAM creates the stream if the API hasn't written to it yet.
      await this.deps.redis.xgroup('CREATE', CLICK_STREAM_KEY, CLICK_CONSUMER_GROUP, '0', 'MKSTREAM');
    } catch (error) {
      // The group already exists (created on an earlier run or by another worker).
      if (!(error instanceof Error && error.message.startsWith(BUSYGROUP))) {
        throw error;
      }
    }
  }

  private async readNewMessages(): Promise<StreamEntry[]> {
    // ">" means "messages never delivered to anyone in this group".
    // BLOCK waits up to blockMs for new messages instead of polling in a loop.
    const response = (await this.deps.redis.xreadgroup(
      'GROUP', CLICK_CONSUMER_GROUP, this.consumerName,
      'COUNT', this.options.batchSize,
      'BLOCK', this.options.blockMs,
      'STREAMS', CLICK_STREAM_KEY, '>',
    )) as [stream: string, entries: StreamEntry[]][] | null;

    return response?.[0]?.[1] ?? []; // null when BLOCK timed out with nothing new
  }

  /** Takes over messages another worker received but never acked (it probably crashed). */
  private async reclaimAbandonedMessages(): Promise<void> {
    if (Date.now() - this.lastReclaimAt < RECLAIM_INTERVAL_MS) return;
    this.lastReclaimAt = Date.now();

    let cursor = '0-0';
    do {
      const [nextCursor, entries] = (await this.deps.redis.xautoclaim(
        CLICK_STREAM_KEY, CLICK_CONSUMER_GROUP, this.consumerName,
        this.options.claimIdleMs, cursor,
        'COUNT', this.options.batchSize,
      )) as [string, StreamEntry[], string[]];

      if (entries.length > 0) {
        this.deps.logger.warn({ count: entries.length }, 'Reclaimed abandoned click events');
        await this.processBatch(entries);
      }
      cursor = nextCursor;
    } while (cursor !== '0-0' && !this.stopping);
  }

  private async processBatch(entries: StreamEntry[]): Promise<void> {
    const clicks: ClickDocument[] = [];
    const malformed: StreamEntry[] = [];

    for (const [id, fields] of entries) {
      const event = fromStreamFields(fields);
      if (event) {
        clicks.push(this.deps.enricher.enrich(event));
      } else {
        malformed.push([id, fields]);
      }
    }

    // Raw clicks and aggregated counters are written in parallel: they're
    // independent, and both must succeed before we ack.
    await Promise.all([
      this.deps.clicks.insertMany(clicks),
      this.deps.stats.applyIncrements(buildDailyIncrements(clicks.map((click) => ({ ...click, code: click.meta.code })))),
    ]);

    if (malformed.length > 0) {
      await this.moveToDeadLetter(malformed);
    }

    // Only now is it safe to tell Redis these messages are done.
    await this.deps.redis.xack(CLICK_STREAM_KEY, CLICK_CONSUMER_GROUP, ...entries.map(([id]) => id));
    this.deps.logger.debug({ count: entries.length }, 'Processed click batch');
  }

  /**
   * A malformed message would fail the same way on every retry, so retrying
   * is pointless. We ack it with the rest of the batch, and keep a copy in a
   * separate stream so the bug that produced it can be investigated.
   */
  private async moveToDeadLetter(entries: StreamEntry[]): Promise<void> {
    this.deps.logger.warn({ count: entries.length }, 'Moving malformed click events to dead-letter stream');
    const pipeline = this.deps.redis.pipeline();
    for (const [id, fields] of entries) {
      pipeline.xadd(CLICK_DEAD_LETTER_KEY, 'MAXLEN', '~', DEAD_LETTER_MAX_LENGTH, '*', 'originalId', id, ...fields);
    }
    await pipeline.exec();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
