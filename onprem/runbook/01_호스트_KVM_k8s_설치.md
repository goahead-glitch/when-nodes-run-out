# 01. 온프레미스 K8s 구축 가이드 (AWS EC2 + KVM)

> 📁 원본: 팀 저장소 `Incheon-soda/shoply`의 `문서/06_설치_k8s_KVM.md` → 이 폴더 01번(2026-06-12). AMI 이전에 실제로 쓰던 실행 문서를 옮겼습니다.  
> ⚠️ VM 3대 기준으로 쓰여 있음 — VM은 worker3까지 4대로 만들고, 역할 부여는 [README](README.md)의 '노드 역할', 진입은 [02번](02_진입_MetalLB_DNAT.md)

---

## 목차

| 단계 | 작업 | 상태 |
|---|---|---|
| 0 | 중첩 가상화(Nested Virtualization) 활성화 | ✅ |
| 1 | EC2 디스크 확장 (8GB → 150GB) | |
| 2 | KVM 설치 | |
| 3 | VM 3개 생성 (master, worker1, worker2) | |
| 4 | 공통 OS 설정 | |
| 5 | containerd 설치 | |
| 6 | kubeadm / kubelet / kubectl 설치 | |
| 6-1 | kube-proxy 패치 (LXD 불필요 — KVM은 skip) | |
| 7 | K8s 클러스터 초기화 | |
| 8 | Flannel CNI 설치 | |
| 9 | Nginx Ingress + NodePort 설정 | |
| 10 | 부하 진입 포워딩 (iptables) | |
| 11 | 서비스 배포 | |

---

## 환경 정보

| 항목 | 값 |
|---|---|
| 호스트 EC2 | c8i.2xlarge (Ubuntu 24.04) |
| 가상화 | KVM (중첩 가상화 활성화 필요) |
| VM OS | Ubuntu 24.04 |
| K8s 버전 | EKS 버전 확인 후 동일하게 |
| CNI | Flannel v0.26.7 |

---

## 0단계 - 중첩 가상화(Nested Virtualization) 활성화

> EC2 콘솔에서 인스턴스 **중지(stop)** 후 진행

**AWS 콘솔:**
1. EC2 → 인스턴스 선택 → 작업 → 인스턴스 설정 → CPU 옵션 변경
2. AMD SMT 또는 Intel VT-x 중첩 가상화 활성화

**또는 AWS CLI:**
```bash
aws ec2 modify-instance-attribute \
  --instance-id <인스턴스ID> \
  --no-disable-api-termination

# 중첩 가상화는 launch template 또는 콘솔에서 설정
```

**인스턴스 재시작 후 확인:**
```bash
grep -c 'vmx\|svm' /proc/cpuinfo
# 0이 아니면 활성화 성공
```

---

## 1단계 - EC2 디스크 확장 (8GB → 150GB)

> AWS 콘솔에서 EBS 볼륨 크기를 150GB로 변경 후 아래 실행

```bash
lsblk

# 파티션 확장
sudo growpart /dev/nvme0n1 1

# 파일시스템 확장
sudo resize2fs /dev/nvme0n1p1

# 확인
df -h /
```

---

## 2단계 - KVM 설치

```bash
sudo apt update
sudo apt install -y \
  qemu-kvm \
  libvirt-daemon-system \
  libvirt-clients \
  bridge-utils \
  virtinst \
  virt-manager \
  cloud-image-utils

# 현재 유저를 libvirt/kvm 그룹에 추가
sudo usermod -aG libvirt,kvm $USER
newgrp libvirt

# KVM 동작 확인
virsh list --all
```

---

## 3단계 - VM 3개 생성 (master, worker1, worker2)

> Ubuntu 24.04 cloud image 사용

```bash
# cloud image 다운로드 (libvirt 이미지 디렉토리에 직접)
sudo wget -O /var/lib/libvirt/images/ubuntu-24.04-server-cloudimg-amd64.img \
  https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-amd64.img

# 각 VM용 디스크 이미지 생성 (30GB)
for vm in k8s-master k8s-worker1 k8s-worker2; do
  sudo qemu-img create -f qcow2 -F qcow2 \
    -b /var/lib/libvirt/images/ubuntu-24.04-server-cloudimg-amd64.img \
    /var/lib/libvirt/images/${vm}.qcow2 30G
done
```

