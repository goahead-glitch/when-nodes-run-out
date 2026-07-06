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
└── onprem/                  # 온프레미스 전용
    ├── configmap-patch.yaml     # DB/Redis EC2 IP 오버라이드
    ├── ingress.yaml             # Nginx Ingress
    ├── nodeport-services.yaml   # NodePort (Prometheus 외부 스크랩용)
    ├── metallb-config.yaml      # MetalLB IPAddressPool/L2Advertisement
    ├── cadvisor-daemonset.yaml  # 워커 노드별 컨테이너 메트릭
    ├── promtail-loki.yaml       # 로그 수집 → Loki
    └── event-exporter-loki.yaml # k8s 이벤트(Pending 등) → Loki
```

> EKS용 매니페스트(`k8s/eks/`)는 팀원 담당 영역이라 이 레포에는 없습니다.

---

## GHCR 인증 Secret 생성 (배포 전 필수)

GHCR은 기본 private이므로 k8s가 이미지를 pull하려면 아래 명령으로 Secret을 먼저 만들어야 한다.
GitHub PAT은 `read:packages` 권한만 있으면 됨.

```bash
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=<YOUR_GITHUB_USERNAME> \
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
  --docker-server=ghcr.io --docker-username=<YOUR_GITHUB_USERNAME> \
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

> EKS 배포 순서는 팀원 담당 영역이라 이 레포에는 없습니다 (온프레미스와 동일한 `common/` 매니페스트를 공유하고, `eks/` 전용 오버레이만 다릅니다).

---

## 배포 전 체크리스트 (온프레미스)

| 항목 | 확인 |
|------|-----|
| ConfigMap DB 주소 설정 | `onprem/configmap-patch.yaml`의 IP가 현재 DB/Redis EC2 사설IP와 일치하는지 |
| Secret 값 변경 | `common/secret.yaml`의 비밀번호/JWT 시크릿을 실제 값으로 |
| 이미지 레지스트리 | 각 Deployment의 `image:`가 실제 GHCR 이미지 경로와 일치하는지 |
| Nginx Ingress | `helm install ingress-nginx ...`로 컨트롤러가 떠 있는지 |
| MetalLB | `k8s/onprem/metallb-config.yaml` 적용 후 ingress-nginx 서비스에 EXTERNAL-IP가 붙는지 |

---

## 이미지 빌드 & 푸시

이미지는 `app/` 브랜치의 GitHub Actions(`cd.yml`)가 `develop`/`main` push 시 자동으로 빌드해 GHCR로 푸시합니다. 로컬에서 수동으로 빌드하려면:

```bash
REGISTRY=ghcr.io/<YOUR_GITHUB_USERNAME>

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
