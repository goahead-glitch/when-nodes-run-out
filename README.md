# when-nodes-run-out

> 동일한 앱, 동일한 트래픽, 다른 인프라 — 데이터가 말하게 한다.

**"클라우드는 트래픽 폭증에 강하다"는 통념, 진짜일까?** 이커머스 타임세일처럼 트래픽이 순간 폭증하는 상황을 가정하고, 동일한 쇼핑몰 MSA 앱을 **온프레미스 Kubernetes(노드 고정)** 와 **AWS EKS(Karpenter 노드 자동확장)** 에 똑같이 배포한 뒤, **"노드 자동확장 유무" 단 하나만 변수로 남기고** 부하를 걸어 데이터로 비교한 실험 프로젝트입니다.

온프레미스에서 Pending 파드가 쌓이는 것은 실패가 아니라 **측정하려는 현상 그 자체**입니다.

![Shoply 홈 화면](docs/images/app-homepage.png)

## 1. 핵심 결과

**① 고정 자원의 한계를 숫자로 관측했다.** 노드 4개 고정 상태에서 동시접속을 0→2000 VU까지 올리자 Running 파드가 33개까지 늘어난 뒤 — **Pending 파드 0→7개, P95 레이턴시 6.54초, 실패율 최대 6%**로 무너지는 지점을 포착했습니다.

![온프레미스 한계 도달 — Pending 파드 발생](docs/images/limit-found-pending-pods.png)

**② "자동확장이 있어도 공짜는 아니다."** 양쪽 Prometheus를 하나의 Grafana에 붙인 반반 비교 대시보드로 동일 부하(300 VU)를 관측한 결과 — 온프레는 Pending 6\~7개가 수 분간 지속된 반면, EKS는 Karpenter가 노드를 3→8개로 늘렸음에도 **Pending이 최대 12개까지 두 차례 스파이크친 뒤에야 해소**됐습니다. 노드 프로비저닝 시간(60\~90초) 동안은 EKS도 버티지 못한다는, 통념을 보정하는 결과입니다.

![온프레미스 vs EKS 비교 — 부하 유지 구간](docs/images/onprem-eks-comparison-spike.png)

→ 상세 수치·실험 설계·[68초 실황 영상](docs/videos/onprem-vs-eks-300vu-load-test.mp4): [`docs/experiments.md`](docs/experiments.md) · 공정 비교를 위한 통제변수 설계: [`docs/homogenization.md`](docs/homogenization.md)

## 2. 인프라 구성도

![온프레미스 전체 아키텍처](docs/images/onprem-architecture.png)

```
사용자/k6 → EC2(EIP, iptables DNAT) → MetalLB VIP → Nginx Ingress
             └ KVM VM 4대 (master + worker1·2 실험용 + worker3 운영격리)
                  └ MSA 7개 서비스 (HPA)
                       ├→ PostgreSQL / Redis  (별도 EC2, 양쪽 공유 통제변수)
                       └→ Prometheus / Grafana / Loki (별도 EC2, 양쪽 동시 관측)
```

온프레미스는 AWS EC2 위에 **KVM 가상머신 4대로 물리 클러스터를 재현**했습니다(kubeadm 직접 구성). EKS와의 비교 구성도와 트래픽 경로·포트 상세는 [`docs/architecture.md`](docs/architecture.md)에 있습니다.

![온프레미스 vs AWS EKS 아키텍처 비교](docs/images/onprem-vs-eks-architecture.svg)

## 3. 내 역할 — 앱부터 실험까지 엔드투엔드

5명 팀에서 **온프레미스 사이드 전체**를 담당했습니다.

```
[앱 빌드]       MSA 7개 서비스 개발 → Docker 이미지 → GHCR          → app/
[온프레 인프라]  EC2 → KVM VM 4대 → kubeadm 클러스터 → 네트워크      → onprem/
[서비스 배포]   매니페스트(Deploy/HPA/Ingress) 작성 → 배포 → 검증     → onprem/k8s/
[모니터링]      Prometheus/Grafana/Loki 구축 → 비교 대시보드          → monitoring/
[실험]          시나리오 설계 → 부하 → 한계 관측 → EKS와 비교 분석     → docs/experiments.md
```

| 폴더 | 담당 | 내용 |
|---|---|---|
| `app/` `onprem/` `monitoring/` `k6/` `postgres/` `redis/` `userdata/` `docs/` | **본인** | 위 흐름 전체 — 이 프로젝트의 핵심 |
| `team/` | 팀원 | EKS 인프라(Terraform)·EKS 서비스 배포·CI/CD 운영 — **비교 참고용** |

팀 구성과 역할 경계의 상세: [`docs/project-roles.md`](docs/project-roles.md)

## 4. 사용 기술

| 영역 | 스택 |
|---|---|
| 앱 | Node.js 22 · Express · TypeScript · React 19 |
| 인프라 | Kubernetes(kubeadm) · KVM/libvirt · Docker · AWS EC2(스팟) |
| 네트워크 | Flannel · MetalLB · Nginx Ingress · iptables DNAT |
| 데이터 | PostgreSQL 16 · Redis 7 |
| 관측 | Prometheus · Grafana · Loki |
| 부하·CI/CD | k6 · GitHub Actions → GHCR |

