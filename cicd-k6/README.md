# Shoply 부하테스트 · CI/CD · 실험 운영 담당 작업 정리

이 폴더는 온프레미스 Kubernetes와 AWS EKS 비교 실험에서 내가 담당한 작업만 따로 모은 제출용 정리본이다.

전체 프로젝트의 앱/인프라 전체가 아니라, 아래 범위에 해당하는 문서와 코드만 포함한다.

## 담당 범위

- GitHub Actions 기반 Docker 이미지 빌드/GHCR push 구조 정리
- GHCR 이미지 태그 기준 정리
- Shoply 실제 사용자 흐름 기반 k6 E2E 부하테스트 시나리오 작성
- 온프레미스/AWS EKS 동일 시각 부하테스트 예약 실행 스크립트 작성
- Prometheus remote write 기반 k6 결과 수집 구조 정리
- 온프레미스/AWS EKS 비교 실험 운영 런북 작성
- 테스트 전 DB/재고 초기화 절차 정리
- 실험 결과 기록 템플릿과 트러블슈팅 정리

## 주요 파일

| 파일 | 설명 |
|---|---|
| `.github/workflows/docker-build-test.yml` | 서비스별 Docker 이미지 빌드 및 GHCR push workflow |
| `cicd/README.md` | GitHub Actions, GHCR, 이미지 태그 운영 기준 |
| `docs/operation-runbook.md` | 실험 당일 실행 절차를 정리한 운영 런북 |
| `docs/experiment-plan.md` | 온프레미스 vs AWS EKS 비교 실험 계획 |
| `docs/load-test/load-test-summary.md` | 부하테스트와 모니터링 작업 현황 요약 |
| `docs/load-test/k6-loadtest-troubleshooting.md` | k6/Prometheus/Grafana 트러블슈팅 |
| `load-test/k6/README.md` | k6 시나리오와 실행 방법 |
| `load-test/k6/run-k6.sh` | k6 즉시 실행 스크립트 |
| `load-test/k6/schedule-k6.sh` | KST 기준 예약 실행 스크립트 |
| `load-test/k6/k6.env.example` | k6 실행 환경변수 예시 |
| `load-test/k6/scripts/common-e2e.js` | 로그인, 상품 조회, 주문, 결제 공통 E2E 흐름 |
| `load-test/k6/scripts/stable-flow.js` | 안정 상황 기준선 확인 시나리오 |
| `load-test/k6/scripts/spike-flow.js` | 스파이크/타임세일 부하 시나리오 |
| `load-test/k6/scripts/failover-flow.js` | 노드 장애 복구 관찰 시나리오 |
| `userdata/EC2-setting-guide.md` | PostgreSQL/Redis EC2 설정 및 실험 전 초기화 절차 |

## 공식 k6 시나리오

| 시나리오 | 실행 파일 | 최대 VUS | 목적 |
|---|---|---:|---|
| 안정 상황 | `scripts/stable-flow.js` | 200 | 평상시 기준선 확인 |
| 스파이크 | `scripts/spike-flow.js` | 400 | 순간 집중 부하와 병목 확인 |
| 노드 장애 | `scripts/failover-flow.js` | 200 | 워커 노드 장애 복구 확인 |

공통 사용자 흐름:

```text
VU별 최초 1회 로그인
-> 토큰 재사용
-> 상품 목록 조회
-> 상품 상세 조회
-> 주문 생성
-> 결제
```

## k6 실행 방법

`k6.env.example`은 실행 파일이 아니라 텍스트 환경변수 템플릿이다. 더블클릭으로 열리지 않으면 VS Code, vi, nano 같은 텍스트 편집기로 열면 된다.

```bash
code k6.env.example
vi k6.env.example
```

제출용 묶음에서는 `.sh` 파일이 실수로 실행되지 않도록 실행 권한을 빼두었다. 실제 k6 서버에서 실행할 때만 `chmod +x`를 부여한다.

처음 한 번 환경 파일을 만든다.

```bash
cd load-test/k6
cp k6.env.example .env.onprem
cp k6.env.example .env.aws
vi .env.onprem
vi .env.aws
chmod +x run-k6.sh schedule-k6.sh
```

환경 파일 예시:

```env
BASE_URL=http://<SHOPLY_TARGET>
PROMETHEUS_URL=http://<PROMETHEUS_IP>:9090/api/v1/write
ACCOUNT_COUNT=2000
TEST_PASSWORD=Test1234!
```

즉시 실행:

```bash
./run-k6.sh stable
./run-k6.sh spike
./run-k6.sh failover
```

KST 기준 예약 실행:

```bash
./schedule-k6.sh onprem stable "2026-06-25 15:00:00"
./schedule-k6.sh aws stable "2026-06-25 15:00:00"
```

온프레미스와 AWS EKS를 같은 시간에 동시에 테스트할 때는 환경별 `tmux` 세션을 분리해 실행한다.

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

## k6 결과 구분 태그

예약 실행 시 아래 태그가 자동으로 붙는다.

| 태그 | 예시 |
|---|---|
| `env` | `onprem`, `aws` |
| `scenario` | `stable`, `spike`, `failover` |
| `run_id` | `onprem_stable_20260625150000` |

Grafana에서는 `env`, `scenario`, `run_id` 기준으로 결과를 구분한다.

## GHCR 이미지 기준

실험용으로 새로 빌드한 고정 이미지 태그:

```text
ghcr.io/ktk026/shoply-frontend:app-1499b2e
ghcr.io/ktk026/shoply-gateway:app-1499b2e
ghcr.io/ktk026/shoply-user:app-1499b2e
ghcr.io/ktk026/shoply-product:app-1499b2e
ghcr.io/ktk026/shoply-inventory:app-1499b2e
ghcr.io/ktk026/shoply-order:app-1499b2e
ghcr.io/ktk026/shoply-payment:app-1499b2e
```

`latest`는 push 시점에 따라 실제 이미지가 달라질 수 있으므로 비교 실험에서는 고정 태그를 사용한다.

## 실험 전 필수 확인

```bash
kubectl config current-context
kubectl get nodes -o wide
kubectl get pods -n shoply -o wide
kubectl get hpa -n shoply
```

배포 이미지 확인:

```bash
kubectl get deploy -n shoply -o jsonpath='{range .items[*]}{.metadata.name}{" => "}{.spec.template.spec.containers[*].image}{"\n"}{end}'
```

GHCR pull secret 확인:

```bash
kubectl get secret ghcr-secret -n shoply
```

## 실험 전 DB/재고 초기화

주문/결제 테스트는 DB와 재고 상태를 변경하므로, 실험 전 동일한 초기 상태로 맞춘다.

```sql
TRUNCATE payments, order_items, orders RESTART IDENTITY CASCADE;
UPDATE inventory SET reserved = 0;
UPDATE products
SET is_timesale = FALSE, sale_price = NULL, sale_ends_at = NULL;
```

Redis 캐시도 초기화한다.

```bash
docker exec -it shoply-redis redis-cli FLUSHALL
```

## 제출 메모

이 폴더는 전체 팀 프로젝트 코드 전체가 아니라, 내가 담당한 CI/CD, k6 부하테스트, 예약 실행, 운영 런북, DB 초기화 절차만 모은 것이다.
