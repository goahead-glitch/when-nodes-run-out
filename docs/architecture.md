# 아키텍처 상세 — 트래픽 경로·작업 흐름·포트

전체 그림은 [루트 README](../README.md#인프라-구성도)의 구성도를 먼저 보고, 여기서 계층별 흐름을 깊게 봅니다.

## 사용자 요청 흐름 (트래픽 경로)

```mermaid
flowchart TB
  U["사용자 / k6"]
  EIP["c8i EC2 (EIP 공인IP)<br/>:80 / :443"]
  DNAT["호스트 iptables DNAT<br/>(-d 호스트IP)"]
  VIP["MetalLB VIP<br/>(worker3 L2/ARP 광고)"]
  ING["Nginx Ingress Pod (worker3)"]
  GW["API Gateway :4000"]
  SVC["각 마이크로서비스 Pod"]
  DB[("PostgreSQL / Redis")]

  U -->|"http(s)"| EIP
  EIP --> DNAT
  DNAT --> VIP
  VIP --> ING
  ING -->|"/api/*"| GW
  ING -->|"/"| FE["Frontend :80"]
  GW --> SVC
  SVC --> DB
```

KVM VM에 공인 IP가 없어 EC2가 80/443을 받아 MetalLB VIP로 넘기는 **NAT 포워딩 홉이 한 번 더 있습니다**(EKS엔 없음 → 응답시간은 변화율%로 보정). Ingress 이후 라우팅은 `/api/*` → gateway, `/` → frontend로 나뉘고, gateway가 다시 각 서비스로 프록시합니다.

## 쇼핑 플로우 (앱 내부 흐름)

```mermaid
flowchart LR
  A["홈 접속"] --> B["로그인<br/>(test1~2000)"]
  B --> C["상품 조회<br/>(Product, Redis 캐시)"]
  C --> D["주문 생성<br/>(Order → Inventory 재고 예약)"]
  D --> E["결제<br/>(Payment, Mock 95%)"]
  E -->|성공| F["재고 차감 + 주문완료"]
  E -->|실패| G["재고 예약 해제"]
```

## 엔지니어 작업 흐름 (구축 → 배포 → 실험)

```mermaid
flowchart TB
  subgraph BUILD["① 앱 빌드"]
    s1["7개 서비스 개발"] --> s2["Dockerfile"] --> s3["git push → GitHub Actions → GHCR"]
  end
  subgraph INFRA["② 온프레미스 인프라"]
    i1["EC2(중첩가상화) 기동"] --> i2["KVM VM 4대 생성<br/>(cloud-init)"]
    i2 --> i3["kubeadm init + join"] --> i4["Flannel·Ingress·MetalLB"]
    i4 --> i5["worker3 taint 격리<br/>+ iptables DNAT"]
  end
  subgraph DEPLOY["③ 서비스 배포"]
    d1["매니페스트<br/>(Deploy/HPA/ConfigMap/Secret/Ingress)"] --> d2["kubectl apply"]
    d2 --> d3["배포 검증<br/>(로그인·주문·결제)"]
  end
  subgraph MON["④ 모니터링 구축"]
    m1["Prometheus/Grafana/Loki<br/>EC2에 Docker Compose"] --> m2["스크랩 타겟 등록<br/>(app/cadvisor/node/kube-state)"]
    m2 --> m3["Grafana 대시보드 구성"]
  end
  subgraph EXP["⑤ 실험"]
    e1["load-test-prep.sql<br/>재고 리셋"] --> e2["k6 부하 (계단식 ↑)"]
    e2 --> e3["Pending 발생 = 한계"]
  end
  BUILD --> INFRA --> DEPLOY --> MON --> EXP
```

## 인프라 구축 상세 흐름

```mermaid
flowchart TB
  a["중첩가상화 Launch Template"] --> b["c8i.2xlarge 스팟 기동"]
  b --> c["KVM/libvirt 설치"]
  c --> d["cloud-init으로 VM 4대 초기화<br/>master/worker1·2·3"]
  d --> e["각 VM: containerd·kubeadm·kubelet"]
  e --> f["master: kubeadm init<br/>(ip_forward 선적용)"]
  f --> g["worker: kubeadm join"]
  g --> h["Flannel CNI 적용"]
  h --> i["metrics-server·Nginx Ingress·MetalLB"]
  i --> j["노드 라벨/taint<br/>experiment-role, dedicated=ops"]
  j --> k["호스트 iptables DNAT<br/>(80/443 + 메트릭 포트)"]
```

## 실험 측정 흐름 (한계 RPS 찾기)

```mermaid
flowchart TB
  p1["load-test-prep.sql 실행"] --> p2["Grafana 대시보드 띄움"]
  p2 --> p3["k6: 낮은 VU부터 시작"]
  p3 --> p4{"계단식으로 VU 증가<br/>매 단계 확인"}
  p4 -->|"Pending 없음"| p3
  p4 -->|"Pending 발생"| p5["그 순간 지표 캡처<br/>(Pending 수·P95·실패율)"]
```

| 한계 신호 | 확인 |
|---|---|
| **Pending 발생** ★ | `kubectl get pods --field-selector=status.phase=Pending` |
| 워커 CPU 90%+ | `kubectl top nodes` |
| HPA CURRENT=MAX | `kubectl get hpa` |

> 한계의 정의 = Pending Pod이 처음 뜨는 지점입니다.

## 노드 장애 시나리오 흐름 (시나리오 3 — 미실행)

```mermaid
flowchart TB
  n["worker1 강제 종료<br/>(Ingress·Gateway·Product·Inventory 다운)"]
  n --> resch["모든 파드 worker2로 재스케줄"]
  resch --> pend["worker2(2vCPU/4GB) 자원 부족 → Pending"]
  pend --> onprem["온프레: 사람이 노드 수동 재시작<br/>(virsh start) — 분 단위"]
  pend --> eks["EKS(예정): Karpenter 새 노드 자동 추가<br/>— 약 60초"]
```

> 시나리오 3(MTTR 측정)은 시간 제약으로 실행하지 못한 설계안입니다 — [실험 문서](experiments.md) 참고.

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
