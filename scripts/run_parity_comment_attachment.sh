#!/bin/sh
set -eu

COUNT=${1:-2000}
ITERATIONS=${2:-5}
WARMUP=${3:-1}
OUTPUT=${4:-tests/results_comment_attachment.csv}

# Timings are compared with Java and with recorded baselines, so they come from optimized builds.
# shellcheck disable=SC2086
cargo run ${PARITY_CARGO_FLAGS:---release} -p org-eclipse-elk-core --bin perf_comment_attachment -- \
  --count "$COUNT" \
  --iterations "$ITERATIONS" \
  --warmup "$WARMUP" \
  --output "$OUTPUT"
