# runbook — 원본 실행 문서 (AMI 이전)

클러스터를 처음부터 세우고 운영할 때 실제로 보고 따라 하던 문서들입니다. 팀 저장소 `Incheon-soda/shoply`의 `문서/` 폴더(2026-06-12 기준)에서 옮겼습니다.

> ⚠️ **현재 AMI 백업이 없습니다.** 클러스터를 다시 세우려면 이 문서들로 처음부터 구축해야 합니다. 그래서 정리본과 별도로 원본을 그대로 보관합니다.
>
> 6/12 시점 기록이라 이후 바뀐 부분(VM 4대 · worker3 운영 노드 · MetalLB 진입 · HPA max 99 등)이 있습니다. 각 문서 맨 위에 최종 정리본 링크와 바뀐 점을 적어 뒀습니다. 문서 안의 `doc13`은 레포에 남아 있지 않은 설치 문서(06번의 후속판)를 가리킵니다.

## 문서 목록

| # | 문서 | 내용 |
|---|---|---|
| 01 | [온프레미스](01_온프레미스.md) | 온프레미스 구성 개요 |
| 02 | [데이터베이스](02_데이터베이스.md) | PostgreSQL · Redis 스키마, 구축, 검증 |
| 03 | [모니터링](03_모니터링.md) | Prometheus · Grafana · Loki 구성과 수집 이유 |
| 04 | [부하테스트](04_부하테스트.md) | k6 실행, 재고 리셋, 한계치 측정 방법 |
| 05 | [시나리오](05_시나리오.md) | 실험 시나리오 계획 (노드 장애는 미실행) |
| 06 | [설치 — k8s on KVM](06_설치_k8s_KVM.md) | **EC2 중첩 가상화 → KVM → VM → kubeadm → Flannel → Ingress → 모니터링 포트** 단계별 구축 |
| 07 | [설치 — 서버](07_설치_서버.md) | DB · Redis · 모니터링 · 부하 EC2 설치 |
| 08 | [포트 정리](08_포트정리.md) | 인바운드 포트 |
| 09 | [아키텍처](09_아키텍처.md) | 트래픽 흐름 |
| 10 | [동일화](10_동일화.md) | 온프레 ↔ EKS 통제변수 (EKS 구축 전 목표값) |
| 11 | [트러블슈팅](11_트러블슈팅.md) | 구축 중 겪은 문제 (최종본은 `../TROUBLESHOOTING.md`) |
| 12 | [내 역할](12_내역할.md) | 6/12 시점 역할 · 진행 기록 |
| 14 | [진입 — MetalLB](14_도메인_MetalLB.md) | EIP · DHCP 범위 조정 · MetalLB · ingress LoadBalancer · DNAT |
| 15 | [VM 백업 / 복원](15_VM백업_복원.md) | qcow2 수동 백업 (정리본은 `../BACKUP-RESTORE.md`) |

13번은 레포에 남아 있지 않고, 16번(ArgoCD)은 실제로 쓰지 않아 옮기지 않았습니다.

## 처음부터 다시 세우는 순서 (AMI 없이)

| 순서 | 할 일 | 문서 |
|---|---|---|
| 1 | 호스트 EC2(c8i-flex.2xlarge 스팟, launch template에서 중첩 가상화 켬) · 디스크 확장 · KVM 설치 | 06 — 0~2단계 |
| 2 | VM 생성 (cloud-init) · DNS · 공통 OS 설정 · containerd · kubeadm/kubelet/kubectl | 06 — 3~6단계 (**VM은 worker3까지 4대**로 생성) |
| 3 | `kubeadm init` / `join` · Flannel | 06 — 7~8단계, 막히면 11 · `../TROUBLESHOOTING.md` |
| 4 | **노드 역할 부여 — worker3 운영 노드 격리** | 아래 "노드 역할" |
| 5 | MetalLB · ingress-nginx LoadBalancer · 호스트 DNAT | 14 (DNAT는 `../scripts/host-network.sh`로 대체 가능) |
| 6 | DB · Redis · 모니터링 EC2 | 07 · 02 · 03 |
| 7 | 앱 배포 | [`../k8s/README.md`](../k8s/README.md) |
| 8 | 모니터링 포트 · exporter | 06 — 11단계, 03 |
| 9 | **다 되면 바로 백업** — VM IP 고정 → qcow2 백업 | 15 · [`../BACKUP-RESTORE.md`](../BACKUP-RESTORE.md) |

### 노드 역할 (06번 이후 추가된 단계)

06번은 VM 3대 기준입니다. 이후 Nginx Ingress · kube-state-metrics 같은 운영 파드가 실험 워커의 자원을 쓰지 않도록 **worker3를 추가해 taint로 격리**했습니다(팀 저장소 `문서/onprem/인프라_설계.md`).

```bash
# master VM
kubectl label node k8s-worker1 experiment-role=worker1
kubectl label node k8s-worker2 experiment-role=worker2
kubectl label node k8s-worker3 experiment-role=ops
# worker3 taint — toleration 없는 파드는 못 들어옴
kubectl taint node k8s-worker3 dedicated=ops:NoSchedule
```
