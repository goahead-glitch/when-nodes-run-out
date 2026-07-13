# k6 Load Test Scenarios

이 디렉토리는 Shoply 부하테스트 시나리오와 k6 Docker 이미지를 관리한다.

## 현재 공식 실험 시나리오

현재 온프레미스와 AWS EKS 비교 실험에서 사용하는 공식 k6 시나리오는 `scripts/` 디렉토리 아래 3개 파일이다.

| 파일 | 시나리오 | 목적 |
|---|---|
| `scripts/stable-flow.js` | 시나리오 1: 안정적인 상황 | 평상시 기준선 확인 |
| `scripts/spike-flow.js` | 시나리오 2: 스파이크 / 타임세일 | 순간 집중 부하 확인 |
| `scripts/failover-flow.js` | 시나리오 3: 노드 하나 종료 | 장애 복구 및 복구 속도 확인 |

`shoply-smoke.js`, `shoply-order-payment.js`, `scenario-1-stable-order-payment.js`는 API 확인 또는 이전 실험용 파일로 보관한다.
현재 공식 비교 실험은 `scripts/stable-flow.js`, `scripts/spike-flow.js`, `scripts/failover-flow.js`를 기준으로 한다.
`deprecated/` 아래 `scenario-1`부터 `scenario-4`는 이전 API 기준으로 작성된 참고용 파일이며 현재 실험에는 사용하지 않는다.

## 실험 시나리오 계획

| 시나리오 | 목적 | 흐름 | 상태 |
|---|---|---|---|
| 1. 안정적인 상황 | 평상시 기준선 확인 | 로그인 -> 상품 조회 -> 주문 -> 결제 | `scripts/stable-flow.js` |
| 2. 스파이크 | 갑자기 주문이 몰릴 때 확인 | 로그인 -> 상품 조회 -> 주문 -> 결제를 짧은 시간에 증가 | `scripts/spike-flow.js` |
| 3. 노드 하나 끄기 | 장애 상황 복구 확인 | 부하 유지 중 워커 노드 1개 종료 | `scripts/failover-flow.js` |

## 시나리오 선택 기준

| 목적 | 실행 파일 |
|---|---|
| 서버 연결 확인 | `shoply-smoke.js` |
| 공식 안정 상황 실험 | `scripts/stable-flow.js` |
| 공식 스파이크 실험 | `scripts/spike-flow.js` |
| 공식 장애 복구 실험 | `scripts/failover-flow.js` |
| 이전 주문/결제 단일 실험 참고 | `shoply-order-payment.js` |

## k6 서버 직접 실행용 scripts

`scripts/` 아래 파일은 k6 전용 서버에서 `grafana/k6` 이미지를 바로 실행하기 위한 구성이다. 실제 실험은 이 방식을 기준으로 한다.
공통 사용자 흐름은 `common-e2e.js`에 모아두고, 각 실험 파일은 부하 패턴만 다르게 둔다.

공통 흐름:

```text
VU별 최초 1회 로그인 -> 토큰 재사용 -> 상품 목록 -> 상품 상세 -> 주문 -> 결제
```

각 VU는 처음 실행될 때 한 번 로그인하고, 이후 반복에서는 같은 토큰을 재사용한다. 이렇게 해야 로그인 API가 과하게 섞이지 않고 상품 조회, 주문, 결제 흐름의 부하를 더 정확하게 볼 수 있다.

| 시나리오 | 상품 수 | 최대 VUS | 총 시간 | 목적 |
|---|---:|---:|---:|---|
| 안정적인 상황 | 20개 분산 | 200 VUS | 10분 | 평상시 기준선 확인 |
| 스파이크 / 타임세일 | 3개 집중 | 400 VUS | 8분 | 순간 집중 부하와 병목 확인 |
| 노드 하나 종료 | 20개 분산 | 200 VUS | 12분 | 노드 장애 시 복구 속도 확인 |

k6 서버는 Spot 인스턴스를 사용할 수 있으므로 Public IP가 변경될 수 있다. 실행 전 현재 애플리케이션 서버와 Prometheus 서버 주소를 확인하고 `BASE_URL`, `K6_PROMETHEUS_RW_SERVER_URL`에 넣는다.

## 긴 docker run 명령 분석

기존 실행 명령은 아래 정보를 한 번에 넣기 때문에 길다.

