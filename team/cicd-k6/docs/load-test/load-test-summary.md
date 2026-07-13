# Shoply 부하테스트 및 모니터링 실험 정리

이 문서는 Shoply 프로젝트에서 진행한 k6 부하테스트, 모니터링 구성, 현재까지 확보한 결과, 앞으로 해야 할 일을 한 번에 보기 위한 정리 문서다.

## 담당 범위

태규 담당 범위는 아래 작업을 중심으로 한다.

```text
CI/CD + GHCR 이미지 관리
k6 부하테스트 시나리오 작성
Prometheus/Grafana 모니터링 연동
온프레미스 한계점 측정
AWS EKS 동일 조건 비교 준비
발표용 결과와 영상 정리
```

## 지금까지 한 일

### CI/CD와 이미지 관리

GitHub Actions 기반 CI/CD 구조를 구성했다.

기본 흐름:

```text
코드 변경
-> GitHub Actions 실행
-> Docker 이미지 빌드
-> GHCR Push
-> Kubernetes에서 동일 이미지 사용
```

이 구조를 통해 온프레미스 Kubernetes와 AWS EKS가 서로 다른 환경이어도 동일한 Shoply 애플리케이션 이미지를 사용할 수 있게 했다.

GHCR 사용 목적:

- 서비스별 Docker 이미지 저장
- 온프레미스와 AWS EKS의 애플리케이션 버전 통일
- 실험 조건의 공정성 확보

### Kubernetes 배포 구조 확인

Kubernetes에서 사용할 매니페스트 구조를 확인했다.

확인한 내용:

- `msa_shoply/k8s/common` 공통 리소스 구조
- `msa_shoply/k8s/onprem` 온프레미스 전용 리소스 구조
- GHCR 인증 문제
- 이미지 아키텍처 문제

공통 리소스와 온프레미스 전용 리소스 경로를 분리했다. Argo CD 연동은 연결 실패로 현재 실험 범위에서 제외하며, 배포는 `kubectl apply -k` 기반으로 진행한다.

### k6 부하테스트 환경 구성

k6 부하테스트 서버에서 Docker 기반 실행 구조를 구성했다.

구성 흐름:

```text
k6 서버
-> Shoply 서비스에 부하 발생
-> k6 결과를 Prometheus remote write로 전송
-> Grafana에서 부하테스트와 Kubernetes 지표 확인
```

현재 공식 실행 방식은 k6 서버에서 `grafana/k6` Docker 이미지를 직접 실행하는 방식이다.

중요 환경변수:

| 변수 | 의미 |
|---|---|
| `BASE_URL` | Shoply 애플리케이션 접속 주소 |
| `K6_PROMETHEUS_RW_SERVER_URL` | Prometheus remote write 주소 |
| `ACCOUNT_COUNT` | 사용할 테스트 계정 풀 크기 |
| `TEST_PASSWORD` | 테스트 계정 공통 비밀번호 |

주의:

```text
PROMETHEUS_RW_URL이 아니라 K6_PROMETHEUS_RW_SERVER_URL을 사용한다.
Prometheus URL은 /api/v1/write까지 포함한다.
```

### 실제 사용자 흐름 기반 E2E 시나리오 작성

단순 API 호출이 아니라 실제 쇼핑몰 사용자 흐름에 맞춘 E2E 부하테스트를 작성했다.

공통 흐름:

```text
VU별 최초 1회 로그인
-> 토큰 재사용
-> 상품 목록 조회
-> 상품 선택
-> 상품 상세 조회
-> 주문 생성
-> 결제
```

관련 파일:

| 파일 | 역할 |
|---|---|
| `load-test/k6/scripts/common-e2e.js` | 로그인, 상품 조회, 주문, 결제 공통 흐름 |
| `load-test/k6/scripts/stable-flow.js` | 안정 상황 시나리오 |
| `load-test/k6/scripts/spike-flow.js` | 스파이크 / 타임세일 시나리오 |
| `load-test/k6/scripts/failover-flow.js` | 노드 장애 복구 시나리오 |

