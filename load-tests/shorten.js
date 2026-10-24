// Write test: POST /api/shorten with unique URLs.
// Each request: rate-limit check (Redis Lua), ID from the in-memory range,
// MongoDB insert, cache write-through (Redis SET).
import { check } from 'k6';
import http from 'k6/http';
import { summarize } from './lib/summary.js';

const BASE_URL = __ENV.BASE_URL || 'http://api:3000';

export const options = {
  scenarios: { shorten: { executor: 'constant-vus', vus: 32, duration: '30s' } },
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const response = http.post(
    `${BASE_URL}/api/shorten`,
    JSON.stringify({ url: `https://example.com/new/${__VU}-${__ITER}-${Date.now()}` }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /api/shorten' } },
  );
  check(response, { created: (r) => r.status === 201 });
}

export function handleSummary(data) {
  return summarize('shorten-throughput', data, { scenario: 'throughput', cache: 'on' });
}
