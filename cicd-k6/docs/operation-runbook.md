# Shoply 온프레미스 vs AWS EKS 실험 런북

이 문서는 지금까지 구성한 Shoply MSA, CI/CD, Kubernetes, k6 부하테스트, Prometheus/Grafana 관찰 절차를 실험 당일 그대로 따라 할 수 있게 정리한 운영 런북이다.

현재 배포 기준은 Argo CD가 아니라 `kubectl apply -k`와 GitHub Actions/GHCR 기반이다. Argo CD 연동은 연결 실패로 실험 범위에서 제외한다.

## 1. 실험 목적

온프레미스 Kubernetes와 AWS EKS에 동일한 Shoply 애플리케이션 이미지를 배포하고, 동일한 k6 시나리오로 부하를 발생시켜 아래 차이를 비교한다.

| 비교 항목 | 온프레미스 | AWS EKS |
|---|---|---|
| 자원 확장 | 고정 노드 + HPA | HPA + Karpenter/노드 확장 |
| 한계 징후 | Pending Pod, CPU 상승, Error Rate 증가 | 노드 추가, Pod 재스케줄링, 확장 지연 |
| 핵심 메시지 | 고정 자원 환경의 한계 확인 | 클라우드 자동 확장 반응 확인 |

## 2. 실험 전 체크리스트

### 공통 체크

- [ ] 사용할 Git 브랜치와 커밋 SHA 확인
- [ ] 온프레미스와 AWS EKS가 동일한 GHCR 이미지 태그를 사용하는지 확인
- [ ] `latest` 대신 커밋 SHA 또는 명시적인 실험 태그 사용
- [ ] 테스트 전 DB 초기화 또는 동일 스냅샷 복구 완료
- [ ] DB 스키마와 초기 데이터가 동일한지 확인
- [ ] 상품/재고 데이터가 온프레미스와 AWS에서 동일한지 확인
- [ ] 이전 주문/결제 데이터가 결과에 영향을 주지 않는지 확인
- [ ] 테스트 계정 `test1@shoply.com`부터 필요한 수량까지 준비
- [ ] 테스트 계정 수와 비밀번호가 양쪽 환경에서 동일한지 확인
- [ ] Grafana 시간대와 테스트 실행 시간이 맞는지 확인
- [ ] k6 서버에서 온프레미스/AWS 대상 URL 접근 가능 여부 확인
- [ ] Prometheus remote write URL이 `/api/v1/write`까지 포함되는지 확인

### 로컬 저장소 확인

```bash
git status --short
git branch --show-current
git rev-parse --short HEAD
```

예상 구조:

```text
load-test/k6/
├── k6.env.example
├── run-k6.sh
├── schedule-k6.sh
└── scripts/
    ├── common-e2e.js
    ├── stable-flow.js
    ├── spike-flow.js
    └── failover-flow.js
```

## 3. CI/CD와 이미지 기준

현재 기준은 GitHub Actions에서 Docker 이미지를 빌드하고 GHCR에 push한 뒤, 온프레미스와 AWS EKS가 같은 이미지를 pull하는 구조다.

```text
코드 변경
-> GitHub Actions 실행
-> 서비스별 Docker 이미지 빌드
-> GHCR Push
-> Kubernetes에서 동일 이미지 Pull
```

이미지 예시:

```text
ghcr.io/ktk026/shoply-gateway:<commit-sha>
ghcr.io/ktk026/shoply-order:<commit-sha>
ghcr.io/ktk026/shoply-payment:<commit-sha>
```

현재 실험용으로 새로 빌드한 이미지 태그:

```text
ghcr.io/ktk026/shoply-frontend:app-1499b2e
ghcr.io/ktk026/shoply-gateway:app-1499b2e
ghcr.io/ktk026/shoply-user:app-1499b2e
ghcr.io/ktk026/shoply-product:app-1499b2e
ghcr.io/ktk026/shoply-inventory:app-1499b2e
ghcr.io/ktk026/shoply-order:app-1499b2e
ghcr.io/ktk026/shoply-payment:app-1499b2e
```

