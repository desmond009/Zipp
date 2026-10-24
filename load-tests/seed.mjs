// Creates links through the API and saves their codes for the redirect test.
// Usage: node load-tests/seed.mjs [count]   (API at BASE_URL, default http://localhost:3000)
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const COUNT = Number(process.argv[2] ?? 5000);
const CONCURRENCY = 50;

const codes = [];
let next = 0;

async function worker() {
  while (next < COUNT) {
    const i = next++;
    const response = await fetch(`${BASE_URL}/api/shorten`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `https://example.com/articles/${i}?ref=loadtest` }),
    });
    if (response.status !== 201) {
      throw new Error(`Seeding failed at link ${i}: ${response.status} ${await response.text()}`);
    }
    codes.push((await response.json()).code);
  }
}

const started = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
mkdirSync(new URL('./data/', import.meta.url), { recursive: true });
writeFileSync(new URL('./data/codes.json', import.meta.url), JSON.stringify(codes));
console.log(`Seeded ${codes.length} links in ${((Date.now() - started) / 1000).toFixed(1)}s`);