```bash
# 패스워드 해시 미리 생성 (ubuntu1234)
HASH=$(openssl passwd -6 ubuntu1234)
echo $HASH   # 값 확인

# cloud-init user-data 생성 (해시값 직접 삽입)
cat > /tmp/user-data << EOF
#cloud-config
users:
  - name: ubuntu
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: false
    passwd: "${HASH}"
ssh_pwauth: true
package_update: false
EOF
```

> ⚠️ `<<'EOF'` (따옴표 있음) 쓰면 `$HASH` 변수가 치환 안 됨 → 반드시 `<< EOF` (따옴표 없음) 사용

```bash
# VM 생성 (각각 2vCPU / 4GB RAM)
for vm in k8s-master k8s-worker1 k8s-worker2; do
  # cloud-init meta-data
  echo "instance-id: ${vm}" > /tmp/meta-data-${vm}
  echo "local-hostname: ${vm}" >> /tmp/meta-data-${vm}

  # cloud-init iso 생성
  sudo cloud-localds /var/lib/libvirt/images/${vm}-cloud-init.iso \
    /tmp/user-data /tmp/meta-data-${vm}

  # VM 생성
  sudo virt-install \
    --name ${vm} \
    --ram 4096 \
    --vcpus 2 \
    --disk /var/lib/libvirt/images/${vm}.qcow2,format=qcow2 \
    --disk /var/lib/libvirt/images/${vm}-cloud-init.iso,device=cdrom \
    --os-variant ubuntu24.04 \
    --network network=default \
    --graphics none \
    --noautoconsole \
    --import
done
```

```bash
# VM 상태 확인
sudo virsh list --all

# VM IP 확인
sudo virsh net-dhcp-leases default
```

> ⚠️ VM IP는 DHCP라 재부팅 시 바뀔 수 있음 → `virsh net-dhcp-leases default` 로 확인

---

## VM 접속 방법

```bash
# IP 확인
sudo virsh net-dhcp-leases default

# SSH 접속
ssh ubuntu@<VM-IP>

# 또는 virsh console
virsh console k8s-master
```

---

## 3-1단계 - DNS 설정 (EC2 호스트 + VM 3개 모두)

> ⚠️ KVM 환경에서 EC2 호스트와 모든 VM이 DNS 불통 → 반드시 직접 설정 필수
> 안 하면 ghcr.io 이미지 pull 실패, helm 설치 실패, wget 실패

```bash
# EC2 호스트 + 각 VM (master, worker1, worker2) 모두 실행
sudo rm /etc/resolv.conf
echo "nameserver 8.8.8.8
nameserver 8.8.4.4" | sudo tee /etc/resolv.conf

# 확인
nslookup ghcr.io
```

> ⚠️ reboot 후 resolv.conf가 덮어써질 수 있음
> systemd-resolved 완전 비활성화 방법:
> ```bash
> sudo systemctl disable systemd-resolved
> sudo systemctl stop systemd-resolved
> ```

---

## 4단계 - 공통 OS 설정 (VM 3개 각각)

```bash
# 각 VM에서 실행
sudo -i

# swap 비활성화
swapoff -a
sed -i '/swap/d' /etc/fstab

# 시간대 설정 (KST — 안 하면 로그·캡처 파일명이 UTC라 한국시간과 9시간 어긋남)
timedatectl set-timezone Asia/Seoul
timedatectl | grep "Time zone"      # → Asia/Seoul (KST, +0900) 확인
date                                 # → 한국시간 나오는지 확인

# 커널 모듈 설정
cat > /etc/modules-load.d/k8s.conf << 'EOF'
overlay
br_netfilter
EOF
modprobe overlay
modprobe br_netfilter

# sysctl 설정
cat > /etc/sysctl.d/k8s.conf << 'EOF'
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
sysctl --system
```

---

## 5단계 - containerd 설치 (VM 3개)

```bash
apt install -y ca-certificates curl gnupg

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list

apt update
apt install -y containerd.io

containerd config default > /etc/containerd/config.toml
sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml

systemctl restart containerd
systemctl enable containerd
```