위 주소는 예시다. 현재 매니페스트와 workflow에 GHCR owner가 섞여 있을 수 있으므로 실험 전 실제 Deployment의 image 값을 확인해 하나로 통일한다.

```bash
kubectl get deploy -n shoply -o jsonpath='{range .items[*]}{.metadata.name}{" => "}{.spec.template.spec.containers[*].image}{"\n"}{end}'
```

확인 기준:

- GHCR owner가 문서, workflow, Kubernetes 매니페스트에서 일치하는지 확인한다.
- 온프레미스와 AWS EKS의 이미지 태그가 동일해야 한다.
- 서비스별 이미지 태그가 섞여 있으면 실험 결과 비교에서 제외하거나 재배포한다.
- `latest`는 재현성이 떨어지므로 가능하면 commit SHA 또는 명시적인 실험 태그를 사용한다.

GHCR private 이미지라면 각 클러스터에 pull secret이 필요하다.

```bash
kubectl create namespace shoply --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=<GITHUB_USERNAME> \
  --docker-password=<GITHUB_PAT> \
  --namespace=shoply
```

토큰은 문서, Git, 이슈, PR에 남기지 않는다.

## 4. 실험 직전 Pre-flight 점검

실험 당일 가장 중요한 것은 온프레미스와 AWS EKS를 혼동하지 않는 것이다. 특히 `kubectl apply -k` 실행 전에는 반드시 현재 접속 중인 Kubernetes context와 node 목록을 확인한다.

### 4.1 Kubernetes context 확인

```bash
kubectl config current-context
kubectl get nodes -o wide
```

확인 기준:

- 현재 context가 온프레미스인지 AWS EKS인지 확인한다.
- node 이름, Internal IP, Instance Type 등을 보고 실제 대상 클러스터가 맞는지 확인한다.
- context가 불명확하면 배포 명령을 실행하지 않는다.

가능하면 환경별 context를 명시해서 실행한다.

```bash
kubectl --context <ONPREM_CONTEXT> get nodes -o wide
kubectl --context <AWS_EKS_CONTEXT> get nodes -o wide
```

### 4.2 실제 배포 이미지 태그 확인

온프레미스와 AWS EKS는 반드시 동일한 Shoply 이미지 태그를 사용해야 한다.

```bash
kubectl get deploy -n shoply -o jsonpath='{range .items[*]}{.metadata.name}{" => "}{.spec.template.spec.containers[*].image}{"\n"}{end}'
```

확인 기준:

- GHCR owner가 문서와 실제 배포에서 일치하는지 확인한다.
- 온프레미스와 AWS EKS의 이미지 태그가 동일한지 확인한다.
- 서비스별 이미지 태그가 섞여 있으면 재배포 후 실험한다.

### 4.3 DB/재고 초기화 확인

주문/결제 부하테스트는 DB 상태와 재고 데이터를 변경한다. 따라서 테스트마다 동일한 초기 상태에서 시작해야 결과를 비교할 수 있다.

- [ ] 테스트 전 DB 초기화 또는 동일 스냅샷 복구 완료
- [ ] 상품/재고 데이터가 온프레미스와 AWS에서 동일한지 확인
- [ ] 이전 주문/결제 데이터가 결과에 영향을 주지 않는지 확인
- [ ] 테스트 계정 수와 비밀번호가 양쪽 환경에서 동일한지 확인

### 4.4 k6 결과 구분 태그 확인

Prometheus/Grafana에서 온프레미스와 AWS 결과가 섞이지 않도록 k6 실행 시 태그를 사용한다.

필수 태그:

```text
env=onprem 또는 aws
scenario=stable, spike, failover
run_id=<env>_<scenario>_YYYYMMDDHHMMSS
```

`schedule-k6.sh`는 아래 형태의 `run_id`를 자동으로 만든다.

```text
onprem_stable_20260625150000
aws_spike_20260625210000
```

Grafana에서는 결과 캡처 시 `env`, `scenario`, `run_id` 기준으로 필터링한다.

### 4.5 실험 5분 전 빠른 점검

```bash
kubectl config current-context
kubectl get nodes -o wide
kubectl get pods -n shoply -o wide
kubectl get hpa -n shoply
kubectl get events -n shoply --sort-by=.metadata.creationTimestamp
```

