import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { liveClickChannel, type LiveClick } from '../domain/click-event.js';

type Listener = (click: LiveClick) => void;

/*
 * Fans out live clicks from Redis Pub/Sub to browser connections.
 *
 * The worker publishes each processed click to "clicks:live:<code>". Every
 * API instance holds ONE subscriber connection (a Redis connection in
 * subscribe mode can't run other commands, so it can't be the main one) and
 * subscribes only to channels that someone on this instance is watching.
 * Ten viewers of the same link share one subscription; the last one to
 * leave unsubscribes.
 *
 * Pub/Sub is fire-and-forget: if nobody is subscribed, the message is gone.
 * That's right for a live view; the history comes from MongoDB instead.
 */
export class LiveClickHub {
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(
    private readonly subscriber: Redis,
    private readonly logger: FastifyBaseLogger,
  ) {
    subscriber.on('message', (channel: string, message: string) => {
      const channelListeners = this.listeners.get(channel);
      if (!channelListeners) return;
      try {
        const click = JSON.parse(message) as LiveClick;
        for (const listener of channelListeners) {
          listener(click);
        }
      } catch (error) {
        this.logger.warn({ err: error, channel }, 'Ignoring malformed live click message');
      }
    });
  }

  /** Starts delivering clicks for `code` to `listener`. Returns a function that stops it. */
  async subscribe(code: string, listener: Listener): Promise<() => Promise<void>> {
    const channel = liveClickChannel(code);
    let channelListeners = this.listeners.get(channel);
    if (!channelListeners) {
      // Registered before the await, so a second viewer arriving meanwhile
      // reuses this set instead of subscribing again.
      channelListeners = new Set();
      this.listeners.set(channel, channelListeners);
      try {
        await this.subscriber.subscribe(channel);
      } catch (error) {
        this.listeners.delete(channel); // so the next viewer tries again
        throw error;
      }
    }
    channelListeners.add(listener);

    return async () => {
      channelListeners.delete(listener);
      if (channelListeners.size === 0 && this.listeners.get(channel) === channelListeners) {
        this.listeners.delete(channel);
        await this.subscriber.unsubscribe(channel);
      }
    };
  }
}
