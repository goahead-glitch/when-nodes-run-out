#!/usr/bin/env bash
set -euo pipefail

TARGET_ENV="${1:-}"
SCENARIO="${2:-}"
START_KST="${3:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_K6="$SCRIPT_DIR/run-k6.sh"

usage() {
  echo '사용법: ./schedule-k6.sh [onprem|aws] [stable|spike|failover] "YYYY-MM-DD HH:MM:SS"'
  echo '예시: ./schedule-k6.sh onprem stable "2026-06-24 15:00:00"'
}

if [ -z "$TARGET_ENV" ] || [ -z "$SCENARIO" ] || [ -z "$START_KST" ]; then
  usage
  exit 1
fi

case "$TARGET_ENV" in
  onprem|aws) ;;
  *)
    echo "지원하지 않는 환경입니다: $TARGET_ENV"
    echo "사용 가능 환경: onprem, aws"
    exit 1
    ;;
esac

case "$SCENARIO" in
  stable|spike|failover) ;;
  *)
    echo "지원하지 않는 시나리오입니다: $SCENARIO"
    echo "사용 가능 시나리오: stable, spike, failover"
    exit 1
    ;;
esac

if [[ ! "$START_KST" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}$ ]]; then
  echo '날짜 형식은 "YYYY-MM-DD HH:MM:SS"이어야 합니다.'
  exit 1
fi

if [ ! -x "$RUN_K6" ]; then
  echo "run-k6.sh 파일이 없거나 실행 권한이 없습니다: $RUN_K6"
  echo "실행 권한 추가: chmod +x \"$RUN_K6\""
  exit 1
fi

ENV_FILE="$SCRIPT_DIR/.env.$TARGET_ENV"
if [ ! -f "$ENV_FILE" ]; then
  echo "환경 설정 파일이 없습니다: $ENV_FILE"
  echo "생성 방법: cp \"$SCRIPT_DIR/k6.env.example\" \"$ENV_FILE\""
  exit 1
fi

# Ubuntu/Linux k6 서버의 GNU date를 기준으로 KST 입력 시간을 변환한다.
if ! START_EPOCH=$(TZ=Asia/Seoul date -d "$START_KST" +%s 2>/dev/null); then
  echo "유효하지 않은 날짜입니다: $START_KST"
  exit 1
fi

NOW_EPOCH=$(date +%s)
WAIT_SECONDS=$((START_EPOCH - NOW_EPOCH))

if [ "$WAIT_SECONDS" -lt 0 ]; then
  echo "이미 지난 시간입니다: $START_KST"
  echo "현재 KST: $(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M:%S')"
  exit 1
fi

WAIT_HOURS=$((WAIT_SECONDS / 3600))
WAIT_MINUTES=$(((WAIT_SECONDS % 3600) / 60))
WAIT_REMAIN_SECONDS=$((WAIT_SECONDS % 60))
RUN_ID_TIME="${START_KST//[-: ]/}"
TEST_RUN_ID="${TARGET_ENV}_${SCENARIO}_${RUN_ID_TIME}"

echo "======================================"
echo "Shoply k6 예약 실행"
echo "Environment : $TARGET_ENV"
echo "Scenario    : $SCENARIO"
echo "Run ID      : $TEST_RUN_ID"
echo "Config      : $ENV_FILE"
echo "Start KST   : $START_KST"
echo "Current KST : $(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M:%S')"
echo "Wait Time   : ${WAIT_HOURS}시간 ${WAIT_MINUTES}분 ${WAIT_REMAIN_SECONDS}초"
echo "======================================"

trap 'printf "\n예약이 취소되었습니다.\n"; exit 130' INT TERM

echo "예약 대기 중..."
sleep "$WAIT_SECONDS"

echo "======================================"
echo "k6 테스트를 시작합니다."
echo "Start KST: $(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M:%S')"
echo "======================================"

cd "$SCRIPT_DIR"
TARGET_ENV="$TARGET_ENV" TEST_RUN_ID="$TEST_RUN_ID" K6_ENV_FILE="$ENV_FILE" exec "$RUN_K6" "$SCENARIO"
