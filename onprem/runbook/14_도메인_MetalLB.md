# 14. 진입 경로 — LoadBalancer (온프레 MetalLB ↔ EKS NLB)

> 📁 **원본 실행 문서** — 팀 저장소 `Incheon-soda/shoply`의 `문서/14_도메인_MetalLB.md`(2026-06-12)를 그대로 옮겼습니다. AMI 이전에 실제로 클러스터를 세울 때 쓰던 문서입니다.
> 최종 정리본: [`../README.md`](../README.md) 네트워크

> 트래픽 진입을 **양쪽 다 `Service type: LoadBalancer`** 로 통일한다.
> EKS는 **NLB**(클라우드 L4 LB), 온프레는 **MetalLB**(소프트웨어 L4 LB)로 같은 추상화를 구현 → **공정 비교**.
> + 도메인으로 진입(테스트 클라이언트 `/etc/hosts`, AWS 관리형 DNS 미사용).

---

## 0. 개념 — 둘 다 LoadBalancer 타입, 구현만 다름

```
[EKS]   도메인(/etc/hosts) → NLB → ingress 파드 → 앱
[온프레] 도메인(/etc/hosts) → EIP → 호스트 DNAT → MetalLB VIP → ingress → 앱
```

| | EKS | 온프레 |
|---|---|---|
| 서비스 타입 | `LoadBalancer` | `LoadBalancer` (동일) |
| 구현 | **NLB** (AWS Load Balancer Controller가 자동 생성) | **MetalLB** (L2 모드, VIP를 ARP로 광고) |
| 계층 | L4 (TCP) | L4 |
| 타겟 | IP 모드 = 파드 직접 | 노드(announce) → kube-proxy → 파드 |
| 외부 진입 | NLB가 바로 공인 | EIP → 호스트 DNAT → VIP (사설이라 한 단계 더) |

> **LB는 독립변수가 아님**(노드 자동확장이 변수). 양쪽 다 LoadBalancer로 두면 진입 경로 대칭 → 공정성 확보.
> 차이(NLB는 cross-AZ AWS관리형 / MetalLB L2는 announce 노드 1개)는 **구조적 한계로 명시**하면 됨.

---

# A. 온프레 — MetalLB

## A-1. Elastic IP (고정 공인 IP)
AWS 콘솔 → EC2 → 탄력적 IP → 새 주소 할당 → **호스트 EC2에 연결**.
→ 도메인이 가리킬 고정 공인 IP (재구축해도 안 바뀜).

## A-2. libvirt DHCP 범위 줄이기 (VIP 충돌 방지)
MetalLB가 쓸 `192.168.122.240~250`을 DHCP가 안 나눠주게:
```bash
# 호스트 EC2
sudo virsh net-dhcp-leases default          # .240~ 안 쓰는지 확인
sudo virsh net-edit default
#   <range start='192.168.122.2' end='192.168.122.239'/> 로 수정
sudo virsh net-destroy default && sudo virsh net-start default
```
> VM IP를 .11~.23 같은 낮은 값으로 고정했으면(doc13) 충돌 없음 — 이 단계 생략 가능.

## A-3. MetalLB 설치 + 설정 (master VM)
```bash
kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.14.8/config/manifests/metallb-native.yaml
kubectl get pods -n metallb-system        # controller + speaker Running 대기

# speaker가 worker3(ops, taint)에도 뜨게 toleration 추가 (VIP를 worker3에서 광고)
kubectl patch daemonset speaker -n metallb-system --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/tolerations/-","value":{"key":"dedicated","operator":"Equal","value":"ops","effect":"NoSchedule"}}]'

# IP풀 + L2 설정 (VIP를 worker3에서만 광고 → 실험 워커 안 건드림)
kubectl apply -f ~/k8s/onprem/metallb-config.yaml
```

## A-4. ingress-nginx를 LoadBalancer로 전환
```bash
kubectl patch svc ingress-nginx-controller -n ingress-nginx \
  -p '{"spec":{"type":"LoadBalancer"}}'
kubectl get svc -n ingress-nginx ingress-nginx-controller   # EXTERNAL-IP에 192.168.122.24x
```
→ `EXTERNAL-IP`가 **MetalLB VIP** (예: 192.168.122.240).

## A-5. 호스트 DNAT (EIP → VIP)
```bash
# 호스트 EC2 — VIP는 A-4의 EXTERNAL-IP, HOST_IP는 이 호스트 EC2의 사설IP
VIP=192.168.122.240
HOST_IP=<호스트 EC2 사설IP>   # 예: 10.0.8.138
sudo iptables -t nat -A PREROUTING -d $HOST_IP -p tcp --dport 80  -j DNAT --to-destination $VIP:80
sudo iptables -t nat -A PREROUTING -d $HOST_IP -p tcp --dport 443 -j DNAT --to-destination $VIP:443
sudo iptables -I FORWARD -d 192.168.122.0/24 -j ACCEPT
sudo iptables -I FORWARD -s 192.168.122.0/24 -j ACCEPT
sudo sysctl -w net.ipv4.ip_forward=1
```
> ⚠️ **`-d $HOST_IP` 필수** — 안 붙이면 "443번 포트면 전부" VIP로 DNAT되어, 워커 노드가 ghcr.io 등
> 외부 443으로 나가는 트래픽(이미지 pull 등)까지 가로채서 `tls: certificate is valid for ingress.local, not ghcr.io`로
> ImagePullBackOff가 난다 (11_트러블슈팅 참고).
>
> SG: 호스트 EC2 인바운드 **80, 443** 허용. (`scripts/host-network.sh`에 30080 대신 80/443도 추가 가능)

