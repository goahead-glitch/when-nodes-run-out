# when-nodes-run-out — 통합 브랜치 (develop)

## 프로젝트 개요

> 동일한 앱, 동일한 트래픽, 다른 인프라 — 데이터가 말하게 한다.

온프레미스 Kubernetes와 AWS EKS에 **동일한 쇼핑몰 MSA 앱**을 똑같이 배포하고, **노드 자동확장 유무** 하나만 다르게 두어 트래픽 폭증·노드 장애 상황에서 두 인프라가 어떻게 다르게 버티는지 데이터로 비교하는 실험 프로젝트입니다.

이커머스 타임세일처럼 트래픽이 순간 폭증하는 상황에서, "자체 인프라(온프레미스)"와 "클라우드 관리형(EKS)"이 실제로 얼마나 다르게 버티는지 막연한 통념이 아니라 숫자로 확인하고 싶어서 시작했습니다. 앱·부하·k8s 설정은 전부 동일하게 맞추고(통제변수), 온프레미스는 고정 워커, EKS는 Karpenter로 노드를 자동 추가한다는 점만 다르게 둡니다(독립변수). 온프레미스에서 Pending이 쌓이는 것은 실패가 아니라 **측정하려는 현상 그 자체**입니다.

![Shoply 홈 화면](docs/images/app-homepage.png)

### 확인한 핵심 결과

실제로 온프레미스에 부하를 계속 올려본 결과, 고정 자원의 한계에 도달하는 순간을 관측했습니다. 노드 수는 4개로 고정된 채 동시접속 VU를 0→2000까지 램프업하자 Running 파드가 33개까지 늘었고, 이후 **Pending 파드가 0→7개까지 쌓이면서 P95 레이턴시 6.54초, k6 실패율이 최대 6%**까지 치솟았습니다.

![온프레미스 한계 도달 — Pending 파드 발생](docs/images/limit-found-pending-pods.png)

EKS 쪽 구축·비교는 팀원 담당이라 진행 중입니다.

## 팀 구성 및 역할 분담

5명, 2개 팀(온프레미스 팀 / EKS 팀) 구성으로, 동일한 앱·동일 기준으로 두 환경을 각각 구축·실험합니다.

| 팀 | 담당 | 비고 |
|---|---|---|
| 온프레미스 팀 | **본인**(앱 개발·온프레미스 인프라 구축·서비스 배포·실험) | 이 레포의 범위 |
| | 팀원D(모니터링), 팀원E(부하 테스트·시나리오·CI/CD) | 일부 작업물(monitoring/k6)은 실제 사용 범위라 공용으로 포함 |
| EKS 팀 | 팀원A·B(EKS 클러스터 구축) | 이 레포에 미포함(terraform, k8s/eks 오버레이) — EKS도 이 레포의 앱 이미지·매니페스트를 동일하게 사용하므로 동일화 기준만 제공 |

담당 흐름은 아래와 같습니다.

```
[앱 빌드]        7개 서비스 코드 → Docker 이미지 → GHCR
    ↓
[온프레 인프라]  EC2 → KVM VM 4대 → k8s 클러스터 → 네트워크
    ↓
[서비스 배포]    매니페스트(Deploy/HPA/Ingress) → 클러스터 배포 → 검증
    ↓
[실험]          시나리오 1/2/3 → 한계·MTTR 측정 → 결과 분석
```

역할의 상세 배경(왜 이렇게 나뉘었는지, 각자 무엇을 검증했는지)은 [`docs/project-roles.md`](docs/project-roles.md)에 정리했습니다.

## 환경 동일화 (온프레 ↔ EKS)

두 환경을 공정하게 비교하려면 무엇을 통제변수로 맞추고 무엇을 독립변수로 남길지 못박아야 합니다. **온프레미스가 기준**이고, EKS는 이 값에 맞춥니다.

![온프레미스 vs AWS EKS 아키텍처 비교](docs/images/onprem-vs-eks-architecture.png)