Shoply 접속 확인:

```bash
curl -I <BASE_URL>
curl <BASE_URL>/health
```

k6 서버 확인:

```bash
docker version
grep -E '^(BASE_URL|PROMETHEUS_URL|ACCOUNT_COUNT)=' .env.onprem
grep -E '^(BASE_URL|PROMETHEUS_URL|ACCOUNT_COUNT)=' .env.aws
```

## 5. Kubernetes 배포 절차

### 온프레미스

렌더링 확인:

```bash
kubectl kustomize msa_shoply/k8s/onprem
```

배포:

```bash
kubectl apply -k msa_shoply/k8s/onprem
```

확인:

```bash
kubectl get pods -n shoply -o wide
kubectl get svc -n shoply
kubectl get hpa -n shoply
kubectl get events -n shoply --sort-by=.metadata.creationTimestamp
```

### AWS EKS

EKS overlay가 준비된 경우 동일하게 렌더링과 적용을 진행한다.

```bash
kubectl kustomize msa_shoply/k8s/eks
kubectl apply -k msa_shoply/k8s/eks
```

확인:

```bash
kubectl get nodes -o wide
kubectl get pods -n shoply -o wide
kubectl get svc -n shoply
kubectl get hpa -n shoply
kubectl get events -n shoply --sort-by=.metadata.creationTimestamp
```

## 6. k6 서버 준비

k6 서버에서는 Docker 기반으로 `grafana/k6` 이미지를 실행한다. 예약 실행은 Ubuntu/Linux의 GNU `date`를 사용하므로 macOS 로컬이 아니라 k6 서버에서 실행한다.

처음 한 번 설정:

```bash
cd ~/taegyu-k6

cp k6.env.example .env.onprem
cp k6.env.example .env.aws

vi .env.onprem
vi .env.aws

chmod +x run-k6.sh schedule-k6.sh
```

`.env.onprem` 예시:

```env
BASE_URL=http://<ONPREM_SHOPLY_URL>
PROMETHEUS_URL=http://<PROMETHEUS_IP>:9090/api/v1/write
ACCOUNT_COUNT=2000
TEST_PASSWORD=Test1234!
```

`.env.aws` 예시:

```env
BASE_URL=http://<AWS_SHOPLY_URL>
PROMETHEUS_URL=http://<PROMETHEUS_IP>:9090/api/v1/write
ACCOUNT_COUNT=2000
TEST_PASSWORD=Test1234!
```

Prometheus를 환경별로 따로 운영하면 각 환경의 Prometheus 주소를 넣는다. 모니터링 서버가 하나라면 `.env.onprem`과 `.env.aws`의 `PROMETHEUS_URL`은 같고, 보통 `BASE_URL`만 달라진다.

설정 확인:

```bash
grep -E '^(BASE_URL|PROMETHEUS_URL|ACCOUNT_COUNT)=' .env.onprem
grep -E '^(BASE_URL|PROMETHEUS_URL|ACCOUNT_COUNT)=' .env.aws
```

## 7. k6 실행 절차

### 즉시 실행

환경별 파일을 쓰지 않는 즉시 실행은 `.env`를 읽는다.

```bash
cd ~/taegyu-k6
cp k6.env.example .env
vi .env

./run-k6.sh stable
./run-k6.sh spike
./run-k6.sh failover
```

### KST 기준 예약 실행

환경별 설정 파일을 명확히 나눠 실행하려면 `schedule-k6.sh`를 사용한다.

```bash
./schedule-k6.sh onprem stable "2026-06-25 15:00:00"
./schedule-k6.sh aws stable "2026-06-25 17:00:00"
./schedule-k6.sh onprem spike "2026-06-25 19:00:00"
./schedule-k6.sh aws spike "2026-06-25 21:00:00"
./schedule-k6.sh onprem failover "2026-06-26 15:00:00"
./schedule-k6.sh aws failover "2026-06-26 17:00:00"
```

예약 실행 시 k6에는 아래 태그가 자동으로 붙는다.