계정 사용 방식:

```text
VU 1   -> test1@shoply.com
VU 2   -> test2@shoply.com
VU 200 -> test200@shoply.com
VU 400 -> test400@shoply.com
```

각 VU는 VU 번호에 맞는 테스트 계정을 사용한다. `ACCOUNT_COUNT`를 초과하는 경우에는 계정 번호를 순환해서 사용한다.
각 VU는 최초 1회만 로그인하고, 이후 반복에서는 발급받은 JWT 토큰을 재사용한다.

### 온프레미스 한계점 측정

온프레미스 환경에서 단계별 부하를 주며 한계점을 측정했다.

현재 해석 기준:

| 구간 | 판단 |
|---|---|
| 200 VUS | 안정 구간 |
| 300 VUS | 불안정 시작 |
| 400 VUS | 한계 접근 |
| 600 VUS | 한계 초과 |

해석:

- 200 VUS에서는 p95 응답시간, 실패율, worker CPU, Pending Pod가 안정적이었다.
- 300 VUS는 k6 지표만 보면 p95 응답시간과 실패율이 비교적 안정적이었지만, Grafana에서 Pending Pod와 worker CPU 상승이 관찰되어 Kubernetes 리소스 관점에서는 불안정 시작 구간으로 본다.
- 400 VUS는 안정 기준선의 약 2배로, 스파이크 시나리오에 사용한다.
- 600 VUS는 스파이크 시나리오라기보다 한계 초과/장애 유도에 가까워 공식 시나리오에서는 제외한다.

따라서 공식 안정 시나리오는 더 보수적으로 200 VUS를 기준 부하로 설정한다. 한계점 측정값은 공식 비교 시나리오와 분리해서 해석한다.

### 모니터링과 증거 자료 확보

Grafana와 Prometheus에서 아래 지표를 확인했다.

| 지표 | 의미 |
|---|---|
| VU | k6 가상 사용자 수 |
| RPS | 초당 요청 수 |
| HTTP 실패율 | 요청 실패 비율 |
| p95 응답시간 | 사용자 체감 지연 |
| Running Pod | 실행 중인 Pod 수 |
| Pending Pod | 노드 자원 부족 여부 |
| HPA Current / Desired | 현재/목표 replica 차이 |
| Worker CPU / Memory | 노드 자원 사용률 |
| Kubernetes Event | 스케줄링, BackOff, 장애 이벤트 |

테스트 중에는 `capture-loop.sh`로 Pod, HPA, Event, CPU 상태를 주기적으로 저장했다.

발표 자료로 활용할 수 있는 결과물:

- Grafana 캡처
- k6 실행 결과 캡처
- Kubernetes Event 캡처
- 자동 캡처 로그 압축 파일
- 부하테스트 시연 영상

## 최종 공식 시나리오

현재 공식 비교 실험은 아래 3개 시나리오를 기준으로 한다.

| 시나리오 | 목적 | 상품 수 | 최대 VUS | 총 시간 |
|---|---|---:|---:|---:|
| 안정 상황 | 평상시 기준선 비교 | 20개 분산 | 200 VUS | 10분 |
| 스파이크 / 타임세일 | 순간 집중 부하 비교 | 3개 집중 | 400 VUS | 8분 |
| 노드 장애 | 장애 복구 속도 비교 | 20개 분산 | 200 VUS | 12분 |

공식 시나리오는 온프레미스 한계점 측정 결과를 바탕으로 설정했다.

- 안정 상황은 200 VUS를 기준 부하로 사용한다.
- 스파이크는 안정 기준선의 약 2배인 400 VUS까지 급격히 증가시킨다.
- 노드 장애는 부하 한계가 아니라 복구 여부를 확인해야 하므로 안정 부하인 200 VUS에서 수행한다.
- 600 VUS는 온프레미스 한계 초과 구간으로 확인되어 공식 비교 시나리오에서는 제외하고 별도 한계점 측정 결과로 활용한다.

### 시나리오 1: 안정 상황

목적:

- 평상시 사용량에서 온프레미스와 AWS EKS가 안정적으로 동작하는지 비교
- p95 응답시간, 실패율, Pending Pod가 안정적인지 확인

흐름:

```text
0~1분: 100 VUS
1~2분: 200 VUS
2~8분: 200 VUS 유지
8~10분: 0 VUS 감소
```

실행 파일:

```text
load-test/k6/scripts/stable-flow.js
```

### 시나리오 2: 스파이크 / 타임세일

목적:

- 안정 기준선보다 갑자기 많은 사용자가 몰리는 상황 확인
- 특정 상품 3개에 트래픽을 집중시켜 타임세일 상황 재현
- p95 응답시간, 실패율, HPA, Pending Pod 변화를 확인

흐름:

```text
0~1분: 100 VUS
1~2분: 200 VUS
2~3분: 400 VUS
3~6분: 400 VUS 유지
6~8분: 0 VUS 감소
```

실행 파일:

```text
load-test/k6/scripts/spike-flow.js
```

### 시나리오 3: 노드 장애

목적:

- 안정 부하가 유지되는 상태에서 워커 노드 1대 장애 발생 시 복구 과정 확인
- Pod 재스케줄링, Pending Pod, p95 응답시간, 실패율, 복구 시간을 비교

흐름:

```text
0~1분: 100 VUS
1~2분: 200 VUS
2~5분: 200 VUS 유지
5분 시점: 워커 노드 1대 종료
5~10분: 200 VUS 유지하며 복구 관찰
10~12분: 0 VUS 감소
```

실행 파일:

```text
load-test/k6/scripts/failover-flow.js
```

노드 장애는 k6 코드에서 수행하지 않는다. 클러스터 권한이 있는 사람이 정해진 시점에 워커 노드 1대를 직접 종료한다.

## 실행 예시

k6 서버에서는 긴 `docker run` 명령 대신 `run-k6.sh`를 사용한다.

처음 한 번만 `.env`를 만든다.

```bash
cd ~/taegyu-k6
cp k6.env.example .env
vi .env
```

이후 실행:

```bash
./run-k6.sh stable
./run-k6.sh spike
./run-k6.sh failover
```

직접 `docker run`으로 안정 상황 시나리오를 실행할 수도 있다.

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

스파이크 시나리오:

```bash
docker run --rm --network host \
  -e BASE_URL=http://<SHOPLY_TARGET> \
  -e K6_PROMETHEUS_RW_SERVER_URL=http://<PROMETHEUS_IP>:9090/api/v1/write \
  -e ACCOUNT_COUNT=2000 \
  -e TEST_PASSWORD='Test1234!' \
  -v "$PWD/scripts:/scripts" \
  grafana/k6 run -o experimental-prometheus-rw /scripts/spike-flow.js
```

노드 장애 시나리오:

```bash
docker run --rm --network host \
  -e BASE_URL=http://<SHOPLY_TARGET> \
  -e K6_PROMETHEUS_RW_SERVER_URL=http://<PROMETHEUS_IP>:9090/api/v1/write \
  -e ACCOUNT_COUNT=2000 \
  -e TEST_PASSWORD='Test1234!' \
  -v "$PWD/scripts:/scripts" \
  grafana/k6 run -o experimental-prometheus-rw /scripts/failover-flow.js
```

## 앞으로 해야 할 일

### 1. AWS EKS 동일 조건 테스트

AWS EKS 환경이 준비되면 온프레미스와 같은 시나리오를 그대로 실행한다.

비교 조건:

- 같은 k6 스크립트
- 같은 VUS
- 같은 상품 수
- 같은 계정 수
- 같은 테스트 시간
- 같은 Prometheus/Grafana 기준

우선 실행할 테스트:

```text
AWS 안정 상황: 200 VUS
AWS 스파이크: 400 VUS
AWS 노드 장애: 200 VUS 유지 중 워커 노드 1대 종료
```

AWS가 공식 시나리오에서 안정적이면 AWS에 대해서만 추가 한계점 측정을 진행한다.

예시:

```text
500 VUS
600 VUS
700 VUS
```

### 2. 노드 장애 테스트 수행

온프레미스와 AWS EKS에서 각각 수행한다.

진행 방식:

```text
200 VUS 유지
5분 시점 워커 노드 1대 종료
10분까지 복구 과정 관찰
12분 종료
```

확인 지표:

- p95 응답시간
- HTTP 실패율
- Pending Pod
- Running Pod
- HPA Current / Desired
- Node 상태
- Kubernetes Event
- 복구 시간

### 3. 발표용 영상 촬영

추천 영상:

| 파일명 예시 | 내용 |
|---|---|
| `onprem-load-limit-demo.mp4` | 온프레미스 부하 한계 징후 |
| `node-failure-demo.mp4` | 노드 장애 발생 후 복구 과정 |
| `aws-comparison-demo.mp4` | AWS EKS 동일 조건 테스트 |

영상 구성:

```text
k6 실행 터미널
-> Grafana VU/RPS 증가
-> p95 / 실패율 변화
-> Pod / HPA / CPU 변화
-> k6 최종 결과
```

노드 장애 영상은 아래 흐름으로 촬영한다.

```text
200 VUS 유지
-> 워커 노드 1대 종료
-> Pending Pod / Pod 재배치 확인
-> p95 / 실패율 튀는 구간 확인
-> 정상화까지 걸린 시간 기록
```

### 4. PPT 비교표 작성

PPT에는 온프레미스와 AWS EKS를 같은 지표로 비교한다.

비교표 예시:

| 항목 | 온프레미스 | AWS EKS |
|---|---:|---:|
| 안정 상황 p95 | 측정값 | 측정값 |
| 안정 상황 실패율 | 측정값 | 측정값 |
| 스파이크 p95 | 측정값 | 측정값 |
| 스파이크 실패율 | 측정값 | 측정값 |
| Pending Pod | 측정값 | 측정값 |
| 복구 시간 | 측정값 | 측정값 |
| 노드 확장 여부 | 고정 노드 | EKS 노드그룹 / 오토스케일링 여부 확인 |

발표 핵심 메시지:

```text
동일한 애플리케이션과 동일한 사용자 시나리오를 기준으로
온프레미스와 AWS EKS 환경에 부하를 적용하고,
응답시간, 실패율, Pod 상태, HPA 반응, 복구 속도를 비교했다.
```

## 팀원에게 보고할 때 사용할 요약

현재 CI/CD 쪽은 GitHub Actions와 GHCR 기반으로 Docker 이미지 빌드/Push 구조를 잡았고, 부하테스트는 k6로 로그인, 상품 조회, 주문, 결제까지 이어지는 E2E 시나리오를 구성했다.

온프레미스 환경에서는 단계별 한계점 테스트를 진행했고, 200 VUS를 공식 안정 기준으로 판단했다. 300 VUS는 k6 지표만 보면 비교적 안정적이었지만 Pending Pod와 worker CPU 상승이 관찰되어 Kubernetes 리소스 관점에서는 불안정 시작 구간으로 보았다. 600 VUS는 한계 초과 구간으로 보아 공식 시나리오에서는 제외했다.

최종 비교 시나리오는 안정 상황 200 VUS, 스파이크 400 VUS, 노드 장애 200 VUS 유지 중 워커 노드 1대 종료로 정리했다.

앞으로는 같은 시나리오를 AWS EKS 환경에도 적용해 동일 조건 비교를 진행하고, 추가로 노드 장애 복구 속도와 AWS의 추가 한계점을 확인할 예정이다.

## 관련 문서

| 문서 | 내용 |
|---|---|
| `docs/experiment-plan.md` | 온프레미스 / AWS EKS 비교 실험 계획 |
| `load-test/k6/README.md` | k6 시나리오와 실행 방법 |
| `docs/load-test/k6-loadtest-server-guide.md` | k6 부하테스트 서버 구축 가이드 |
| `docs/load-test/k6-loadtest-troubleshooting.md` | k6 부하테스트 트러블슈팅 |