---

## 6단계 - kubeadm / kubelet / kubectl 설치 (VM 3개 각각)

> K8s 버전: **1.34.8** (EKS 버전과 동일)

```bash
# GPG 키 등록
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.34/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg

# 저장소 추가 (반드시 한 줄로 — 줄바꿈 시 malformed 오류)
echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.34/deb/ /' > /etc/apt/sources.list.d/kubernetes.list

apt update

# 설치 가능한 버전 확인
apt-cache madison kubeadm | head -5

# 설치
apt install -y kubeadm=1.34.8-1.1 kubelet=1.34.8-1.1 kubectl=1.34.8-1.1
apt-mark hold kubeadm kubelet kubectl
```

---

## 7단계 - K8s 클러스터 초기화

> ⚠️ init 전 반드시 확인

```bash
# ip_forward 설정 확인 및 적용
cat /proc/sys/net/ipv4/ip_forward
# 0이면 아래 실행
echo 1 > /proc/sys/net/ipv4/ip_forward
sysctl -w net.ipv4.ip_forward=1

# sysctl 설정 파일이 없으면 생성
cat > /etc/sysctl.d/k8s.conf << 'EOF'
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
sysctl --system

# 커널 모듈 로드 확인
modprobe overlay
modprobe br_netfilter
```

```bash
# master VM에서 실행
MASTER_IP=$(hostname -I | awk '{print $1}')

kubeadm init \
  --pod-network-cidr=10.244.0.0/16 \
  --apiserver-advertise-address=$MASTER_IP

mkdir -p $HOME/.kube
cp /etc/kubernetes/admin.conf $HOME/.kube/config
```

```bash
# worker VM들에서 실행 (init 출력에서 복사)
kubeadm join <MASTER_IP>:6443 --token <token> \
  --discovery-token-ca-cert-hash sha256:<hash>
```

> join 명령어 분실 시: `kubeadm token create --print-join-command`

---

## 8단계 - Flannel CNI 설치

```bash
# master에서
kubectl apply -f https://github.com/flannel-io/flannel/releases/download/v0.26.7/kube-flannel.yml

# 확인
kubectl get nodes
kubectl get pods -A
```

---

## 9단계 - Nginx Ingress + NodePort 설정

```bash
# Helm 설치
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | \
  DESIRED_VERSION=v3.14.0 bash

helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --version 4.9.0 \
  --set controller.service.type=NodePort \
  --set controller.service.nodePorts.http=30080
```

---

## 10단계 - 부하 진입 포워딩 (EC2 → VM, iptables)

> 서비스 배포 전에 반드시 완료해야 합니다.
> **ALB·Nginx 없이** iptables DNAT로 EC2:30080 → master VM:30080 포워딩 (EKS와 동일하게 :30080 진입).

```bash
# master VM IP 확인
MASTER_IP=$(sudo virsh net-dhcp-leases default | grep k8s-master | awk '{print $5}' | cut -d'/' -f1)
echo "Master IP: $MASTER_IP"

# EC2:30080 으로 들어온 부하 → master VM:30080 으로 DNAT 포워딩
sudo iptables -t nat -A PREROUTING -p tcp --dport 30080 -j DNAT --to-destination $MASTER_IP:30080
sudo iptables -t nat -A POSTROUTING -j MASQUERADE
# FORWARD 허용 (메트릭 포워딩과 동일)
sudo iptables -I FORWARD -d 192.168.122.0/24 -j ACCEPT
sudo iptables -I FORWARD -s 192.168.122.0/24 -j ACCEPT

# 영구 저장
sudo apt install -y iptables-persistent
sudo iptables-save | sudo tee /etc/iptables/rules.v4

# 확인 (k6는 EC2 공인IP:30080 으로 부하)
curl http://localhost:30080/
```

> kube-proxy가 master에도 30080을 열어줘서, EC2:30080 → master VM:30080 → Nginx Ingress Pod 으로 라우팅됨.
> (Nginx Ingress Controller는 클러스터 내부 경로 라우팅용이라 그대로 유지 — 9단계)

---

## 11단계 - 모니터링 포트 설정

