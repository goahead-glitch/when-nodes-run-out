# runbook — 처음부터 다시 세우는 실행 문서 (AMI 없이)

클러스터를 처음부터 세울 때 실제로 보고 따라 하던 문서들입니다. 팀 저장소 `Incheon-soda/shoply`의 `문서/` 폴더(2026-06-12 기준)에서 **재구축에 필요한 것만** 골라 구축 순서대로 번호를 다시 매겼습니다.

> ⚠️ **현재 AMI 백업이 없습니다.** 클러스터를 다시 세우려면 이 문서들로 처음부터 구축해야 합니다. 다 세우면 바로 [qcow2 백업](../BACKUP-RESTORE.md#qcow2-수동-백업--pc-보관-무료)을 떠 두세요.
>
> 6/12 시점 문서라 이후 바뀐 부분(VM 4대 · worker3 운영 노드 등)은 각 문서 맨 위와 아래 "재구축 순서"에 적어 뒀습니다. 문서 안의 `doc13`은 레포에 남아 있지 않은 설치 문서(01번의 후속판)를 가리킵니다.

## 문서 목록

| # | 문서 | 내용 | 원본 번호 |
|---|---|---|---|
| 01 | [호스트 EC2 · KVM · k8s 설치](01_호스트_KVM_k8s_설치.md) | 중첩 가상화 → 디스크 확장 → KVM → VM(cloud-init) → containerd · kubeadm → Flannel → Ingress → 모니터링 포트 | 06 |
| 02 | [진입 — MetalLB · DNAT](02_진입_MetalLB_DNAT.md) | EIP · libvirt DHCP 범위 조정 · MetalLB · ingress LoadBalancer · 호스트 DNAT | 14 |
| 03 | [외부 서버 설치](03_외부서버_설치.md) | DB · Redis · 모니터링 · 부하 EC2 | 07 |
| 04 | [데이터베이스](04_데이터베이스.md) | PostgreSQL · Redis 스키마, 구축, 검증 | 02 |
| 05 | [모니터링](05_모니터링.md) | Prometheus · Grafana · Loki 구성과 수집 이유 | 03 |
| 06 | [포트 · 보안그룹](06_포트_보안그룹.md) | 인바운드 포트 | 08 |

**뺀 문서와 이유**

| 원본 | 이유 |
|---|---|
| 01 온프레미스 · 09 아키텍처 | 개요 — [`../README.md`](../README.md), [`../../docs/architecture.md`](../../docs/architecture.md)에 최종본 있음 |
| 04 부하테스트 · 05 시나리오 · 10 동일화 | 실험 계획 — 재구축과 무관, 최종본은 [`../../docs/`](../../docs/) |
| 11 트러블슈팅 | 최종본 [`../TROUBLESHOOTING.md`](../TROUBLESHOOTING.md)(20건)에 포함 |
| 12 내 역할 | 6/12 시점 역할 기록 — 재구축과 무관 |
| 15 VM 백업 · 복원 | [`../BACKUP-RESTORE.md`](../BACKUP-RESTORE.md) qcow2 섹션으로 옮김 |
| 16 ArgoCD | 실제로 쓰지 않음 |

## 처음부터 다시 세우는 순서

| 순서 | 할 일 | 문서 |
|---|---|---|
| 1 | 호스트 EC2(c8i-flex.2xlarge 스팟, launch template에서 중첩 가상화 켬) · 디스크 확장 · KVM 설치 | 01 — 0~2단계 |
| 2 | VM 생성(cloud-init) · DNS · 공통 OS 설정 · containerd · kubeadm/kubelet/kubectl | 01 — 3~6단계 (**VM은 worker3까지 4대**) |
| 3 | `kubeadm init` / `join` · Flannel | 01 — 7~8단계, 막히면 [`../TROUBLESHOOTING.md`](../TROUBLESHOOTING.md) |
| 4 | **노드 역할 부여 — worker3 운영 노드 격리** | 아래 "노드 역할" |
| 5 | MetalLB · ingress-nginx LoadBalancer · 호스트 DNAT | 02 (DNAT는 [`../scripts/host-network.sh`](../scripts/host-network.sh)로 대체 가능) |
| 6 | DB · Redis · 모니터링 EC2 | 03 · 04 · 05, 보안그룹은 06 |
| 7 | 앱 배포 | [`../k8s/README.md`](../k8s/README.md) |
| 8 | 모니터링 포트 · exporter | 01 — 11단계, 05 |
| 9 | **다 되면 바로 백업** — VM IP 고정 → qcow2 백업 | [`../BACKUP-RESTORE.md`](../BACKUP-RESTORE.md#qcow2-수동-백업--pc-보관-무료) |

### 노드 역할 (01번 이후 추가된 단계)

01번은 VM 3대 기준입니다. 이후 Nginx Ingress · kube-state-metrics 같은 운영 파드가 실험 워커의 자원을 쓰지 않도록 **worker3를 추가해 taint로 격리**했습니다(팀 저장소 `문서/onprem/인프라_설계.md`).

```bash
# master VM
kubectl label node k8s-worker1 experiment-role=worker1
kubectl label node k8s-worker2 experiment-role=worker2
kubectl label node k8s-worker3 experiment-role=ops
# worker3 taint — toleration 없는 파드는 못 들어옴
kubectl taint node k8s-worker3 dedicated=ops:NoSchedule
```
