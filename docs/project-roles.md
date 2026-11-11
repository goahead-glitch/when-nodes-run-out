# 프로젝트 역할

## 한 줄 요약

동일한 쇼핑몰 MSA 앱을 온프레미스 k8s와 AWS EKS에 똑같이 올리고, 트래픽 폭증 상황에서 두 인프라가 어떻게 다르게 버티는지를 데이터로 비교한 실험입니다(노드 장애 실험은 설계만 하고 미실행).

## 팀 구성 (4명, 2개 팀)

| 팀 | 담당 |
|---|---|
| 온프레미스 팀 | **본인**(앱·인프라·배포·모니터링) / 팀원C(부하 테스트·CI/CD) |
| EKS 팀 | 팀원A·B(EKS 구축) |

동일한 앱·동일 기준으로 두 환경을 각각 구축·실험합니다.

## 이 레포에 담긴 담당 범위

이 레포(`when-nodes-run-out`)는 팀 전체 산출물 중 **본인이 실제로 만들고 운영한 부분**만 브랜치별로 정리했습니다.

| 브랜치 | 담당 내용 |
|---|---|
| `app` | 쇼핑몰 MSA 7개 서비스(gateway/product/inventory/order/payment/user/frontend) 코드·로직·이미지 |
| `onprem` | 온프레미스 인프라 전체 — EC2 위 KVM 가상머신으로 k8s 클러스터 구축, 네트워크(iptables DNAT), k8s 매니페스트, 배포, 백업/복원 |
| `shared`(monitoring/k6/postgres/redis/userdata) | 모니터링 스택 구성, k6 부하 시나리오, 공용 DB/캐시, EC2 부트스트랩 |

**팀원 담당**(본인 작성 아님): EKS 인프라 프로비저닝(terraform)·EKS 서비스 배포·CI/CD 운영 — `main`의 [`team/`](../team/) 폴더에 비교 참고용으로 보관.

## 담당 5영역 (실제 작업 흐름)

```
[앱 빌드]        7개 서비스 코드 → Docker 이미지 → GHCR
    ↓
[온프레 인프라]  EC2 → KVM VM 4대 → k8s 클러스터 → 네트워크
    ↓
[서비스 배포]    매니페스트(Deploy/HPA/Ingress) → 클러스터 배포 → 검증
    ↓
[모니터링]      Prometheus/Grafana/Loki 구축 → 온프레·EKS 비교 대시보드
    ↓
[실험]          기본 k6 스크립트로 동작 확인 → (부하 실행은 팀원C) → 대시보드 관측 → 결과 정리 → 복기
```

### 1. 앱 빌드
쇼핑몰 MSA 7개 서비스의 코드·로직·이미지를 담당. 백엔드는 Express(TypeScript), 프론트는 React. 재고 동시성(`SELECT FOR UPDATE`)으로 동시 주문이 몰려도 초과판매가 안 나게 처리. `git push → GitHub Actions로 이미지 빌드 → GHCR 자동 푸시`.

### 2. 온프레미스 인프라
AWS EC2 위에 KVM 가상머신으로 물리 온프레미스 k8s를 재현. c8i-flex.2xlarge 스팟 인스턴스에서 중첩가상화를 활성화해 KVM을 구동하고, kubeadm으로 클러스터를 직접 구성. 상세 과정은 [`onprem/README.md`](../onprem/README.md) 참고.

### 3. 서비스 배포
k8s 매니페스트 작성 및 클러스터 배포. ConfigMap에 DB/Redis 사설 IP를 넣어야 파드가 DB에 붙는다는 걸 재구축을 반복하며 깨닫고, 이후 배포 절차에 반영.

### 4. 모니터링
Prometheus·Grafana·Loki를 별도 EC2에 Docker Compose로 구성하고, 온프레·EKS 양쪽 Prometheus를 하나의 Grafana에 붙여 반반 비교 대시보드를 만듦. 상세는 [`monitoring/README.md`](../monitoring/README.md) 참고.

### 5. 실험
부하 테스트의 설계와 실행은 대부분 팀원C가 맡았습니다(`team/cicd-k6/`). 본인은 `k6/`의 기본 스크립트로 온프레가 제대로 동작하는지 미리 확인했고, 실험 중에는 직접 만든 반반 비교 대시보드로 양쪽을 관측해 결과를 정리했습니다. 프로젝트가 끝난 뒤 결과와 근거를 다시 확인한 복기는 [`retrospective.md`](retrospective.md)에 있습니다. 실험 내용과 결과는 [`experiments.md`](experiments.md) 참고.

## 담당 아닌 것

| 항목 | 비고 |
|---|---|
| 부하 테스트 설계 · 실행 | 팀원C 담당(`team/cicd-k6/`). 본인은 기본 k6 스크립트로 사전 확인, 실험 관측 · 결과 정리 |
| CI/CD(GitHub Actions) 설계 | 팀원C 담당 — 본인은 앱 코드·Dockerfile을 작성하고, 빌드→GHCR 푸시 흐름은 사용하는 입장 |
| EKS 클러스터 구축 · 배포 | 팀원A·B 담당 — 같은 앱 이미지를 쓰고, 매니페스트는 온프레 설정값(HPA·리소스)을 기준으로 팀원이 작성(`team/eks-service/`). 본인은 동일화 기준값을 제공 |
