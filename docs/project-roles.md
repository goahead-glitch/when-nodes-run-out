# 프로젝트 역할

## 한 줄 요약

동일한 쇼핑몰 MSA 앱을 온프레미스 k8s와 AWS EKS에 똑같이 올리고, 트래픽 폭증·노드 장애 상황에서 두 인프라가 어떻게 다르게 버티는지를 데이터로 비교하는 실험입니다.

## 팀 구성 (5명, 2개 팀)

| 팀 | 담당 |
|---|---|
| 온프레미스 팀 | **본인**(앱·인프라·배포) / 팀원D(모니터링) / 팀원E(부하·시나리오·CI/CD) |
| EKS 팀 | 팀원A·B(EKS 구축) |

동일한 앱·동일 기준으로 두 환경을 각각 구축·실험합니다.

## 이 레포에 담긴 담당 범위

이 레포(`when-nodes-run-out`)는 팀 전체 산출물 중 **본인이 실제로 만들고 운영한 부분**만 브랜치별로 정리했습니다.

| 브랜치 | 담당 내용 |
|---|---|
| `app` | 쇼핑몰 MSA 7개 서비스(gateway/product/inventory/order/payment/user/frontend) 코드·로직·이미지 |
| `onprem` | 온프레미스 인프라 전체 — EC2 위 KVM 가상머신으로 k8s 클러스터 구축, 네트워크(iptables DNAT), k8s 매니페스트, 배포, 백업/복원 |
| `공용`(monitoring/k6/postgres/redis/userdata) | 모니터링 스택 구성, k6 부하 시나리오, 공용 DB/캐시, EC2 부트스트랩 |

**이 레포에 없는 것**(팀원 담당): `terraform`(인프라 프로비저닝), EKS 클러스터 구축 및 `k8s/eks` 매니페스트.

## 담당 4영역 (실제 작업 흐름)

```
[앱 빌드]        7개 서비스 코드 → Docker 이미지 → GHCR
    ↓
[온프레 인프라]  EC2 → KVM VM 4대 → k8s 클러스터 → 네트워크
    ↓
[서비스 배포]    매니페스트(Deploy/HPA/Ingress) → 클러스터 배포 → 검증
    ↓
[실험]          시나리오 1/2/3 → 한계·MTTR 측정 → 결과 분석
```

### 1. 앱 빌드
쇼핑몰 MSA 7개 서비스의 코드·로직·이미지를 담당. 백엔드는 Express(TypeScript), 프론트는 React. 재고 동시성(`SELECT FOR UPDATE`)으로 동시 주문이 몰려도 초과판매가 안 나게 처리. `git push → GitHub Actions로 이미지 빌드 → GHCR 자동 푸시`.

### 2. 온프레미스 인프라
AWS EC2 위에 KVM 가상머신으로 물리 온프레미스 k8s를 재현. c8i.2xlarge 스팟 인스턴스에서 중첩가상화를 활성화해 KVM을 구동하고, kubeadm으로 클러스터를 직접 구성. 상세 과정과 시행착오는 [`../onprem/README.md`](../onprem/README.md), [`../onprem/TROUBLESHOOTING.md`](../onprem/TROUBLESHOOTING.md) 참고.

### 3. 서비스 배포
k8s 매니페스트 작성 및 클러스터 배포. ConfigMap에 DB/Redis 사설 IP를 넣어야 파드가 DB에 붙는다는 걸 재구축을 반복하며 깨닫고, 이후 배포 절차에 반영.

### 4. 실험
온프레미스의 동작·한계·장애 복구를 검증하고 EKS와 비교 분석. 시나리오 설계는 [`experiments.md`](experiments.md) 참고.

## 담당 아닌 것

| 항목 | 비고 |
|---|---|
| 모니터링 구축(Prometheus/Grafana) 심화 설계 | 이 레포엔 실제 운영한 monitoring/ 구성이 포함되어 있으나, 최초 설계는 팀원D 담당 |
| 부하 도구(k6 스크립트) 초기 설계 | scenario.js/scenario-wave.js는 본인이 다루고 실행했으나, k6 전체 계획은 팀원E와 공유 |
| CI/CD(GitHub Actions) 설계 | 본인은 빌드→GHCR push 흐름을 사용하는 입장, 파이프라인 자체 설계는 팀원E 담당 |
| EKS 클러스터 구축 | 팀원A·B 담당 — EKS도 이 레포의 앱 이미지·매니페스트를 동일하게 사용(동일화 기준만 제공) |