| 태그 | 예시 |
|---|---|
| `env` | `onprem`, `aws` |
| `scenario` | `stable`, `spike`, `failover` |
| `run_id` | `onprem_stable_20260625150000` |

장시간 예약은 터미널 연결이 끊기면 같이 종료될 수 있으므로 `tmux`에서 실행한다.

```bash
tmux new -s k6-test
cd ~/taegyu-k6
./schedule-k6.sh aws stable "2026-06-25 17:00:00"
```

분리:

```text
Ctrl+B -> D
```

다시 접속:

```bash
tmux attach -t k6-test
```

예약 취소:

```text
Ctrl+C
```

### 온프레미스/AWS 동시 예약 실행

온프레미스와 AWS EKS를 같은 시각, 같은 시나리오, 같은 부하로 비교하려면 두 환경의 예약 시간을 동일하게 맞춘다. 예약 프로세스는 환경별로 분리된 `tmux` 세션에서 실행하는 것을 권장한다.

예시: 2026년 6월 25일 15:00:00 KST에 안정 상황 테스트를 동시에 시작한다.

첫 번째 터미널:

```bash
tmux new -s k6-onprem-stable
cd ~/taegyu-k6
./schedule-k6.sh onprem stable "2026-06-25 15:00:00"
```

두 번째 터미널:

```bash
tmux new -s k6-aws-stable
cd ~/taegyu-k6
./schedule-k6.sh aws stable "2026-06-25 15:00:00"
```

각 세션에서 `Ctrl+B -> D`로 분리한다.

진행 상황 확인:

```bash
tmux ls
tmux attach -t k6-onprem-stable
tmux attach -t k6-aws-stable
```

스파이크와 장애 테스트도 같은 방식으로 시각만 동일하게 맞춘다.

```bash
./schedule-k6.sh onprem spike "2026-06-25 16:00:00"
./schedule-k6.sh aws spike "2026-06-25 16:00:00"

./schedule-k6.sh onprem failover "2026-06-25 17:00:00"
./schedule-k6.sh aws failover "2026-06-25 17:00:00"
```

주의사항:

- 두 명령의 `START_KST`는 초 단위까지 동일하게 맞춘다.
- `.env.onprem`과 `.env.aws`의 `BASE_URL`이 각각 정확한 환경을 가리키는지 확인한다.
- 모니터링 서버가 하나라면 `PROMETHEUS_URL`은 같을 수 있다.
- Grafana에서는 `env`, `scenario`, `run_id` 태그로 onprem/aws 결과를 분리해서 본다.
- 두 테스트를 동시에 실행하면 k6 서버 한 대가 두 환경에 동시에 부하를 발생시키므로, k6 서버 CPU/네트워크가 병목이 아닌지 함께 확인한다.

## 8. 공식 시나리오

| 시나리오 | 명령 인자 | 파일 | 최대 VUS | 총 시간 | 목적 |
|---|---|---|---:|---:|---|
| 안정 상황 | `stable` | `scripts/stable-flow.js` | 200 | 10분 | 평상시 기준선 확인 |
| 스파이크 | `spike` | `scripts/spike-flow.js` | 400 | 8분 | 순간 집중 부하와 병목 확인 |
| 노드 장애 | `failover` | `scripts/failover-flow.js` | 200 | 12분 | 워커 노드 장애 복구 확인 |

공통 사용자 흐름:

```text
VU별 최초 1회 로그인
-> 토큰 재사용
-> 상품 목록 조회
-> 상품 상세 조회
-> 주문 생성
-> 결제
```

## 9. 시나리오별 운영 절차

### 9.1 안정 상황

목적:

- 온프레미스와 AWS EKS가 평상시 기준 부하에서 안정적으로 동작하는지 확인
- P95 latency, Error Rate, Pod/Node CPU를 기준선으로 기록

실행:

```bash
./schedule-k6.sh onprem stable "YYYY-MM-DD HH:MM:SS"
./schedule-k6.sh aws stable "YYYY-MM-DD HH:MM:SS"
```

관찰:

```bash
kubectl get pods -n shoply -o wide
kubectl get hpa -n shoply
kubectl top pods -n shoply
kubectl top nodes
```

### 9.2 스파이크

목적:

