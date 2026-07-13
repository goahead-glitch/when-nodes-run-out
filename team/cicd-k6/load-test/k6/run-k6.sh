#!/usr/bin/env bash
set -euo pipefail

SCENARIO="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${K6_ENV_FILE:-$SCRIPT_DIR/.env}"
TARGET_ENV="${TARGET_ENV:-local}"
TEST_RUN_ID="${TEST_RUN_ID:-${TARGET_ENV}_${SCENARIO:-unknown}_$(date +%Y%m%d_%H%M%S)}"

if [ -z "$SCENARIO" ]; then
  echo "Usage: ./run-k6.sh [stable|spike|failover]"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Environment file not found: $ENV_FILE"
  echo "Create it from $SCRIPT_DIR/k6.env.example, then update BASE_URL and PROMETHEUS_URL."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source "$ENV_FILE"
set +a

case "$SCENARIO" in
  stable)
    SCRIPT="stable-flow.js"
    ;;
  spike)
    SCRIPT="spike-flow.js"
    ;;
  failover)
    SCRIPT="failover-flow.js"
    ;;
  *)
    echo "Unsupported scenario: $SCENARIO"
    echo "Available scenarios: stable, spike, failover"
    exit 1
    ;;
esac

if [ ! -d "$SCRIPT_DIR/scripts" ]; then
  echo "scripts directory not found: $SCRIPT_DIR/scripts"
  exit 1
fi

if [ ! -f "$SCRIPT_DIR/scripts/$SCRIPT" ]; then
  echo "Scenario file not found: $SCRIPT_DIR/scripts/$SCRIPT"
  exit 1
fi

: "${BASE_URL:?BASE_URL is required in .env}"
: "${PROMETHEUS_URL:?PROMETHEUS_URL is required in .env}"
: "${ACCOUNT_COUNT:=2000}"
: "${TEST_PASSWORD:=Test1234!}"
: "${K6_PROMETHEUS_RW_TREND_STATS:=p(50),p(90),p(95),p(99)}"

echo "======================================"
echo "Shoply k6 Load Test"
echo "Environment: $TARGET_ENV"
echo "Scenario: $SCENARIO"
echo "Run ID: $TEST_RUN_ID"
echo "Script: $SCRIPT"
echo "Config: $ENV_FILE"
echo "Target: $BASE_URL"
echo "Prometheus: $PROMETHEUS_URL"
echo "Account count: $ACCOUNT_COUNT"
echo "======================================"

docker run --rm --network host \
  -e BASE_URL="$BASE_URL" \
  -e K6_PROMETHEUS_RW_SERVER_URL="$PROMETHEUS_URL" \
  -e ACCOUNT_COUNT="$ACCOUNT_COUNT" \
  -e TEST_PASSWORD="$TEST_PASSWORD" \
  -e K6_PROMETHEUS_RW_TREND_STATS="$K6_PROMETHEUS_RW_TREND_STATS" \
  -v "$SCRIPT_DIR/scripts:/scripts:ro" \
  grafana/k6 run \
  -o experimental-prometheus-rw \
  --tag env="$TARGET_ENV" \
  --tag scenario="$SCENARIO" \
  --tag run_id="$TEST_RUN_ID" \
  "/scripts/$SCRIPT"
