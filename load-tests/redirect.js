// Read-heavy redirect test: GET /:code without following the redirect.
//
//   SCENARIO=throughput  fixed number of virtual users, no pauses: finds the max req/s
//   SCENARIO=latency     fixed arrival rate (RATE req/s): latency at a steady, sustainable load
//
// Why both: when the server is saturated, requests queue and latency mostly
// measures the queue. A fixed arrival rate shows latency under normal load,
// and keeps sending on schedule even if the server slows down (a fixed set of
// virtual users would slow down with it and hide the problem).
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import http from 'k6/http';
import { summarize } from './lib/summary.js';

const BASE_URL = __ENV.BASE_URL || 'http://api:3000';
const SCENARIO = __ENV.SCENARIO || 'throughput';
const RATE = Number(__ENV.RATE || 2000);
const DURATION = __ENV.DURATION || '30s';
const NAME = __ENV.NAME || `redirect-${SCENARIO}`;

const codes = new SharedArray('codes', () => JSON.parse(open('./data/codes.json')));
// A fixed pool of codes that don't exist, requested repeatedly: shows negative caching.
const unknownCodes = new SharedArray('unknown', () => Array.from({ length: 100 }, (_, i) => `nolink-${i}`));

const scenarios = {
  throughput: { executor: 'constant-vus', vus: 64, duration: DURATION },
  latency: {
    executor: 'constant-arrival-rate',
    rate: RATE,
    timeUnit: '1s',
    duration: DURATION,
    preAllocatedVUs: 200,
    maxVUs: 1000,
  },
};

export const options = {
  scenarios: { [SCENARIO]: scenarios[SCENARIO] },
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
};

// 302 and 404 are both expected outcomes here; anything else counts as failed.
http.setResponseCallback(http.expectedStatuses(302, 404));

/**
 * Realistic skew: popular links get most of the traffic. 95% of requests go
 * to real links (80% of those to the hottest 20%), 5% to unknown codes.
 */
function pickCode() {
  if (Math.random() < 0.05) {
    return { code: unknownCodes[Math.floor(Math.random() * unknownCodes.length)], expected: 404 };
  }
  const hotSetSize = Math.floor(codes.length * 0.2);
  const index =
    Math.random() < 0.8
      ? Math.floor(Math.random() * hotSetSize)
      : hotSetSize + Math.floor(Math.random() * (codes.length - hotSetSize));
  return { code: codes[index], expected: 302 };
}

export default function () {
  const { code, expected } = pickCode();
  const response = http.get(`${BASE_URL}/${code}`, { redirects: 0, tags: { name: 'GET /:code' } });
  check(response, { 'expected status': (r) => r.status === expected });
}

export function handleSummary(data) {
  return summarize(NAME, data, { scenario: SCENARIO, cache: __ENV.CACHE || 'on', target_rps: SCENARIO === 'latency' ? RATE : null });
}
