import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { CLICK_STREAM_KEY, toStreamFields, type ClickEvent } from '../domain/click-event.js';

/**
 * Puts click events on a Redis stream for the analytics worker.
 *
 * One XADD per click: a single O(1) Redis command, typically well under a
 * millisecond. The redirect doesn't even wait for it (see redirect.routes.ts).
 */
export class ClickProducer {
  constructor(
    private readonly redis: Redis,
    private readonly maxStreamLength: number,
    private readonly logger: FastifyBaseLogger,
  ) {}

  /** Never throws: losing a click is better than failing a redirect. */
  async publish(event: ClickEvent): Promise<void> {
    try {
      await this.redis.xadd(
        CLICK_STREAM_KEY,
        // "~" lets Redis trim lazily in whole internal nodes, which is much
        // cheaper than trimming to an exact length on every add.
        'MAXLEN', '~', this.maxStreamLength,
        '*', // let Redis assign the ID: "<ms timestamp>-<sequence>", unique and ordered
        ...toStreamFields(event),
      );
    } catch (error) {
      this.logger.warn({ err: error, code: event.code }, 'Failed to publish click event');
    }
  }
}