- 짧은 시간에 주문/결제 트래픽이 몰릴 때 환경별 반응 확인
- 온프레미스의 Pending Pod와 AWS EKS의 노드 확장 반응 비교

실행:

```bash
./schedule-k6.sh onprem spike "YYYY-MM-DD HH:MM:SS"
./schedule-k6.sh aws spike "YYYY-MM-DD HH:MM:SS"
```

관찰:

```bash
kubectl get hpa -n shoply -w
kubectl get pods -n shoply -o wide -w
kubectl get events -n shoply --sort-by=.metadata.creationTimestamp
```

### 9.3 노드 장애

목적:

- 안정 부하가 유지되는 상태에서 워커 노드 1대 장애 발생 시 복구 과정 확인
- 부하 한계가 아니라 장애 복구 능력을 보기 위한 테스트

진행:

```text
1. failover 시나리오 실행
2. 200 VU 유지 구간 진입 확인
3. 장애 대상 노드와 해당 노드의 주요 Pod 기록
4. 5분 시점에 워커 노드 1대 중지
5. Pod 재스케줄링과 복구 완료 시각 기록
6. Grafana, Prometheus, kubectl event로 복구 과정 관찰
```

장애 대상 노드 선정:

```bash
kubectl get nodes -o wide
kubectl get pods -n shoply -o wide
```

기록 항목:

```text
장애 대상 노드:
중지 시각:
해당 노드에 있던 주요 Pod:
복구 완료 시각:
```

주의사항:

- DB, Prometheus, Grafana 등 실험 관찰에 필요한 컴포넌트가 있는 노드는 중지하지 않는다.
- 온프레미스에서는 워커 노드 1대를 중지한다.
- AWS EKS에서는 EC2 인스턴스 중지 또는 노드 종료 후 EKS/Karpenter 반응을 관찰한다.
- `kubectl drain`은 정상 유지보수 절차에 가까우므로, 장애 상황 실험에서는 EC2 stop/terminate 방식이 더 적합하다.

실행:

```bash
./schedule-k6.sh onprem failover "YYYY-MM-DD HH:MM:SS"
./schedule-k6.sh aws failover "YYYY-MM-DD HH:MM:SS"
```

확인 항목:

- MTTR
- Pending Pod 발생 여부
- Pod 재스케줄링 시간
- 주문/결제 실패 건수
- EKS Node Count 증가 시점

## 10. Grafana/Prometheus 관찰 지표

| 지표 | 의미 |
|---|---|
| RPS/TPS | 초당 처리량 |
| P95 latency | 사용자 체감 응답 지연 |
| Error Rate | 요청 실패율 |
| VU | k6 가상 사용자 수 |
| Pod Count | Running Pod 수 |
| Pending Pod | 노드 자원 부족 여부 |
| HPA current/desired | 현재 replica와 목표 replica 차이 |
| Node CPU/Memory | 노드 자원 사용률 |
| EKS Node Count | Karpenter/노드 확장 여부 |

Grafana 확인:

```text
1. 테스트 시작 전 Last 15 minutes 또는 실행 시간 범위로 설정
2. k6 VU/RPS 증가 확인
3. P95 latency와 Error Rate 확인
4. Pod/Node CPU와 Pending Pod 확인
5. 테스트 종료 후 같은 시간 범위로 캡처 저장
```

## 11. 결과 기록 템플릿

실험 1회가 끝날 때마다 아래 형식으로 기록한다.

