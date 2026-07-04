# Shoply K8s 매니페스트

## 디렉토리 구조

```
k8s/
├── common/                  # 공통 (환경 무관)
│   ├── namespace.yaml       # shoply 네임스페이스
│   ├── configmap.yaml       # 공통 환경변수 (DB/Redis host는 placeholder)
│   ├── secret.yaml          # DB 비밀번호, JWT 시크릿
│   ├── user.yaml            # User Service + ClusterIP
│   ├── product.yaml         # Product Service + ClusterIP
│   ├── inventory.yaml       # Inventory Service + ClusterIP
│   ├── order.yaml           # Order Service + ClusterIP
│   ├── payment.yaml         # Payment Service + ClusterIP
│   ├── gateway.yaml         # API Gateway + ClusterIP
│   ├── frontend.yaml        # Frontend (nginx) + ClusterIP
│   └── hpa.yaml             # HPA (product/inventory/order/payment/gateway)
│
├── onprem/                  # 온프레미스 전용
│   ├── configmap-patch.yaml # DB/Redis EC2 IP 오버라이드
│   ├── ingress.yaml         # Nginx Ingress
│   ├── nodeport-services.yaml  # NodePort (Prometheus 외부 스크랩용)
│   └── resource-patch.yaml    # t3.medium(2vCPU/4GB×2) 기준 리소스 제한
│
└── eks/                     # AWS EKS 전용
    ├── configmap-patch.yaml # RDS/ElastiCache 엔드포인트 오버라이드
    ├── ingress-alb.yaml     # AWS ALB Ingress
    ├── karpenter-nodepool.yaml  # Karpenter NodePool + EC2NodeClass
    └── serviceaccount.yaml  # ALB Controller IRSA
```

---

## GHCR 인증 Secret 생성 (배포 전 필수)

GHCR은 기본 private이므로 k8s가 이미지를 pull하려면 아래 명령으로 Secret을 먼저 만들어야 한다.
GitHub PAT은 `read:packages` 권한만 있으면 됨.

```bash
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=ktk026 \
  --docker-password=<YOUR_GITHUB_TOKEN> \
  --namespace=shoply
```

---

## 적용 순서

### 온프레미스

```bash
# 1. 네임스페이스 + 공통 리소스
kubectl apply -f k8s/common/namespace.yaml
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io --docker-username=ktk026 \
  --docker-password=<YOUR_GITHUB_TOKEN> \
  --namespace=shoply
kubectl apply -f k8s/onprem/configmap-patch.yaml   # DB/Redis IP 먼저 설정
kubectl apply -f k8s/common/secret.yaml

# 2. 서비스 배포
kubectl apply -f k8s/common/user.yaml
kubectl apply -f k8s/common/product.yaml
kubectl apply -f k8s/common/inventory.yaml
kubectl apply -f k8s/common/order.yaml
kubectl apply -f k8s/common/payment.yaml
kubectl apply -f k8s/common/gateway.yaml
kubectl apply -f k8s/common/frontend.yaml

# 3. HPA + Ingress
kubectl apply -f k8s/common/hpa.yaml
kubectl apply -f k8s/onprem/ingress.yaml

# 4. (옵션) Prometheus 외부 스크랩용 NodePort
kubectl apply -f k8s/onprem/nodeport-services.yaml

# 5. (옵션) 리소스 제한 조정
kubectl apply -f k8s/onprem/resource-patch.yaml
```

### EKS

```bash
# 사전 준비: AWS Load Balancer Controller, Karpenter 설치 완료 상태

# 1. 네임스페이스 + 공통 리소스
kubectl apply -f k8s/common/namespace.yaml
kubectl apply -f k8s/eks/configmap-patch.yaml     # RDS/ElastiCache 엔드포인트
kubectl apply -f k8s/common/secret.yaml

# 2. 서비스 배포
kubectl apply -f k8s/common/user.yaml
kubectl apply -f k8s/common/product.yaml
kubectl apply -f k8s/common/inventory.yaml
kubectl apply -f k8s/common/order.yaml
kubectl apply -f k8s/common/payment.yaml
kubectl apply -f k8s/common/gateway.yaml
kubectl apply -f k8s/common/frontend.yaml

# 3. HPA + ALB Ingress + Karpenter
kubectl apply -f k8s/common/hpa.yaml
kubectl apply -f k8s/eks/ingress-alb.yaml
kubectl apply -f k8s/eks/karpenter-nodepool.yaml
```

---

## 배포 전 체크리스트

| 항목 | 온프레미스 | EKS |
|------|-----------|-----|
| ConfigMap DB 주소 설정 | `onprem/configmap-patch.yaml` IP 변경 | `eks/configmap-patch.yaml` 엔드포인트 변경 |
| Secret 값 변경 | `common/secret.yaml` 비밀번호 변경 | 동일 |
| 이미지 레지스트리 | 각 Deployment의 `image:` 변경 | 동일 |
| Karpenter IAM | — | `serviceaccount.yaml` ACCOUNT_ID 변경 |
| ALB Controller | — | Helm 설치 후 IRSA 연결 |
| Nginx Ingress | `helm install ingress-nginx` | — |

---

## 이미지 빌드 & 푸시

```bash
# 예시 (GHCR 사용)
REGISTRY=ghcr.io/ktk026

docker build -t $REGISTRY/shoply-user:latest ./services/user
docker build -t $REGISTRY/shoply-product:latest ./services/product
docker build -t $REGISTRY/shoply-inventory:latest ./services/inventory
docker build -t $REGISTRY/shoply-order:latest ./services/order
docker build -t $REGISTRY/shoply-payment:latest ./services/payment
docker build -t $REGISTRY/shoply-gateway:latest ./gateway
docker build -t $REGISTRY/shoply-frontend:latest ./frontend

docker push $REGISTRY/shoply-user:latest
# ... 나머지 동일
```
