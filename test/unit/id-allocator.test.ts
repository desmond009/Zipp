import { describe, expect, it } from 'vitest';
import type { CounterRepository } from '../../src/repositories/counter.repository.js';
import { IdAllocator } from '../../src/services/id-allocator.js';

/** In-memory stand-in for the MongoDB counter: atomic $inc, plus a little latency. */
class FakeCounter {
  seq = 0;
  reservations = 0;

  async reserveRange(size: number): Promise<number> {
    this.reservations++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.seq += size;
    return this.seq;
  }
}

// The real class has private fields, so TypeScript needs a cast to accept a fake.
const asRepo = (fake: FakeCounter) => fake as unknown as CounterRepository;

describe('IdAllocator', () => {
  it('hands out consecutive ids from one reserved range', async () => {
    const counter = new FakeCounter();
    const allocator = new IdAllocator(asRepo(counter), 10);

    const ids = [];
    for (let i = 0; i < 10; i++) ids.push(await allocator.next());

    expect(ids).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(counter.reservations).toBe(1);
  });

  it('reserves a new range only when the current one runs out', async () => {
    const counter = new FakeCounter();
    const allocator = new IdAllocator(asRepo(counter), 10);

    for (let i = 0; i < 25; i++) await allocator.next();

    expect(counter.reservations).toBe(3); // [0,10) [10,20) [20,30)
  });

  it('shares one reservation between concurrent callers', async () => {
    const counter = new FakeCounter();
    const allocator = new IdAllocator(asRepo(counter), 1000);

    const ids = await Promise.all(Array.from({ length: 500 }, () => allocator.next()));

    expect(new Set(ids).size).toBe(500);
    expect(counter.reservations).toBe(1);
  });

  it('never repeats an id when a burst is larger than one range', async () => {
    const counter = new FakeCounter();
    const allocator = new IdAllocator(asRepo(counter), 7);

    const ids = await Promise.all(Array.from({ length: 100 }, () => allocator.next()));

    expect(new Set(ids).size).toBe(100);
    expect(Math.max(...ids)).toBeLessThan(counter.seq);
  });

  it('keeps ids unique across two instances sharing one counter (two API servers)', async () => {
    const counter = new FakeCounter();
    const serverA = new IdAllocator(asRepo(counter), 50);
    const serverB = new IdAllocator(asRepo(counter), 50);

    const ids = await Promise.all(
      Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? serverA : serverB).next()),
    );

    expect(new Set(ids).size).toBe(200);
  });
});
