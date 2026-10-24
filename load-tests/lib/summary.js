// Turns k6's end-of-test data into one compact JSON result per run.
export function summarize(name, data, extra = {}) {
  const duration = data.metrics.http_req_duration.values;
  const round = (ms) => Math.round(ms * 100) / 100;
  const result = {
    name,
    ...extra,
    requests: data.metrics.http_reqs.values.count,
    rps: Math.round(data.metrics.http_reqs.values.rate),
    p50_ms: round(duration.med),
    p95_ms: round(duration['p(95)']),
    p99_ms: round(duration['p(99)']),
    max_ms: round(duration.max),
    // Unexpected statuses (not 302/404 for redirects, not 201 for shorten).
    failed_rate: data.metrics.http_req_failed.values.rate,
    dropped_iterations: data.metrics.dropped_iterations?.values.count ?? 0,
  };
  return {
    stdout: `${JSON.stringify(result, null, 2)}\n`,
    [`results/${name}.k6.json`]: JSON.stringify(result, null, 2),
  };
}