| 구분 | 항목 | 값 |
|---|---|---|
| 완전 동일(통제변수) | HPA | target CPU **70%**, min **2** / max **10** (gateway/product/inventory/order/payment) |
| | 리소스 | request 100m / limit 500m (frontend 50m/200m) — request를 작게 둬서 HPA가 민감하게 발동 |
| | K8s 버전 | 1.34 |
| | DB/캐시 | PostgreSQL 16(`max_connections=300`), Redis 7, 앱 pool max 8 |
| | 진입 | Nginx Ingress, NodePort **30080** — ALB/NLB는 트래픽 경로를 오염시키므로 일부러 안 씀 |
| 비슷하게(최대 근접) | 노드 스펙 | 2vCPU/4GB 동일(KVM VM ↔ t3.medium류) |
| | CNI | Flannel(온프레) ↔ AWS VPC CNI(EKS) — 구현은 다르나 측정 대상 아님 |
| 의도적으로 다르게(독립변수) | **노드 자동확장** ★ | **온프레: 고정 워커(안 늘어남) / EKS: Karpenter(자동 추가)** — 유일한 핵심 변수 |
| | 진입 경로 | 온프레는 EC2 iptables DNAT 1홉 추가(VM에 공인 IP 없음) → 응답시간은 절대값이 아닌 변화율(%)로 비교해 상쇄 |

전체 비교표(노드별 배치, 포트 전체, K8s 구성요소 대조, 동일화 검증 명령)는 [`docs/homogenization.md`](docs/homogenization.md)에 있습니다.

## 포트 정리

| 포트 | 위치 | 용도 |
|:---:|---|---|
| 80 / 443 | 온프레 EC2(iptables DNAT) | 외부 진입 → MetalLB VIP |
| 30080 | Nginx Ingress | NodePort 진입(양쪽 동일) |
| 4000~4005 | 앱 컨테이너 | gateway/product/inventory/order/payment/user |
| 30400~30404 | 앱 메트릭 | 서비스별 `/metrics` NodePort |
| 30800 | kube-state-metrics | 파드/노드/Pending 상태 |
| 39101~39103 | node_exporter | 워커별 NodePort |
| 38080/38081 | cAdvisor | worker1/2 (worker3 ops 노드는 toleration으로 추가 배치) |
| 5432 / 6379 | PostgreSQL / Redis | 공용 DB·캐시 EC2 |
| 9187 / 9121 | postgres_exporter / redis_exporter | DB·캐시 메트릭 |
| 9090 / 9091 | Prometheus(온프레) / Prometheus(EKS 전용) | EKS 쪽은 k6 remote-write 수신만 담당 |
| 3000 / 3100 / 3200 | Grafana / Loki / Tempo | 모니터링 스택, Tempo는 OTLP `4317`(gRPC)/`4318`(HTTP)도 사용 |

## app — 쇼핑몰 MSA 서비스 (+ PostgreSQL, Redis)

Express(TypeScript) 서비스 7개 + React 19 프론트엔드(TanStack Router, Tailwind v4). 품질 우선순위는 UI 완성도가 아니라 **실험 재현성·API 로직·DB 정합성**입니다.

| 서비스 | 포트 | 핵심 역할 |
|---|:---:|---|
| gateway | 4000 | 모든 API 진입점. `/api/*`를 각 서비스로 프록시 + Prometheus 메트릭 수집, 프록시 대상이 죽으면 503 즉시 응답 |
| product | 4001 | 상품 목록/상세 조회, Redis 캐시(목록 60초/상세 30초) |
| inventory | 4002 | 재고 관리, **`SELECT FOR UPDATE`로 동시성 제어**(reserve/deduct/release) — 동시 주문 몰림에도 초과판매 방지 |
| order | 4003 | 주문 생성(재고 예약→저장, 트랜잭션), inventory 호출에 5초 타임아웃(노드 장애 시 무한 대기 방지) |
| payment | 4004 | Mock 결제(95% 성공률), 성공 시 재고 차감·실패 시 예약 해제 |
| user | 4005 | 로그인/인증(bcrypt 해시 + JWT) |
| frontend | 80 | React 쇼핑몰 UI — 상품/타임세일/주문/결제/로그인/어드민/통계 |

### 설계 결정

- **DB 페일오버 대응**: `pg.Pool`에 `connectionTimeoutMillis: 5000`·`keepAlive: true` + `pool.on('error', ...)` — idle 커넥션이 끊겨도 프로세스가 죽지 않게, Primary DB가 죽는 노드 장애 시나리오에서 크래시 루프에 안 빠지도록 했습니다.
- **liveness/readiness 분리**: `/livez`(프로세스 생존)와 `/health`(DB까지 확인)를 나눠, DB가 죽었을 때 전체 파드가 재시작 루프에 빠지는 걸 막았습니다.
- **Redis 캐시 TTL 차등**: 목록 60초/상세 30초 — 상세는 재고 반영이 더 즉각적이어야 해서 짧게 뒀습니다. 주 사용처는 product 서비스(`allkeys-lru` 정책, `--save ""`로 영속성 끔 — 캐시는 유실돼도 DB에서 재생성되므로).
- **PostgreSQL**: 16, 테이블마다 소유 서비스가 있는 MSA 구조(`users`→user, `products`→product, `inventory`→inventory, `orders`/`order_items`→order, `payments`→payment). `max_connections=300`으로 파드 다수 × 커넥션풀 합산에 대응.