## 5. 장애 사례와 해결

클러스터를 수차례 재구축하며 겪은 **장애 20건을 전부 기록**했고([`onprem/TROUBLESHOOTING.md`](onprem/TROUBLESHOOTING.md)), 그중 진단 과정에 이야기가 있는 4건은 `증상 → 로그 → 원인 → 왜 그렇게 판단했는가 → 해결 → 재발 방지`로 깊게 회고했습니다.

| 장애 | 진단의 핵심 |
|---|---|
| [kube-apiserver 먹통 — loopback 방화벽 DROP](docs/incidents/01-kube-apiserver-loopback-firewall.md) | `refused`(리스너 없음)와 `timeout`(패킷이 버려짐)의 차이로 방화벽을 역추적 |
| [flannel 전멸 — br_netfilter 미로드](docs/incidents/02-flannel-br-netfilter.md) | 에러 두 개의 인과관계를 따라 커널 계층까지 내려감 |
| [외부 접속 불가 — DNAT 누락/불일치](docs/incidents/03-dnat-external-access.md) | curl 실패 "방식"으로 원인을 3갈래 분류하는 진단 트리 + 광역 DNAT가 만든 2차 장애 |
| [모니터링 타겟 다운](docs/incidents/04-monitoring-targets-down.md) | "일부만 살아있다"는 단서로 고장난 계층 특정 — 조용한 실패는 체크리스트로 잡는다 |

## 6. 배운 점

- **서버 하나를 "운영"하는 일의 무게를 알게 됐다.** VM을 만들어 돌리는 것 자체가 쉽지 않았고, 켜두는 것만으로 비용이 나간다. 비싼 인스턴스를 스팟으로 돌리고, 비용 부담에 매번 끄고 켜며 클러스터를 처음부터 다시 세워야 했다.
- **반복이 문서를 만들고, 문서가 속도를 만든다.** 가장 오래 막힌 건 KVM 구축이었다. 처음엔 설치·세팅·연결 하나하나가 전부 오래 걸렸지만, 절차를 문서로 고정하고 나중엔 AMI 이미지로 구워두니 재구축 시간이 크게 단축됐다. 여러 번 다시 세우다 보니 전에 겪은 오류가 또 나와도 대처가 빨라졌다 — 트러블슈팅 20건을 기록한 이유이기도 하다.
- **"변수 하나만 남기는" 통제는 생각보다 훨씬 어렵다.** 최대한 비슷하게 설계했다고 믿었지만 프로젝트 후반에 인스턴스 타입이 다르다는 걸 발견해 수정했고, 서비스 파드 리소스는 맞췄어도 데몬셋·모니터링 파드의 리소스까지는 통제하지 못했다. 실험 설계는 세부까지 신중해야 한다는 걸 결과로 배웠다.
- **두 팀 사이의 소통이 실험 품질을 결정한다.** 온프레 팀과 EKS 팀으로 나뉘어 진행하다 보니 서로 소통하기가 어려웠고, 동일화가 완벽하지 못해 결과가 살짝 아쉬웠다. 다시 한다면 EKS가 제공하는 걸 더 깊게 활용하고, 배포 전에 리소스값 하나하나까지 양쪽을 맞춰서 제대로 실험해보고 싶다.

이 경험 전체가 클라우드 엔지니어라는 목표로 이어진다 — 여기서 배우고 부딪힌 것들을 실무에서 그대로 써먹어보고 싶다.

## 저장소 안내

```
├── app/          # MSA 7개 서비스 + React 프론트 (코드·설계 결정·CI/CD)
├── onprem/       # KVM·kubeadm 클러스터 구축, 매니페스트, 트러블슈팅 20건, 백업/복원
├── monitoring/   # Prometheus·Grafana·Loki 구성, 온프레-EKS 비교 대시보드
├── k6/           # 부하 시나리오 2종 + 실행 결과
├── postgres/ redis/ userdata/   # 공유 DB·캐시·EC2 부트스트랩
├── docs/         # 문서 허브 — 실험·아키텍처·장애 회고 (docs/README.md부터)
└── team/         # ⚠️ 팀원 작성 파트 (EKS 인프라·배포·CI/CD) — 비교 참고용
```

| 브랜치 | 용도 |
|---|---|
| `main` | 완성본 (지금 보고 있는 것) |
| `app` / `onprem` / `shared` | 컴포넌트별 작업 이력 아카이브 |
| `develop` | 컴포넌트 브랜치 통합·검증 이력 |

> ⚠️ `team/` 하위(EKS 인프라 Terraform, EKS 서비스 배포, CI/CD 운영)는 **팀원이 작성**했습니다. 본인 성과가 아니며, 비교·참고를 위해 원문 그대로 보관합니다 — 각 폴더 README 상단에도 동일하게 표기해뒀습니다.
