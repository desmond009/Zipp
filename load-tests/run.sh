#!/usr/bin/env bash
# Runs the whole load-test suite against the docker-compose stack and prints
# a Markdown results table.
#
#   load-tests/run.sh                 # defaults: 5000 links, 2000 req/s, 3 runs each
#   RATE=3000 RUNS=5 load-tests/run.sh
#
# For each mode (cache on, cache off): restart the API, run a 10s warm-up
# (recorded separately as "cold start"), then each scenario RUNS times. The
# report shows the median run and the p99 range, so one unlucky run (a
# MongoDB checkpoint, a GC pause) neither hides nor dominates the result.
#
# k6 runs in a container on the compose network, so traffic doesn't go
# through Docker Desktop's port forwarding.
set -euo pipefail
cd "$(dirname "$0")/.."

RATE="${RATE:-2000}"
LINKS="${LINKS:-5000}"
RUNS="${RUNS:-3}"
K6_IMAGE="grafana/k6:2.3.0"

compose() { docker compose -f docker-compose.yml -f load-tests/compose.loadtest.yml "$@"; }
redis() { compose exec -T redis redis-cli "$@"; }

wait_for_api() {
  for _ in $(seq 60); do
    curl -sf localhost:3000/health > /dev/null && return
    sleep 1
  done
  echo "API did not become healthy" >&2
  exit 1
}

start_stack() { # $1 = true|false (cache). Always a fresh API process, so every mode starts equally cold.
  CACHE_ENABLED="$1" compose up -d --force-recreate api > /dev/null 2>&1
  wait_for_api
}

k6() {
  local network
  network=$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}' "$(compose ps -q api)")
  docker run --rm --network "$network" -v "$PWD/load-tests:/scripts" -w /scripts "$K6_IMAGE" run --quiet "$@"
}

# How many click events the worker still has to process.
stream_lag() {
  redis XINFO GROUPS clicks:stream | awk 'prev == "lag" { print $1 } { prev = $1 }'
}

# Seconds until the worker has processed every queued click.
wait_for_worker() {
  local started=$SECONDS
  while [ "$(stream_lag)" != "0" ] || [ "$(redis XPENDING clicks:stream analytics | head -1)" != "0" ]; do
    sleep 0.5
  done
  echo $((SECONDS - started))
}

# $1 = on|off, $2 = throughput|latency, $3 = result name, $4 = duration
run_redirect() {
  local before after lag drain
  echo "--- $3"
  before=$(curl -s localhost:3000/metrics)
  k6 -e SCENARIO="$2" -e RATE="$RATE" -e CACHE="$1" -e NAME="$3" -e DURATION="$4" redirect.js > /dev/null
  after=$(curl -s localhost:3000/metrics)
  lag=$(stream_lag)
  drain=$(wait_for_worker) # let the worker catch up so runs don't affect each other
  node load-tests/report.mjs record "$3" "$before" "$after" "$lag" "$drain"
}

# $1 = on|off. The API was just restarted: a fresh process, empty connection pools.
measure_redirects() {
  run_redirect "$1" latency "redirect-coldstart-cache-$1" 10s
  for run in $(seq "$RUNS"); do
    run_redirect "$1" throughput "redirect-throughput-cache-$1-r$run" 30s
    run_redirect "$1" latency "redirect-latency-cache-$1-r$run" 30s
  done
}

rm -f load-tests/results/*.json

echo "=== Building and starting the stack"
compose up -d --build > /dev/null 2>&1
start_stack true

echo "=== Seeding $LINKS links"
node load-tests/seed.mjs "$LINKS"
wait_for_worker > /dev/null

echo "=== Redirects WITH cache"
start_stack true
# Creating links wrote them through to the cache; clear them so the cold-start
# run begins with an empty cache.
compose exec -T redis sh -c "redis-cli --scan --pattern 'link:*' | xargs -r -n 500 redis-cli DEL" > /dev/null
measure_redirects on

echo "=== Redirects WITHOUT cache (every lookup hits MongoDB)"
start_stack false
measure_redirects off

echo "=== Shorten"
start_stack true
k6 shorten.js > /dev/null
wait_for_worker > /dev/null

echo
node load-tests/report.mjs table