두 DB/캐시 모두 별도 EC2에서 Docker Compose로 운영하며 온프레/EKS 양쪽이 공유하는 통제변수입니다. 이미지는 GitHub Actions(`ci.yml`/`cd.yml`/`cd-otel.yml`)로 빌드해 GHCR에 푸시합니다.

## onprem — 온프레미스 인프라

![온프레미스 전체 아키텍처](docs/images/onprem-architecture.png)

AWS EC2 위 **KVM 가상머신 4대**(master + worker1/2 실험용 + worker3 운영격리)로 물리 온프레미스 k8s를 재현했습니다.

### 구축 과정

c8i-flex.2xlarge 스팟 인스턴스는 중첩가상화가 기본 비활성이라, 처음엔 LXD 컨테이너로 구성했다가 launch template를 만들어 중첩가상화를 명시적으로 켜서 KVM을 띄웠습니다. cloud-init으로 VM을 초기화하고 containerd·kubeadm/kubelet/kubectl을 직접 설치(자동화 없이), `kubeadm init` + worker `join`, Flannel v0.26.7, Nginx Ingress(helm) 순으로 구성했습니다.

![kubectl get node 결과](docs/images/onprem-kvm-nodes.png)
> 4개 노드(master + worker1/2/3) 모두 Ready.

### 네트워크

KVM VM은 공인 IP가 없어 호스트 EC2의 iptables DNAT로 외부 트래픽을 포워딩합니다.

![iptables DNAT 규칙](docs/images/onprem-iptables-dnat.png)
> 80/443은 MetalLB VIP로, 앱/노드 메트릭 포트는 각 VM으로 포워딩.

### 배포와 트러블슈팅

k8s 매니페스트는 Deployment/Service/HPA/ConfigMap/Secret/Ingress로 구성했고, **ConfigMap에 DB/Redis 사설 IP를 넣어야 파드가 DB에 붙는다**는 걸 재구축을 반복하며 깨달았습니다. 대표적으로 겪은 문제:

- **kube-apiserver CrashLoopBackOff**: 재부팅 후 오염된 방화벽 룰이 loopback 트래픽까지 DROP해서 apiserver가 etcd에 못 붙음. `connection refused`가 아니라 `i/o timeout`이 뜨는 패턴으로 원인을 역추적.
- **frontend CrashLoopBackOff**: nginx가 존재하지 않는 Service 이름(`gateway` vs 실제 `gateway-svc`)을 찾다 죽음 → 같은 selector의 alias Service 추가로 해결.
- **flannel CrashLoopBackOff**: `br_netfilter` 모듈 미로드 — 재부팅마다 반복되는 문제라 결국 모듈 자동로드를 영구화.

20건의 트러블슈팅 전체 기록과 스팟 호스트 AMI 백업/복원 절차(재부팅마다 반복되는 삽질을 "무삽질"로 만든 영구화 방법 포함)는 `onprem` 브랜치의 `TROUBLESHOOTING.md`/`BACKUP-RESTORE.md`에 있습니다.

### HPA 반응 확인

![부하 시 HPA 상태](docs/images/onprem-hpa-under-load.png)
> gateway는 CPU 66%로 replicas 10(max)까지, product는 61%로 7개까지 확장. 트래픽이 적은 서비스는 min(2)에 머무름.

## monitoring — Prometheus / Grafana / Loki

별도 모니터링 EC2에 Docker Compose로 구성했습니다.

| 컴포넌트 | 역할 |
|---|---|
| Prometheus(`:9090`) | 앱 메트릭(gateway~payment)·cAdvisor(파드별 CPU/메모리)·node_exporter·kube-state-metrics(Pending 등) 스크랩 + k6 remote-write 수신 |
| Prometheus-EKS(`:9091`) | EKS는 인증 없이 자체 스크랩이 어려워 k6 remote-write 수신 전용 |
| Loki(`:3100`) | 클러스터 로그·이벤트 저장(Promtail·event-exporter가 push) |
| Grafana(`:3000`) | 위를 데이터소스로 묶어 대시보드 제공 |