### ⚠️ 0. prometheus.yml K8s EC2 IP 업데이트 (EC2 새로 만들 때마다)

```
msa_shoply/infra/monitoring/prometheus/prometheus.yml
```
파일에서 K8s EC2 사설 IP를 실제 값으로 교체합니다.

```bash
# K8s EC2 사설 IP 확인
hostname -I | awk '{print $1}'
```

→ `10.0.x.x` IP를 prometheus.yml의 30400~30404, 9100, 39101, 39102, 30800 타겟에 반영

> ⚠️ **이 IP를 안 바꾸면 Prometheus 타겟이 조용히 `down`으로 남는다** (에러 로그도 없이 그냥 안 보임).
> EC2를 재생성하면 사설 IP가 바뀌므로, scrape target의 `node-onprem`/`kube-state-onprem` 등이 `down`으로 뜨면
> 이 IP가 옛날 값(예: 재생성 전 `10.0.9.69`)인 채로 남아있는지부터 의심할 것.
> → 자세한 증상·해결은 [트러블슈팅 16번](../TROUBLESHOOTING.md#16-prometheus-타겟-down--node_exporter--kube-state-metrics-설치-누락) 참고.

---

### ⚠️ 1. SG-K8s 보안그룹 인바운드 먼저 추가 (빠뜨리면 no route to host)

> **반드시 먼저** 설정해야 합니다. 빠뜨리면 Prometheus가 no route to host 에러

| 포트 | 소스 | 용도 |
|---|---|---|
| 9100 | SG-모니터링 | EC2 호스트 node_exporter |
| 30400 - 30404 | SG-모니터링 | 앱 메트릭 NodePort |
| 30800 | SG-모니터링 | kube-state-metrics |
| 39101 | SG-모니터링 | KVM worker1 node_exporter |
| 39102 | SG-모니터링 | KVM worker2 node_exporter |

---

### 1. EC2 호스트에 node_exporter 설치 (포트 9100)

```bash
# EC2 호스트에서
wget https://github.com/prometheus/node_exporter/releases/download/v1.8.0/node_exporter-1.8.0.linux-amd64.tar.gz
tar xzf node_exporter-1.8.0.linux-amd64.tar.gz
sudo install -m 755 node_exporter-1.8.0.linux-amd64/node_exporter /usr/local/bin/node_exporter

sudo tee /etc/systemd/system/node_exporter.service << 'EOF'
[Unit]
Description=Node Exporter
[Service]
ExecStart=/usr/local/bin/node_exporter
Restart=always
[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload && sudo systemctl enable --now node_exporter
```

### 2. metrics-server 설치 (HPA 필수)

> HPA가 CPU 메트릭을 읽으려면 metrics-server가 있어야 함
> KVM 환경에서는 `--kubelet-insecure-tls` 플래그 필수

```bash
# master VM에서
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/
helm install metrics-server metrics-server/metrics-server \
  --namespace kube-system \
  --set args={--kubelet-insecure-tls}

# 1~2분 후 확인
kubectl top nodes
kubectl get hpa -n shoply   # TARGETS에 숫자가 나와야 정상
```

### 3. kube-state-metrics 설치 (포트 30800)

```bash
# master VM에서
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install kube-state-metrics prometheus-community/kube-state-metrics \
  --namespace kube-system \
  --set service.type=NodePort \
  --set service.nodePort=30800
```

### 3. KVM 워커 VM에 node_exporter 설치 (포트 39101, 39102)

```bash
# worker1, worker2 VM 각각에서
wget https://github.com/prometheus/node_exporter/releases/download/v1.8.0/node_exporter-1.8.0.linux-amd64.tar.gz
tar xzf node_exporter-1.8.0.linux-amd64.tar.gz
sudo install -m 755 node_exporter-1.8.0.linux-amd64/node_exporter /usr/local/bin/node_exporter

sudo tee /etc/systemd/system/node_exporter.service << 'EOF'
[Unit]
Description=Node Exporter
[Service]
ExecStart=/usr/local/bin/node_exporter
Restart=always
[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload && sudo systemctl enable --now node_exporter
```

### 4. iptables 포워딩 설정 (EC2 호스트에서)

```bash
# VM IP 확인
sudo virsh net-dhcp-leases default

MASTER_IP=<master-VM-IP>
WORKER1_IP=<worker1-VM-IP>
WORKER2_IP=<worker2-VM-IP>

# 앱 메트릭 + kube-state-metrics
for port in 30400 30401 30402 30403 30404 30800; do
  sudo iptables -t nat -A PREROUTING -p tcp --dport $port -j DNAT --to-destination $MASTER_IP:$port
done

# 워커 node_exporter
sudo iptables -t nat -A PREROUTING -p tcp --dport 39101 -j DNAT --to-destination $WORKER1_IP:9100
sudo iptables -t nat -A PREROUTING -p tcp --dport 39102 -j DNAT --to-destination $WORKER2_IP:9100
sudo iptables -t nat -A POSTROUTING -j MASQUERADE

# FORWARD 허용 (외부 → KVM VM 트래픽)
sudo iptables -I FORWARD -d 192.168.122.0/24 -j ACCEPT
sudo iptables -I FORWARD -s 192.168.122.0/24 -j ACCEPT

# 저장
sudo mkdir -p /etc/iptables
sudo iptables-save | sudo tee /etc/iptables/rules.v4
```

### 5. SG-K8s 보안그룹 인바운드 추가

| 포트 | 소스 | 용도 |
|---|---|---|
| 9100 | 모니터링 SG | EC2 호스트 node_exporter |
| 30400~30404 | 모니터링 SG | 앱 메트릭 NodePort |
| 30800 | 모니터링 SG | kube-state-metrics |
| 39101 | 모니터링 SG | KVM worker1 node_exporter |
| 39102 | 모니터링 SG | KVM worker2 node_exporter |

---

## VM 관리 명령어

```bash
sudo virsh list --all                    # VM 목록
sudo virsh start k8s-master             # VM 시작
sudo virsh shutdown k8s-master          # VM 정상 종료
sudo virsh destroy k8s-master           # VM 강제 종료
sudo virsh net-dhcp-leases default      # VM IP 확인
ssh ubuntu@<VM-IP>                      # VM SSH 접속
```

---

---

## 11단계 - 서비스 배포

> master VM에 SSH 접속 후 실행

```bash
# 1. 맥에서 EC2로 매니페스트 전송
scp -i ~/key/aws-3tier-keypair.pem -r \
  ~/shopping_k8s/msa_shoply/k8s \
  ubuntu@<EC2-공인IP>:~/k8s-manifests

# 2. EC2에서 master VM으로 전송
scp -r ~/k8s-manifests ubuntu@<master-VM-IP>:~/

# 3. master VM 접속
ssh ubuntu@<master-VM-IP>
sudo -i   # root로 전환
```

```bash
# 4. namespace, configmap, secret 적용
cat /home/ubuntu/k8s-manifests/common/namespace.yaml | kubectl apply -f -

kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io --docker-username=dummy --docker-password=dummy \
  --namespace=shoply 2>/dev/null || true

cat /home/ubuntu/k8s-manifests/common/configmap.yaml | kubectl apply -f -
cat /home/ubuntu/k8s-manifests/onprem/configmap-patch.yaml | kubectl apply -f -
cat /home/ubuntu/k8s-manifests/common/secret.yaml | kubectl apply -f -

# 5. 서비스 배포 (replicas: 1)
for f in user product inventory order payment gateway frontend; do
  cat /home/ubuntu/k8s-manifests/common/$f.yaml | kubectl apply -f -
done

# 5-1. ★ gateway alias Service (필수 — 없으면 frontend가 CrashLoopBackOff)
#   frontend 이미지의 nginx.conf가 upstream을 "gateway:4000"으로 하드코딩(빌드 시 고정)했는데
#   실제 Service 이름은 "gateway-svc"라 DNS 조회 실패 → nginx가 시작도 못 하고 죽는다.
#   재빌드 없이, 같은 selector(app: gateway)의 "gateway" Service를 추가해 해결 (→ onprem/TROUBLESHOOTING.md 14번).
cat << 'EOF' | kubectl apply -f -
apiVersion: v1
kind: Service
metadata:
  name: gateway
  namespace: shoply
  labels:
    app: gateway
spec:
  selector:
    app: gateway
  ports:
    - port: 4000
      targetPort: 4000
      protocol: TCP
  type: ClusterIP
EOF

cat /home/ubuntu/k8s-manifests/onprem/nodeport-services.yaml | kubectl apply -f -

# ingress.yaml 적용 (파일 없으면 아래 직접 apply 방법 사용)
cat /home/ubuntu/k8s-manifests/onprem/ingress.yaml | kubectl apply -f - 2>/dev/null || \
cat << 'INGRESS' | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shoply-ingress
  namespace: shoply
  annotations:
    kubernetes.io/ingress.class: "nginx"
spec:
  rules:
    - http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: gateway-svc
                port:
                  number: 4000
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend-svc
                port:
                  number: 80
INGRESS

# 6. gateway 서비스 추가 (frontend DNS 해결용)
kubectl expose deployment gateway \
  --name=gateway --port=4000 --target-port=4000 \
  --namespace=shoply 2>/dev/null || true

# 7. 상태 확인
kubectl get pods -n shoply
```

# 8. HPA 배포
cat /home/ubuntu/k8s-manifests/common/hpa.yaml | kubectl apply -f -
kubectl get hpa -n shoply
```

> ⚠️ root로 접속 시 `~/` = `/root/` → 반드시 `/home/ubuntu/k8s-manifests/` 절대경로 사용

---

## 현재 진행 현황 (2026-06-01 기준)

> VM IP는 매번 바뀜 → `sudo virsh net-dhcp-leases default` 로 확인

### 진행 상태

| 단계 | 상태 | 비고 |
|---|---|---|
| 0. 중첩 가상화 활성화 | ✅ | `kvm-ok` 확인 |
| 1. EC2 디스크 확장 | ✅ | |
| 2. KVM 설치 | ✅ | |
| 3. VM 3개 생성 | ✅ | ubuntu/ubuntu1234 |
| 4. 공통 OS 설정 | ✅ | kubeadm init 전 ip_forward 수동 적용 |
| 5. containerd 설치 | ✅ | |
| 6. kubeadm 1.34.8 설치 | ✅ | |
| 7. K8s 클러스터 초기화 | ✅ | master: 192.168.122.101 |
| 8. Flannel CNI | ✅ | |
| 9. Nginx Ingress | ✅ | helm ingress-nginx 4.9.0 |
| 10. 부하 진입 (iptables) | ✅ | EC2:30080 → master VM:30080 |
| 11. 서비스 배포 | ✅ | replicas: 1 |
| 12. kube-state-metrics + node_exporter | ✅ | 모니터링용 |
| 13. Prometheus iptables 포워딩 | ✅ | 30400~30404, 30800, 39101, 39102 |
| 14. HPA 배포 | ✅ | maxReplicas: 99, scaleDown: 60s |
| 15. metrics-server 설치 | ✅ | --kubelet-insecure-tls |

### 트러블슈팅 기록

| 문제 | 원인 | 해결 |
|---|---|---|
| virsh 명령 안 됨 | sudo 없이 실행 | `sudo virsh ...` |
| cloud-init 로그인 불가 | passwd 해시 오류 (`<<'EOF'` 내 `$()` 미실행) | `openssl passwd -6`로 해시 미리 생성 |
| kubernetes.list malformed | 백슬래시 줄바꿈 오류 | 한 줄 echo로 직접 작성 |
| ip_forward 미설정 | 4단계 OS 설정 누락 | kubeadm init 전 수동 적용 |
| k8s-manifests 경로 오류 | root로 접속 시 `~/` = `/root/` | `/home/ubuntu/k8s-manifests/` 절대경로 사용 |
| EC2→master VM SSH 패스워드 안 됨 | VM SSH 키 미설정 | `sudo virsh console k8s-master`로 직접 접속 |
| 404 Not Found (ingress) | ingress.yaml 미적용 | master VM에서 직접 ingress kubectl apply |
| ImagePullBackOff (ghcr.io DNS 타임아웃) | KVM VM 내 systemd-resolved DNS 불통 | `/etc/resolv.conf` symlink 끊고 8.8.8.8 직접 설정 |
| node_exporter 실행 안 됨 (EXEC 203) | 바이너리가 `/usr/local/bin`에 없음 | `sudo install -m 755` 로 설치 |
| Prometheus 30800/30400 연결 안 됨 | iptables FORWARD 체인 차단 | `iptables -I FORWARD -d 192.168.122.0/24 -j ACCEPT` 추가 |
| wget DNS 실패 (EC2 호스트) | EC2 호스트도 systemd-resolved 불통 | EC2 호스트 `/etc/resolv.conf`도 8.8.8.8로 교체 |
| 서비스 CrashLoopBackOff → 자동 복구 | DB 연결 초기화 시간 필요 | 기다리면 자동 복구됨 (exponential backoff)|
| inventory/order CrashLoopBackOff (liveness 404) | 이미지에 `/livez` 엔드포인트 없음 | inventory, order 이미지 재빌드 트리거 |

### EC2에서 master VM으로 매니페스트 적용하는 법

```bash
# 방법 1: virsh console로 직접 접속
sudo virsh console k8s-master

# 방법 2: EC2에서 SSH 파이프 (키 인증 설정된 경우)
cat ~/k8s-manifests/onprem/ingress.yaml | ssh ubuntu@<master-VM-IP> "kubectl apply -f -"

# 방법 3: ingress 직접 apply (master VM에서)
cat << 'EOF' | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shoply-ingress
  namespace: shoply
  annotations:
    kubernetes.io/ingress.class: "nginx"
spec:
  rules:
    - http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: gateway-svc
                port:
                  number: 4000
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend-svc
                port:
                  number: 80
EOF
```

## 12단계 - kube-state-metrics + node_exporter 설치 (모니터링용)

### kube-state-metrics (master VM에서)

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install kube-state-metrics prometheus-community/kube-state-metrics \
  --namespace kube-system \
  --set service.type=NodePort \
  --set service.nodePort=30800
```

### node_exporter (worker1, worker2 VM 각각)

```bash
wget https://github.com/prometheus/node_exporter/releases/download/v1.8.0/node_exporter-1.8.0.linux-amd64.tar.gz
tar xzf node_exporter-1.8.0.linux-amd64.tar.gz
sudo mv node_exporter-1.8.0.linux-amd64/node_exporter /usr/local/bin/

sudo tee /etc/systemd/system/node_exporter.service << 'EOF'
[Unit]
Description=Node Exporter
[Service]
ExecStart=/usr/local/bin/node_exporter
Restart=always
[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload && sudo systemctl enable --now node_exporter
```

### EC2 호스트 iptables 포워딩 (EC2에서)

```bash
# VM IP 확인
sudo virsh net-dhcp-leases default

MASTER_IP=<master-VM-IP>
WORKER1_IP=<worker1-VM-IP>
WORKER2_IP=<worker2-VM-IP>

# 앱 메트릭 NodePort
for port in 30400 30401 30402 30403 30404 30800; do
  sudo iptables -t nat -A PREROUTING -p tcp --dport $port -j DNAT --to-destination $MASTER_IP:$port
done

# 워커 node_exporter
sudo iptables -t nat -A PREROUTING -p tcp --dport 39101 -j DNAT --to-destination $WORKER1_IP:9100
sudo iptables -t nat -A PREROUTING -p tcp --dport 39102 -j DNAT --to-destination $WORKER2_IP:9100
sudo iptables -t nat -A POSTROUTING -j MASQUERADE

sudo apt install -y iptables-persistent && sudo netfilter-persistent save
```

> **SG-K8s 보안그룹 인바운드 필수:**
>
> | 포트 | 소스 | 용도 |
> |---|---|---|
> | 9100 | 모니터링 SG | K8s EC2 호스트 node_exporter |
> | 30400~30404 | 모니터링 SG | 앱 메트릭 NodePort |
> | 30800 | 모니터링 SG | kube-state-metrics NodePort |
> | 39101 | 모니터링 SG | KVM worker1 node_exporter |
> | 39102 | 모니터링 SG | KVM worker2 node_exporter |

---

## 상태 확인 명령어 (master VM에서)

```bash
kubectl get nodes
kubectl get pods -A
kubectl get pods -n shoply
kubectl get hpa -n shoply
```