```bash
BASE_URL=http://<SHOPLY_TARGET> \
ACCOUNT_COUNT=2000 \
TEST_PASSWORD='Test1234!' \
K6_PROMETHEUS_RW_SERVER_URL=http://<PROMETHEUS_IP>:9090/api/v1/write \
docker run --rm --network host \
  -v "$PWD/scripts:/scripts" \
  -e BASE_URL \
  -e ACCOUNT_COUNT \
  -e TEST_PASSWORD \
  -e K6_PROMETHEUS_RW_SERVER_URL \
  -e K6_PROMETHEUS_RW_TREND_STATS=p\(50\),p\(90\),p\(95\),p\(99\) \
  grafana/k6 run -o experimental-prometheus-rw /scripts/stable-flow.js
```

각 항목의 의미:

| 항목 | 의미 |
|---|---|
| `BASE_URL` | 부하를 줄 Shoply 애플리케이션 주소 |
| `ACCOUNT_COUNT` | 사용할 테스트 계정 수 |
| `TEST_PASSWORD` | 테스트 계정 공통 비밀번호 |
| `K6_PROMETHEUS_RW_SERVER_URL` | k6 결과를 보낼 Prometheus remote write 주소 |
| `--network host` | k6 컨테이너가 서버 네트워크를 그대로 사용 |
| `-v "$PWD/scripts:/scripts"` | 로컬 `scripts` 폴더를 컨테이너 `/scripts`로 연결 |
| `K6_PROMETHEUS_RW_TREND_STATS` | Prometheus에 p50/p90/p95/p99 지표를 같이 전송 |
| `-o experimental-prometheus-rw` | k6 결과를 Prometheus remote write로 출력 |
| `/scripts/stable-flow.js` | 실행할 k6 시나리오 파일 |

주의:

- `--out`이 아니라 `-o` 또는 `--out`을 사용한다.
- 복사 과정에서 `—out`처럼 긴 대시가 들어가면 k6가 옵션을 인식하지 못한다.
- Prometheus URL은 `/api/v1/write`까지 포함해야 한다.

## 짧은 실행 방식

긴 `docker run` 명령 대신 `run-k6.sh`를 사용한다.

서버 구조:

```text
~/taegyu-k6/
├── .env
├── k6.env.example
├── run-k6.sh
└── scripts/
    ├── common-e2e.js
    ├── stable-flow.js
    ├── spike-flow.js
    └── failover-flow.js
```

처음 한 번만 `.env`를 만든다.

```bash
cd ~/taegyu-k6
cp k6.env.example .env
vi .env
```

`.env` 예시:

```text
BASE_URL=http://<SHOPLY_TARGET>
PROMETHEUS_URL=http://<PROMETHEUS_IP>:9090/api/v1/write
ACCOUNT_COUNT=2000
TEST_PASSWORD=Test1234!
```

실행:

```bash
./run-k6.sh stable
./run-k6.sh spike
./run-k6.sh failover
```

각 명령의 의미:

| 명령 | 실행 시나리오 |
|---|---|
| `./run-k6.sh stable` | 안정 상황 200 VUS |
| `./run-k6.sh spike` | 스파이크 / 타임세일 400 VUS |
| `./run-k6.sh failover` | 노드 장애 200 VUS |

## KST 기준 예약 실행

`schedule-k6.sh`는 온프레미스와 AWS 설정을 명확히 분리해 지정한 KST 시각에
`run-k6.sh`를 실행한다. 예약 실행은 Ubuntu/Linux의 GNU `date`를 사용하므로
k6 서버에서 실행한다.

환경별 설정 파일을 처음 한 번 생성한다.

```bash
cd ~/taegyu-k6
cp k6.env.example .env.onprem
cp k6.env.example .env.aws
vi .env.onprem
vi .env.aws
chmod +x run-k6.sh schedule-k6.sh
```

- `.env.onprem`: 온프레미스 Shoply와 Prometheus 주소
- `.env.aws`: AWS EKS Shoply와 Prometheus 주소
- 두 파일의 `BASE_URL`, `PROMETHEUS_URL`이 실제 환경을 가리키는지 실행 전에 확인한다.

예약 실행 예시:

```bash
./schedule-k6.sh onprem stable "2026-06-24 15:00:00"
./schedule-k6.sh aws spike "2026-06-24 16:00:00"
./schedule-k6.sh aws failover "2026-06-24 17:00:00"
```

예약 실행 시 k6 결과에는 Grafana/Prometheus에서 구분하기 위한 태그가 자동으로 붙는다.

| 태그 | 예시 |
|---|---|
| `env` | `onprem`, `aws` |
| `scenario` | `stable`, `spike`, `failover` |
| `run_id` | `onprem_stable_20260624150000` |

환경별 설정을 선택하지 않는 기존 즉시 실행 방식은 그대로 사용할 수 있으며
기존처럼 `.env`를 읽는다.

