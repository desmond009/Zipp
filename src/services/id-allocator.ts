import type { CounterRepository } from '../repositories/counter.repository.js';

/**
 * Hands out unique numeric IDs from an in-memory range, and reserves a new
 * range from MongoDB only when the current one runs out.
 *
 * With rangeSize = 1000, creating 1000 links costs 1 database round-trip
 * instead of 1000. The tradeoff: if the process restarts, the unused part of
 * its range is skipped forever, so IDs are unique but have gaps.
 */
export class IdAllocator {
  private nextId = 0;
  private endId = 0; // exclusive: the current range is [nextId, endId)
  private pendingRefill: Promise<void> | null = null;

  constructor(
    private readonly counters: CounterRepository,
    private readonly rangeSize: number,
  ) {}

  async next(): Promise<number> {
    // A loop rather than an `if`: when many requests wait on the same refill,
    // they can use up the new range before this one resumes.
    while (this.nextId >= this.endId) {
      // Share one in-flight refill between concurrent callers, so a burst of
      // requests on an empty range reserves one range, not one each.
      this.pendingRefill ??= this.refill().finally(() => {
        this.pendingRefill = null;
      });
      await this.pendingRefill;
    }
    return this.nextId++;
  }

  private async refill(): Promise<void> {
    const end = await this.counters.reserveRange(this.rangeSize);
    this.nextId = end - this.rangeSize;
    this.endId = end;
  }
}
