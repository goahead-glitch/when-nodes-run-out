# when-nodes-run-out — 통합 브랜치 (develop)

## 프로젝트 개요

온프레미스 Kubernetes와 AWS EKS에 **동일한 쇼핑몰 MSA 앱**을 똑같이 배포하고, **노드 자동확장 유무** 하나만 다르게 두어 트래픽 폭증·노드 장애 상황에서 두 인프라가 어떻게 다르게 버티는지 데이터로 비교하는 실험 프로젝트입니다. 앱·부하·k8s 설정은 전부 동일하게 맞추고(통제변수), 온프레미스는 고정 워커, EKS는 Karpenter로 노드를 자동 추가한다는 점만 다르게 둡니다(독립변수).

실제로 온프레미스에 부하를 올려본 결과, 노드 수가 4개로 고정된 채 동시접속이 2000명까지 올라가자 **Pending 파드가 0→7개까지 쌓이고 P95 6.54초·k6 실패율 최대 6%**까지 치솟는 한계 지점을 관측했습니다. EKS 쪽 구축·비교는 팀원 담당이라 진행 중입니다.

## 팀 구성 및 역할 분담

5명, 2개 팀(온프레미스 팀 / EKS 팀) 구성입니다.

| 팀 | 담당 | 비고 |
|---|---|---|
| 온프레미스 팀 | **본인**(앱·온프레미스 인프라·배포) | 이 레포의 범위 |
| | 팀원D(모니터링), 팀원E(부하·시나리오·CI/CD) | 일부 작업물은 공용으로 포함 |
| EKS 팀 | 팀원A·B(EKS 구축) | 이 레포에 미포함(terraform, k8s/eks) |

담당 흐름: **앱 빌드 → 온프레 인프라 구축 → 서비스 배포 → 실험**. 자세한 역할은 [`docs/project-roles.md`](docs/project-roles.md) 참고.

## 환경 동일화 (온프레 ↔ EKS 핵심값)

| 항목 | 값 |
|---|---|
| HPA | target CPU **70%**, min **2** / max **10** (gateway/product/inventory/order/payment) |
| 리소스 | request 100m / limit 500m (frontend 50m/200m) |
| K8s 버전 | 1.34 |
| DB | PostgreSQL 16, `max_connections=300`, 앱 pool max 8 |
| 진입 | Nginx Ingress, NodePort **30080** (ALB/NLB는 통제변수라 안 씀) |
| 노드 자동확장 | **온프레: 없음(고정) / EKS: Karpenter** ← 유일한 독립변수 |

전체 비교표(진입 경로, K8s 구성요소 대조 등)는 [`docs/homogenization.md`](docs/homogenization.md).

## 포트 정리

| 포트 | 위치 | 용도 |
|:---:|---|---|
| 80 / 443 | 온프레 EC2(iptables DNAT) | 외부 진입 → MetalLB VIP |
| 30080 | Nginx Ingress | NodePort 진입 |
| 4000~4005 | 앱 컨테이너 | gateway/product/inventory/order/payment/user |
| 30400~30404 | 앱 메트릭 | 서비스별 `/metrics` NodePort |
| 30800 | kube-state-metrics | 파드/노드/Pending 상태 |
| 39101~39103 | node_exporter | 워커별 NodePort |
| 38080/38081 | cAdvisor | worker1/2 |
| 5432 / 6379 | PostgreSQL / Redis | 공용 DB·캐시 EC2 |
| 9187 / 9121 | postgres_exporter / redis_exporter | DB·캐시 메트릭 |
| 9090 / 9091 | Prometheus(온프레) / Prometheus(EKS 전용, k6 remote-write만) | |
| 3000 / 3100 / 3200 | Grafana / Loki / Tempo | 모니터링 스택 |

## app — 쇼핑몰 MSA 서비스 (+ PostgreSQL, Redis)

Express(TypeScript) 서비스 7개 + React 프론트엔드. 품질 우선순위는 UI가 아니라 **실험 재현성·API 로직·DB 정합성**입니다.