```bash
./run-k6.sh stable
```

예약 프로세스는 터미널 연결이 끊기면 종료될 수 있다. 장시간 예약은 `tmux` 세션에서
실행하고, 예약 취소는 `Ctrl+C`를 사용한다.

온프레미스와 AWS를 같은 시각에 동시에 테스트할 때는 환경별로 `tmux` 세션을 분리한다.

```bash
tmux new -s k6-onprem-stable
cd ~/taegyu-k6
./schedule-k6.sh onprem stable "2026-06-25 15:00:00"
```

다른 터미널:

```bash
tmux new -s k6-aws-stable
cd ~/taegyu-k6
./schedule-k6.sh aws stable "2026-06-25 15:00:00"
```

k6 서버에서 직접 `docker run`으로 실행하는 예시:

```bash
cd ~/taegyu-k6

docker run --rm --network host \
  -e BASE_URL=http://<SHOPLY_TARGET> \
  -e K6_PROMETHEUS_RW_SERVER_URL=http://<PROMETHEUS_IP>:9090/api/v1/write \
  -e ACCOUNT_COUNT=2000 \
  -e TEST_PASSWORD='Test1234!' \
  -v "$PWD/scripts:/scripts" \
  grafana/k6 run -o experimental-prometheus-rw /scripts/stable-flow.js
```

스파이크 테스트:

```bash
docker run --rm --network host \
  -e BASE_URL=http://<SHOPLY_TARGET> \
  -e K6_PROMETHEUS_RW_SERVER_URL=http://<PROMETHEUS_IP>:9090/api/v1/write \
  -e ACCOUNT_COUNT=2000 \
  -e TEST_PASSWORD='Test1234!' \
  -v "$PWD/scripts:/scripts" \
  grafana/k6 run -o experimental-prometheus-rw /scripts/spike-flow.js
```

장애 복구 테스트는 `failover-flow.js`를 실행한 뒤, 200 VU 유지 구간의 5분 시점에서 워커 노드 1개를 종료한다.

## 테스트 계정 사용 방식

실제 사용자 흐름 시나리오는 VU별로 테스트 계정을 자동 배정한다.

```text
VU 1   -> test1@shoply.com
VU 2   -> test2@shoply.com
VU 300 -> test300@shoply.com
```

계정은 코드에 2000개를 직접 넣지 않고, 아래 환경변수로 계정 풀 크기만 조절한다.

| 변수 | 기본값 | 설명 |
|---|---:|---|
| `ACCOUNT_COUNT` | 2000 | 사용할 테스트 계정 풀 크기 |
| `TEST_PASSWORD` | `Test1234!` | 테스트 계정 공통 비밀번호 |

기본값 `ACCOUNT_COUNT=2000`을 유지하면 테스트 VU 수만큼만 계정이 사용된다.

```text
VUS=50  -> test1 ~ test50 사용
VUS=300 -> test1 ~ test300 사용
VUS=500 -> test1 ~ test500 사용
```

## Docker 이미지 빌드

```bash
cd /Users/kyu/Projects/On_P_VS_AWS
docker build -t shoply-k6-loadtest:local ./load-test/k6
```

EC2에서 사용할 이미지는 같은 Dockerfile로 빌드한다.

```bash
cd load-test/k6
docker compose build
```

## Docker Compose 실행

Docker Compose 방식은 로컬 검증 또는 이전 실험 재현용이다. 실제 온프레미스와 AWS EKS 비교 실험은 위의 k6 서버 `docker run` 방식을 기준으로 한다.

기본 서비스는 `order-payment`이며 기본 시나리오는 `shoply-order-payment.js`다.

```bash
cd load-test/k6

BASE_URL=http://<SHOPLY_TARGET> \
K6_PROMETHEUS_RW_SERVER_URL=http://<PROMETHEUS_IP>:9090/api/v1/write \
TEST_RUN_ID=order-payment-100vus-5m \
VUS=100 \
DURATION=5m \
docker compose run --rm order-payment
```

Compose로 공식 안정 상황 시나리오를 확인할 때:

```bash
BASE_URL=http://<SHOPLY_TARGET> \
K6_PROMETHEUS_RW_SERVER_URL=http://<PROMETHEUS_IP>:9090/api/v1/write \
TEST_RUN_ID=stable-flow-200vus \
SCENARIO=scripts/stable-flow.js \
docker compose run --rm order-payment
```

스파이크 시나리오 참고 실행:

```bash
BASE_URL=http://<SHOPLY_TARGET> \
K6_PROMETHEUS_RW_SERVER_URL=http://<PROMETHEUS_IP>:9090/api/v1/write \
TEST_RUN_ID=spike-flow \
SCENARIO=scripts/spike-flow.js \
docker compose run --rm order-payment
```