![Grafana 대시보드](docs/images/monitoring-grafana-dashboard.png)
> RPS·P95 레이턴시·HPA replica 수·서비스별 CPU/메모리 사용률을 5초 주기로 갱신.

![Prometheus 타겟 상태](docs/images/monitoring-prometheus-targets.png)
> app-onprem 5개, cadvisor-onprem 2개, kube-state-onprem 1개 타겟 모두 UP.

![Loki 로그 + k8s 이벤트 조회](docs/images/monitoring-loki-logs.png)
> Grafana Explore에서 앱 로그(nginx 액세스 로그)와 k8s 이벤트(HPA 스케일 이벤트 등)를 같은 화면에서 시간순 조회.

Tempo(OpenTelemetry 트레이싱)도 붙여서 작동 확인은 했습니다 — 다만 이건 "일단 붙여보고 쓸만한지 확인해보자"는 탐색적 시도였고, 실제 비교 실험(시나리오 1/2/3)에는 사용하지 않았습니다. 온프레/EKS 비교에 필요한 지표는 Prometheus/Grafana 메트릭만으로 충분히 관찰 가능했기 때문입니다.

## k6 — 부하 테스트

유저 흐름(홈→상품 조회→주문→결제)을 시뮬레이션합니다.

| 스크립트 | 목적 | 부하 프로파일 |
|---|---|---|
| `scenario.js` | 노드 한계 탐색 — sleep 없이 최대 부하 | 10웨이브×200명, 1분 간격 → 9분 시점 최대 2000명 동시 접속, 총 14분 |
| `scenario-wave.js` | 현실적 부하 재현 — think time 포함 | 100명씩 3웨이브가 2분 간격으로 시작, 각 7분 유지 → 4~7분 구간에 3웨이브 겹쳐 최대 300명, 이후 계단식 하강 |

![k6 실행 결과 예시](docs/images/k6-run-result.png)
> 1800 VUs 기준 55만여 건 요청, 결제 실패율 93%까지 치솟은 사례 — 노드 자원이 한계에 도달했을 때 결제 단계부터 무너지는 걸 확인했습니다(`http_req_duration p(95)<3000` 임계값 초과로 테스트 실패 종료).

실행 전 `load-test-prep.sql`로 20개 상품의 재고를 9999로 리셋해 재고 고갈로 인한 실험 오염을 방지합니다. Grafana에는 k6 공식 대시보드(ID 18030, Prometheus Native Histograms)를 임포트해서 씁니다.

## 실험 설계

앱·부하·설정을 전부 동일하게 맞추고 딱 하나(노드 자동확장)만 다르게 둡니다.

| 시나리오 | 내용 | 관찰 대상 |
|---|---|---|
| 1 — 안정 | 200 RPS를 10~20분 유지 | 양쪽 다 정상(Error 0%) → 신뢰 형성 |
| 2 — 스파이크 ★ | 0~5분 200 RPS → 5분에 1500 RPS로 급증 → 5~15분 유지 | **유지 구간**에서 온프레는 Pending 지속·에러 지속, EKS는 Karpenter가 60~90초 내 노드 추가 후 회복 |
| 3 — 노드 장애 | 500 RPS 유지 중 5분 후 worker1 강제 종료 | worker1에 몰린 서비스가 전부 worker2로 재스케줄 → 온프레는 Pending·수동 복구(수 분), EKS는 Karpenter 자동 복구(30~60초) |
| 4 (선택) — DB 페일오버 | Primary DB 강제 종료 | 온프레 Replica 수동 승격 vs RDS Multi-AZ 자동 — 실행 여부 미정 |

시나리오 2·3 모두 "급증/장애 직후"가 아니라 **"유지 구간"**에서 차이가 드러나도록 설계했습니다 — HPA가 파드를 늘리는 데도, Karpenter가 노드를 추가하는 데도 시간이 걸리기 때문에 짧은 스파이크는 반응 전에 끝나버립니다. 진행 순서, 결과 기록 템플릿, 지금까지의 진행 상황(위 "확인한 핵심 결과" 포함)은 [`docs/experiments.md`](docs/experiments.md)에 정리했습니다.

## 더 자세히 보려면

- 컴포넌트별 상세(설계 결정 전체·트러블슈팅 20건·백업복원 절차·실행법)는 `app`/`onprem`/`공용` 브랜치의 README.md
- 프로젝트를 짧게 훑어보려면 `main` 브랜치의 README.md