```md
## <YYYY-MM-DD> <환경> <시나리오>

- 환경: onprem / aws
- 시나리오: stable / spike / failover
- 이미지 태그:
- 시작 KST:
- 종료 KST:
- BASE_URL:
- Prometheus URL:

### 실험 조건

- Git commit SHA:
- 이미지 태그:
- GHCR owner:
- Kubernetes context:
- HPA min/max replicas:
- Pod requests/limits:
- 온프레 노드 수:
- AWS 초기 노드 수:
- AWS 최대 노드 수:
- Karpenter 사용 여부:
- 테스트 전 DB 초기화 여부:
- 상품/재고 데이터 동일 여부:

### k6 태그

- env:
- scenario:
- run_id:

### k6 결과

- 최대 VUS:
- 평균 RPS:
- P95 latency:
- Error Rate:
- 실패 요청 수:

### Kubernetes 관찰

- 최대 Pod 수:
- Pending Pod 발생 여부:
- HPA desired 최대값:
- Node CPU 최대값:
- Node Count 변화:

### 확장 관찰

- HPA scale-out 시작 시각:
- HPA desired 최대값:
- 새 Pod 생성 시각:
- 새 Pod Running 시각:
- Pending 최초 발생 시각:
- Pending 지속 시간:
- AWS 새 Node 생성 시각:
- AWS 새 Node Ready 시각:

### 장애 테스트 정보

- 장애 대상 노드:
- 중지 시각:
- 해당 노드에 있던 주요 Pod:
- Pod 재스케줄링 시작 시각:
- 복구 완료 시각:
- MTTR:

### 장애/특이사항

- ImagePullBackOff:
- FailedScheduling:
- OOMKilled:
- Restart 증가:
- 5xx 에러:

### 판단

- 안정 / 불안정 / 한계 접근 / 한계 초과:
- 근거:

### 증빙

- Grafana 캡처:
- k6 터미널 캡처:
- kubectl 이벤트 캡처:
- 영상 파일:
```

## 12. 장애 대응

### k6 결과가 Grafana에 보이지 않음

확인:

```bash
grep PROMETHEUS_URL .env.onprem
grep PROMETHEUS_URL .env.aws
```

점검 기준:

- URL이 `/api/v1/write`까지 포함되어 있는지 확인
- Prometheus remote write receiver가 켜져 있는지 확인
- Grafana 시간 범위가 테스트 실행 시간과 겹치는지 확인

### k6가 대상 서버에 접속하지 못함

확인:

```bash
curl -I http://<SHOPLY_TARGET>
curl http://<SHOPLY_TARGET>/health
```

점검 기준:

- k6 서버 보안그룹 outbound 허용
- Shoply 서비스 보안그룹 inbound 허용
- NodePort/Ingress/LoadBalancer 주소 확인

### GHCR 이미지 pull 실패

확인:

```bash
kubectl get pods -n shoply
kubectl describe pod <POD_NAME> -n shoply
kubectl get secret ghcr-secret -n shoply
```

점검 기준:

- `ghcr-secret` 존재 여부
- GitHub PAT `read:packages` 권한
- Deployment의 imagePullSecrets 설정
- 이미지 태그 오타

### Pod가 Pending 상태로 남음

확인:

```bash
kubectl describe pod <POD_NAME> -n shoply
kubectl get nodes -o wide
kubectl top nodes
kubectl get events -n shoply --sort-by=.metadata.creationTimestamp
```

해석:

- 온프레미스에서는 고정 노드 자원 한계일 수 있다.
- AWS EKS에서는 Karpenter/노드그룹 확장 지연 또는 리소스 요청값 문제일 수 있다.

## 13. 실험 종료 후 정리

```bash
kubectl get pods -n shoply -o wide
kubectl get hpa -n shoply
kubectl get events -n shoply --sort-by=.metadata.creationTimestamp
```

필요 시 스케일 원복:

```bash
kubectl scale deployment <DEPLOYMENT_NAME> -n shoply --replicas=<기준값>
```

증빙 파일 정리:

```text
results/
├── onprem-stable/
├── onprem-spike/
├── onprem-failover/
├── aws-stable/
├── aws-spike/
└── aws-failover/
```

## 14. 최종 발표용 메시지

평상시 트래픽에서는 온프레미스도 충분히 안정적으로 운영될 수 있다.

차이는 트래픽이 급증하거나 장애가 발생했을 때 나타난다. 온프레미스는 고정 자원의 한계가 Pending Pod와 Error Rate로 드러나고, AWS EKS는 자동 확장을 통해 노드와 Pod를 늘리며 복구/확장을 시도한다.

이 실험의 핵심은 “어느 쪽이 무조건 빠르다”가 아니라, 같은 애플리케이션과 같은 부하 조건에서 인프라 구조 차이가 어떤 운영 지표로 드러나는지 보여주는 것이다.