Smoke test:

```bash
BASE_URL=http://<SHOPLY_TARGET> \
SCENARIO=shoply-smoke.js \
VUS=5 \
DURATION=30s \
docker compose run --rm order-payment
```

Compose profile로 실행할 수도 있다.

```bash
docker compose --profile scenarios run --rm smoke
docker compose --profile scenarios run --rm stable-flow
```

## 현재 EC2 실행 절차

IP는 Spot 인스턴스 재생성에 따라 바뀔 수 있으므로 문서에 고정하지 않는다. 실행 전에 현재 값을 확인한다.

실행 전 PostgreSQL 서버에서 재고를 초기화한다.

```bash
docker exec -i shoply-postgres psql -U shoply -d shoply < ~/postgres/load-test-prep.sql
```

애플리케이션 EC2에서 이벤트 로그를 캡처하려면 별도 터미널에서 실행한다.

```bash
sudo -i
/home/ubuntu/scripts/capture-loop.sh shoply 30
```

부하테스트 서버에서 공식 안정 상황 시나리오를 실행한다.

```bash
cd ~/taegyu-k6

docker run --rm --network host \
  -e BASE_URL=http://<SHOPLY_TARGET> \
  -e K6_PROMETHEUS_RW_SERVER_URL=http://<PROMETHEUS_IP>:9090/api/v1/write \
  -e ACCOUNT_COUNT=2000 \
  -v "$PWD/scripts:/scripts" \
  grafana/k6 run -o experimental-prometheus-rw /scripts/stable-flow.js
```

Smoke test:

```bash
BASE_URL=http://<SHOPLY_TARGET> \
SCENARIO=shoply-smoke.js \
VUS=5 \
DURATION=30s \
docker compose run --rm order-payment
```

주의: `PROMETHEUS_RW_URL`이 아니라 `K6_PROMETHEUS_RW_SERVER_URL`을 사용한다.
URL은 `http://<PROMETHEUS_IP>:9090/api/v1/write`처럼 `/api/v1/write`까지 포함해야 한다.

## 결과 저장

`shoply-order-payment.js`는 `handleSummary`로 결과 파일을 저장한다.

```text
load-test/k6/results/<TEST_RUN_ID>/
├── summary.json
└── summary.md
```

여러 실행 결과를 CSV/Markdown 비교표로 합치려면:

```bash
node load-test/k6/collect-order-payment-results.mjs
```

생성 파일:

```text
load-test/results/order-payment/order-payment-summary.csv
load-test/results/order-payment/order-payment-summary.md
```

## 해석 기준

온프레미스 환경에서 단계별 한계점 테스트를 진행한 결과는 다음과 같이 해석한다.

| 구간 | 해석 |
|---|---|
| 200 VUS | 안정 구간 |
| 300 VUS | 불안정 시작 |
| 400 VUS | 한계 접근 |
| 600 VUS | 한계 초과 |

200 VUS 테스트에서는 p95 응답시간, 실패율, worker CPU, Pending Pod가 안정적이었다. 반면 300 VUS부터 Pending Pod가 발생하고 worker CPU가 크게 상승했으므로, 공식 안정 시나리오는 200 VUS로 조정한다.

스파이크 시나리오는 안정 기준선의 약 2배인 400 VUS를 사용한다. 600 VUS는 스파이크라기보다 한계 초과/장애 유도 테스트가 될 가능성이 커서 공식 스파이크 시나리오에서는 제외한다.

노드 장애 시나리오는 부하 한계가 아니라 복구 여부를 보기 위한 실험이므로, 안정 부하인 200 VUS 유지 중 워커 노드 1대를 종료한다. 이렇게 해야 부하 자체 때문에 터진 것인지, 노드 장애 때문에 흔들린 것인지 구분할 수 있다.

온프레미스와 AWS EKS는 동일한 시나리오, 동일한 상품 수, 동일한 최대 VUS, 동일한 웨이브 패턴으로 테스트한다. AWS EKS가 공식 시나리오에서 안정적으로 동작하면 이후 AWS EKS에 대해서만 500, 600 VUS 등 추가 한계점 테스트를 진행할 수 있다.

## 주의

- `PROMETHEUS_RW_URL`이 아니라 `K6_PROMETHEUS_RW_SERVER_URL`을 사용한다.
- `deprecated/`에 있는 legacy 시나리오는 실행하지 않는다.
- 토큰, `.env`, `.pem`, `.docker-config`는 Git에 올리지 않는다.
