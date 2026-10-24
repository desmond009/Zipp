// Helper for run.sh.
//   node report.mjs record <name> <metricsBefore> <metricsAfter> <streamLag> <drainSeconds>
//   node report.mjs table
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const resultsDir = new URL('./results/', import.meta.url);
const [command, ...args] = process.argv.slice(2);

const readJson = (file) => JSON.parse(readFileSync(new URL(file, resultsDir)));

if (command === 'record') {
  // Cache hit rate for one run = change in the API's /metrics counters during it.
  const [name, before, after, lag, drain] = args;
  const b = JSON.parse(before).cache;
  const a = JSON.parse(after).cache;
  const hits = a.hits - b.hits;
  const misses = a.misses - b.misses;
  const extra = {
    cache_hits: hits,
    cache_misses: misses,
    cache_hit_rate: hits + misses === 0 ? 0 : hits / (hits + misses),
    stream_lag_at_end: Number(lag),
    worker_drain_seconds: Number(drain),
  };
  writeFileSync(new URL(`${name}.extra.json`, resultsDir), JSON.stringify(extra, null, 2));
} else if (command === 'table') {
  // Repeated runs are named "<test>-r1", "<test>-r2", ...: group them and
  // report the median run by p99, plus the p99 range across runs.
  const groups = new Map();
  for (const file of readdirSync(resultsDir).filter((f) => f.endsWith('.k6.json'))) {
    const result = readJson(file);
    let extra = {};
    try {
      extra = readJson(file.replace('.k6.json', '.extra.json'));
    } catch {
      // The shorten test has no cache stats.
    }
    const test = result.name.replace(/-r\d+$/, '');
    groups.set(test, [...(groups.get(test) ?? []), { ...result, ...extra }]);
  }

  const order = (test) =>
    ['coldstart-cache-on', 'throughput-cache-on', 'latency-cache-on', 'coldstart-cache-off', 'throughput-cache-off', 'latency-cache-off', 'shorten'].findIndex((key) => test.includes(key));

  const header = ['Test', 'Load', 'Runs', 'Throughput (req/s)', 'p50 (ms)', 'p95 (ms)', 'p99 (ms)', 'p99 range (ms)', 'Cache hit rate', 'Errors', 'Dropped'];
  console.log(`| ${header.join(' | ')} |`);
  console.log(`|${header.map(() => '---').join('|')}|`);

  for (const [test, runs] of [...groups].sort(([a], [b]) => order(a) - order(b))) {
    runs.sort((a, b) => a.p99_ms - b.p99_ms);
    const median = runs[Math.floor(runs.length / 2)];
    const load =
      test.includes('coldstart') ? `${median.target_rps} req/s, first 10s`
      : median.scenario === 'latency' ? `${median.target_rps} req/s fixed`
      : 'max (closed)';
    const row = [
      test,
      load,
      runs.length,
      median.rps.toLocaleString('en-US'),
      median.p50_ms,
      median.p95_ms,
      median.p99_ms,
      runs.length > 1 ? `${runs[0].p99_ms}–${runs.at(-1).p99_ms}` : '—',
      median.cache_hit_rate === undefined ? '—' : `${(median.cache_hit_rate * 100).toFixed(1)}%`,
      `${(median.failed_rate * 100).toFixed(2)}%`,
      median.dropped_iterations,
    ];
    console.log(`| ${row.join(' | ')} |`);
  }
} else {
  console.error('usage: report.mjs record ... | table');
  process.exit(1);
}
