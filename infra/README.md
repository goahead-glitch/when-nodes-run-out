# AWS EKS 인프라 구축기 — Shoply Benchmark Project

> 온프레미스(EC2+KVM) vs AWS EKS, 같은 쇼핑몰 앱을 두 환경에 띄우고 "탄력성"이라는 단 하나의 변수로 비교한 팀 프로젝트에서, AWS EKS 인프라 설계를 담당하며 진행한 과정을 정리했습니다.

---

## 1. 프로젝트에서 내가 맡은 부분

팀은 4명이 각자 온프레미스, EKS 인프라, 서비스 배포, CI/CD·부하테스트를 나눠 맡았고, 저는 그중 **AWS EKS 인프라 설계**를 담당했습니다. Terraform으로 VPC부터 EKS, 보안그룹, IAM, RDS, Redis까지 전 계층을 코드로 구성하는 것이 목표였습니다.

실험의 핵심 변수는 "노드 자동확장 유무" 하나였기 때문에, 온프레미스 워커 노드와 동일한 스펙(`c8i-flex.large`)으로 EKS 워커 노드를 고정하고, EKS Auto Mode 대신 Managed Node Group + Karpenter 조합을 직접 구성해서 이 변수 하나만 남도록 설계했습니다.

---

## 2. 이렇게 만들었습니다

### 2.1 네트워크 & 보안 계층
VPC와 퍼블릭 서브넷 2개(2a, 2c)로 네트워크를 구성하고, 역할별로 보안그룹을 5개로 나눠 최소 권한 원칙을 지켰습니다.

| 보안그룹 | 용도 |
|---|---|
| `app-eks-worker-sg` | 워커 노드 |
| `app-load-balancer-sg` | 80/443 인그레스 트래픽 허용 |
| `app-rds-sg` | RDS 접근, 워커 노드 SG만 허용 |
| `app-redis-sg` | Redis 접근, 워커 노드 SG만 허용 |
| `app-k6-sg` | 부하 테스트 서버 전용 |

<img width="760" height="182" alt="Image" src="https://github.com/user-attachments/assets/d8bd9b22-8d4f-455b-bb57-2008705a6bab" />

IAM은 `infra_group`(VPC·EKS 프로비저닝), `k8s_group`(클러스터 운영), `cicd_group`(ECR push·배포) 세 그룹으로 나눠 관리했고, 그룹 정책은 아래처럼 정책 파일을 참조하면서 그룹 생성 이후에 적용되도록 의존성을 명시했습니다.

<img width="597" height="557" alt="Image" src="https://github.com/user-attachments/assets/aa0ff45b-3053-4810-926f-3e956f80c2a9" />

### 2.2 컴퓨팅 계층 (EKS)
Launch Template을 Terraform으로 직접 관리해서, 온프레미스 워커 노드와 동일한 스펙(`c8i-flex.large`)으로 EKS 워커 노드 인스턴스 타입을 고정했습니다. api 노드그룹과 service 노드그룹으로 역할을 분리했습니다.

<img width="741" height="617" alt="Image" src="https://github.com/user-attachments/assets/c1afbfca-7bd4-4f04-9c8f-b0f7cf7d958e" />

- **AMI**: 하드코딩 대신 `data.aws_ssm_parameter.eks_ubuntu_ami`로 최신 Ubuntu EKS AMI를 동적으로 조회
- **보안그룹**: `cluster_security_group`과 `eks_worker_sg`를 이중으로 적용
- **무중단 교체**: `create_before_destroy = true`로 노드 교체 시 서비스 끊김 방지

### 2.3 데이터 계층
RDS PostgreSQL 16을 관리형으로 구성해 온프레미스의 EC2 PostgreSQL 16과 엔진 버전을 맞췄습니다. Redis는 클러스터를 몇 번이고 다시 만들어야 하는 실험 환경 특성상, 재생성해도 연결이 끊기지 않도록 Private IP를 고정했습니다.

<img width="900" height="272" alt="Image" src="https://github.com/user-attachments/assets/ac63f8fa-0e63-480a-9dc5-be0e6e742df4" />

### 2.4 관찰성 (모니터링 연동)
EKS 쪽에는 별도로 Prometheus/Grafana를 두지 않고, 모든 노드에 DaemonSet(Node Exporter, cAdvisor, Promtail)만 배포해서 메트릭·로그를 노출하도록 했습니다. Taint/Toleration으로 Ops 노드와 Worker 노드를 분리해, 모니터링 에이전트가 실험 워크로드의 자원을 갉아먹지 않도록 신경 썼습니다.

<img width="2605" height="441" alt="Image" src="https://github.com/user-attachments/assets/482b4711-3770-433a-9fac-b8b52f1b318f" />
<img width="712" height="210" alt="Image" src="https://github.com/user-attachments/assets/6dbe9822-692f-4c4c-b76d-bde281635b0f" />
<img width="855" height="360" alt="Image" src="https://github.com/user-attachments/assets/1f9035fd-03e4-4d85-8b55-922f4c97ff3f" />

### 2.5 이미지 저장소 (ECR)
7개 마이크로서비스(gateway, product, inventory, order, payment, user, frontend) 각각에 대해 ECR 리포지토리를 Terraform으로 생성하고 AES-256 암호화를 적용했습니다.

<img width="1345" height="377" alt="Image" src="https://github.com/user-attachments/assets/d994abd6-99a4-4d10-a180-9cc493fab472" />

---

## 3. 결과

같은 부하 조건에서 온프레미스는 노드가 꽉 차면 파드가 Pending으로 쌓이기만 했지만, EKS는 HPA가 Pod를 늘리고 Karpenter가 뒤따라 노드를 자동으로 붙이면서 서비스를 계속 유지했습니다. CPU 사용률이 최대 90.83%까지 올라가는 상황에서도 자원 부족으로 막히지 않았고, 이건 처음 설계할 때 목표했던 "탄력성 유무만 변수로 남긴다"는 방향이 제대로 작동했다는 걸 확인시켜준 결과였습니다.


---
