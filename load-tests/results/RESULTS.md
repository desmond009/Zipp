| Test | Load | Runs | Throughput (req/s) | Throughput range | p50 (ms) | p95 (ms) | p99 (ms) | p99 range (ms) | Cache hit rate | Errors | Dropped |
|---|---|---|---|---|---|---|---|---|---|---|---|
| redirect-coldstart-cache-on | 2000 req/s, first 10s | 1 | 2,000 | — | 0.18 | 1.4 | 27.57 | — | 82.3% | 0.00% | 0 |
| redirect-throughput-cache-on | max (closed) | 3 | 17,243 | 15,145–27,611 | 3.13 | 6.4 | 11.33 | 7.29–12 | 100.0% | 0.00% | 0 |
| redirect-latency-cache-on | 2000 req/s fixed | 3 | 2,000 | 1,998–2,000 | 0.17 | 0.51 | 5.23 | 5.12–24.53 | 99.8% | 0.00% | 0 |
| redirect-coldstart-cache-off | 2000 req/s, first 10s | 1 | 2,000 | — | 0.26 | 0.6 | 7.11 | — | 0.0% | 0.00% | 0 |
| redirect-throughput-cache-off | max (closed) | 3 | 6,444 | 6,413–7,298 | 8.64 | 18.28 | 26.53 | 24.15–34.03 | 0.0% | 0.00% | 0 |
| redirect-latency-cache-off | 2000 req/s fixed | 3 | 1,983 | 1,896–1,998 | 0.41 | 16.89 | 152.17 | 46.61–977.3 | 0.0% | 0.00% | 509 |
| shorten-throughput | max (closed) | 1 | 8,123 | — | 3.35 | 6.98 | 10.7 | — | — | 0.00% | 0 |
