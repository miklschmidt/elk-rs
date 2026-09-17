#!/bin/sh
set -eu

SCENARIOS=${1:-issue_405,issue_603,issue_680,issue_871,issue_905}
ITERATIONS=${2:-20}
WARMUP=${3:-3}
OUTPUT=${4:-tests/results_layered_issue_scenarios.csv}

# Timings are compared with Java and with recorded baselines, so they come from optimized builds.
# shellcheck disable=SC2086
cargo run ${PARITY_CARGO_FLAGS:---release} -p org-eclipse-elk-alg-layered --bin perf_layered_issue_scenarios -- \
  --scenarios "$SCENARIOS" \
  --iterations "$ITERATIONS" \
  --warmup "$WARMUP" \
  --output "$OUTPUT"