## A-6. 도메인 DNS
> Route53 등 AWS 관리형 DNS는 안 씀 — "온프레미스" 비교 취지에 안 맞고, `example.com`도 실제 보유 도메인이 아님(placeholder).
> 테스트 클라이언트(Mac 등)의 **`/etc/hosts`** 로 도메인→EIP 매핑만 로컬 해결.

```bash
# 테스트 클라이언트(Mac)에서
sudo sh -c 'echo "<Elastic IP>  shoply.example.com" >> /etc/hosts'
```

## A-7. ingress Host 규칙
```bash
cat << 'EOF' | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shoply-ingress
  namespace: shoply
  annotations:
    kubernetes.io/ingress.class: "nginx"
spec:
  ingressClassName: nginx
  rules:
    - host: shoply.example.com
      http:
        paths:
          - { path: /api, pathType: Prefix, backend: { service: { name: gateway-svc, port: { number: 4000 } } } }
          - { path: /,    pathType: Prefix, backend: { service: { name: frontend-svc, port: { number: 80 } } } }
EOF
curl http://shoply.example.com/api/products   # 상품 JSON 나오면 성공
```

---

# B. EKS — NLB

## B-1. AWS Load Balancer Controller 설치
EKS는 이 컨트롤러가 있어야 Service/Ingress로 NLB·ALB를 자동 생성한다.
```bash
# IAM OIDC + 정책 + 서비스어카운트 후 (eksctl 또는 콘솔)
helm repo add eks https://aws.github.io/eks-charts
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=<EKS-클러스터이름> \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller
```
> IRSA(IAM Role for ServiceAccount) 연동 필요 — `k8s/eks/serviceaccount.yaml` 참고. 상세는 EKS 구축 시.

## B-2. ingress-nginx 서비스를 NLB로 (어노테이션)
온프레와 동일하게 ingress-nginx를 LoadBalancer로 두되, **NLB 어노테이션**을 붙인다:
```yaml
# ingress-nginx helm values 또는 service patch
service:
  type: LoadBalancer
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-type: "external"
    service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: "ip"        # 파드 직접 타겟
    service.beta.kubernetes.io/aws-load-balancer-scheme: "internet-facing"
```
```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller   # EXTERNAL-IP에 NLB DNS
```
→ AWS가 **NLB를 자동 생성**, `EXTERNAL-IP`에 NLB DNS 이름이 뜬다.

## B-3. 도메인 → NLB
> 마찬가지로 Route53 안 씀 — 테스트 클라이언트 `/etc/hosts`에 NLB의 (현재) IP를 매핑.
```bash
# NLB DNS 이름의 현재 IP 확인
dig +short <NLB DNS 이름>

# 테스트 클라이언트(Mac)에서
sudo sh -c 'echo "<위에서 확인한 IP>  shoply.example.com" >> /etc/hosts'
```
> NLB는 IP가 바뀔 수 있으니, 비교 테스트 직전에 매번 `dig`로 재확인 후 `/etc/hosts` 갱신.

---

# C. 공정성 정리

| | 온프레 | EKS |
|---|---|---|
| 진입 추상화 | **LoadBalancer** | **LoadBalancer** |
| LB 구현 | MetalLB(VIP, worker3 광고) | NLB(IP 타겟, AWS) |
| 도메인 | /etc/hosts → EIP → DNAT → VIP | /etc/hosts → NLB |
| ingress | nginx (worker3 격리) | nginx |
| **노드 자동확장(★변수)** | ❌ 고정 | ✅ Karpenter |

- **진입 경로는 LoadBalancer로 대칭** → LB가 교란변수 안 됨.
- 차이(MetalLB L2 단일 announce vs NLB cross-AZ)는 **"온프레=소프트웨어LB, EKS=클라우드LB"** 로 발표에 명시.
- 측정(Pending·노드확장·RPS·P95)은 LB 종류 무관하게 동일하게 나옴.

---

## 트래픽 경로 비교 (한눈에)

```
[온프레] 사용자(/etc/hosts: shoply.example.com→EIP) → EIP(호스트EC2)
         → iptables DNAT → MetalLB VIP(192.168.122.24x) → ingress(worker3) → 파드

[EKS]    사용자(/etc/hosts: shoply.example.com→NLB IP) → NLB
         → ingress 파드(IP타겟) → 파드
```