| 서비스 | 포트 | 핵심 역할 |
|---|:---:|---|
| gateway | 4000 | API 진입점, 프록시 + Prometheus 메트릭 |
| product | 4001 | 상품 조회, Redis 캐시(목록 60초/상세 30초) |
| inventory | 4002 | 재고, **`SELECT FOR UPDATE`로 초과판매 방지** |
| order | 4003 | 주문 생성(재고 예약→저장), inventory 호출 5초 타임아웃 |
| payment | 4004 | Mock 결제(95% 성공), 실패 시 재고 예약 해제 |
| user | 4005 | 로그인(bcrypt+JWT) |
| frontend | 80 | React UI |

DB는 PostgreSQL 16(테이블마다 소유 서비스가 있는 MSA 구조), 캐시는 Redis 7(`allkeys-lru`, 주 사용처는 product). 둘 다 별도 EC2에서 Docker Compose로 운영하며 온프레/EKS 양쪽이 공유하는 통제변수입니다. DB 페일오버 대응으로 `connectionTimeoutMillis`+`keepAlive`+`pool.on('error')`를 넣었고, `/livez`(liveness)와 `/health`(readiness)를 분리해 의존 서비스가 죽어도 재시작 루프에 안 빠지게 했습니다. 이미지는 GitHub Actions로 빌드해 GHCR에 푸시합니다.

## onprem — 온프레미스 인프라

AWS EC2 위 **KVM 가상머신 4대**(master + worker1/2 실험용 + worker3 운영격리)로 물리 온프레미스 k8s를 재현했습니다. 중첩가상화가 기본 비활성이라 launch template로 켜서 KVM을 띄웠고, kubeadm으로 클러스터를 직접 구성(Flannel CNI, Nginx Ingress). KVM VM은 공인 IP가 없어 호스트 EC2의 iptables DNAT로 트래픽을 포워딩합니다.

k8s 매니페스트는 Deployment/Service/HPA/ConfigMap/Secret/Ingress로 구성했고, ConfigMap에 DB/Redis 사설 IP를 넣어야 한다는 걸 재구축을 반복하며 깨달았습니다. 대표적으로 겪은 문제: kube-apiserver가 loopback 방화벽 DROP으로 CrashLoop에 빠진 것(재부팅 후 방화벽 룰 오염), frontend의 nginx가 존재하지 않는 Service 이름(`gateway` vs `gateway-svc`)을 찾다 죽은 것. 20건의 트러블슈팅 전체 기록과 스팟 호스트 AMI 백업/복원 절차는 `onprem` 브랜치의 `TROUBLESHOOTING.md`/`BACKUP-RESTORE.md`에 있습니다.

## monitoring — Prometheus / Grafana / Loki

별도 EC2에 Docker Compose로 구성. Prometheus가 앱 메트릭(gateway~payment)·cAdvisor(파드별 CPU/메모리)·node_exporter·kube-state-metrics(Pending 등)를 스크랩하고, Loki가 앱 로그+k8s 이벤트를 모아 Grafana Explore에서 조회 가능하게 했습니다. Grafana 대시보드는 RPS/P95/HPA replica/Pending 파드 수를 5초 주기로 보여줍니다. OpenTelemetry(Tempo)는 붙여서 작동은 확인했지만("쓸만한지 보려는 탐색적 시도") 실제 비교 실험에는 사용하지 않았습니다.

## k6 — 부하 테스트 (기본)

유저 흐름(홈→상품→주문→결제)을 시뮬레이션합니다. 두 시나리오가 있습니다: `scenario.js`(10웨이브×200명, sleep 없이 최대 부하 — 노드 한계 탐색용)와 `scenario-wave.js`(think time 포함, 3웨이브가 겹치며 최대 300명 — 현실적 부하 재현용). 실행 전 `load-test-prep.sql`로 재고를 리셋합니다.

## 실험 설계

시나리오 1(안정 200 RPS) → 2(스파이크, 급증+유지가 핵심 ★) → 3(worker1 강제 종료, MTTR 측정) 순서로 진행합니다. 시나리오 2·3 모두 "급증/장애 직후"가 아니라 "유지 구간"에서 온프레(계속 Pending·에러) vs EKS(Karpenter 회복)의 차이가 드러나도록 설계했습니다. 자세한 설계와 진행 상황은 [`docs/experiments.md`](docs/experiments.md).

## 더 자세히 보려면

- 컴포넌트별 상세(설계 결정·트러블슈팅·실행법·이미지)는 `app`/`onprem`/`공용` 브랜치의 README.md
- 프로젝트 전체를 짧게 보려면 `main` 브랜치의 README.md
