# 온프레미스 구축 트러블슈팅 전체 로그

KVM 기반 온프레미스 k8s 클러스터를 구축·재구축하면서 실제로 겪은 문제들을 시간순으로 정리했습니다. 클러스터를 여러 번 재구축하는 과정에서 반복적으로 마주친 이슈들이라, 같은 구성을 다시 만들 때 참고할 수 있도록 증상→원인→해결 순으로 남깁니다.

## 목차

1. [브리지 모드 네트워크 안 잡힘](#1-브리지-모드-네트워크-안-잡힘)
2. [netplan 파일 없음 / 권한 오류](#2-netplan-파일-없음--권한-오류)
3. [`cannot call open vswitch: ovsdb-server.service is not running`](#3-cannot-call-open-vswitch-ovsdb-serverservice-is-not-running)
4. [DNS 오류 (temporary failure resolving)](#4-dns-오류-temporary-failure-resolving)
5. [swap 재부팅 후 다시 활성화](#5-swap-재부팅-후-다시-활성화)
6. [KVM VM SSH 접속 불가 (publickey)](#6-kvm-vm-ssh-접속-불가-publickey)
7. [KVM VM IP 재부팅 후 변경](#7-kvm-vm-ip-재부팅-후-변경)
8. [Windows에서 KVM VM 직접 SSH 불가](#8-windows에서-kvm-vm-직접-ssh-불가)
9. [Ubuntu 설치 후 무한 로딩 (로그인 프롬프트 안 나옴)](#9-ubuntu-설치-후-무한-로딩-로그인-프롬프트-안-나옴)
10. [kubeadm join 실패 — `ip_forward not set to 1`](#10-kubeadm-join-실패--ip_forward-not-set-to-1)
11. [flannel CrashLoopBackOff — br_netfilter 모듈 없음](#11-flannel-crashloopbackoff--br_netfilter-모듈-없음)
12. [helm install 실패 모음 (ingress-nginx)](#12-helm-install-실패-모음-ingress-nginx)
13. [kube-apiserver CrashLoopBackOff — loopback(127.0.0.1) 방화벽 DROP ★](#13-kube-apiserver-crashloopbackoff--loopback127001-방화벽-drop-)
14. [frontend CrashLoopBackOff — nginx upstream "gateway" host not found](#14-frontend-crashloopbackoff--nginx-upstream-gateway-host-not-found)
15. [외부에서 사이트 접속 안 됨 — EIP DNAT 규칙 누락/IP불일치](#15-외부에서-사이트-접속-안-됨--eip-dnat-규칙-누락ip불일치)
16. [Prometheus 타겟 down — node_exporter / kube-state-metrics 설치 누락](#16-prometheus-타겟-down--node_exporter--kube-state-metrics-설치-누락)
17. [모니터링 타겟 down — 호스트 포워딩 (ip_forward / 실행 위치 / SG) ★](#17-모니터링-타겟-down--호스트-포워딩-ip_forward--실행-위치--sg-)
18. [cAdvisor CrashLoopBackOff — read-only /var/run](#18-cadvisor-crashloopbackoff--read-only-varrun)
19. [NodePort가 외부(호스트)에서 안 됨 — kube-proxy 재시작](#19-nodeport가-외부호스트에서-안-됨--kube-proxy-재시작)
20. [이미지 pull 실패 — `tls: certificate is valid for ingress.local, not ghcr.io`](#20-이미지-pull-실패--tls-certificate-is-valid-for-ingresslocal-not-ghcrio)

★ 표시 2개(13, 17)가 가장 오래 걸리고 근본 원인 추적이 재미있었던 항목입니다.

---

## 1. 브리지 모드 네트워크 안 잡힘

**증상**
```
ens33 IP 없음
ping 안됨
```

**원인**: VMware Virtual Network Editor에서 VMnet0이 Wi-Fi 어댑터로 연결 안 됨(Auto 설정 시 유선/무선 혼동).

**해결**
1. VMware → Edit → Virtual Network Editor → Change Settings
2. VMnet0 → Bridged to: 실제 Wi-Fi 어댑터 선택
3. VM Settings → Network Adapter → Bridged 선택
4. Ubuntu VM에서 DHCP로 IP 받기
```bash
dhclient ens33
ip addr show ens33
```

---

## 2. netplan 파일 없음 / 권한 오류

**증상**: `/etc/netplan/50-cloud-init.yaml` 파일 없음, `sudo tee`/`sudo cat >` 권한 오류

**원인**: cloud-init이 netplan 파일을 생성했다가 삭제. 일반 유저로 리다이렉션 시 sudo 권한 미적용.

**해결**: root로 전환 후 파일 생성
```bash
sudo -i
cat > /etc/netplan/99-static.yaml << 'EOF'
network:
  version: 2
  ethernets:
    ens33:
      dhcp4: no
      addresses:
        - 192.168.0.78/24
      routes:
        - to: default
          via: 192.168.0.1
      nameservers:
        addresses: [8.8.8.8, 8.8.4.4]
EOF
chmod 600 /etc/netplan/99-static.yaml
netplan apply
```

---

## 3. `cannot call open vswitch: ovsdb-server.service is not running`

**증상**: `netplan apply` 실행 시 경고 메시지 출력

**원인**: OVS(Open vSwitch) 서비스 미설치

**해결**: 무시해도 됨 — Flannel CNI 사용 시 영향 없음

---

## 4. DNS 오류 (temporary failure resolving)

**증상**: `apt update` 시 `temporary failure resolving 'archive.ubuntu.com'`

**원인**: `/etc/resolv.conf`에 DNS 설정 없음

**해결**
```bash
echo "nameserver 8.8.8.8" > /etc/resolv.conf
apt update
```

---

## 5. swap 재부팅 후 다시 활성화

**증상**: reboot 후 `free -h`에서 Swap 4G 다시 활성화

**원인**: sed 명령어로 `/swap.img` 패턴 주석 처리 실패

**해결**: 직접 패턴 지정해서 주석 처리
```bash
swapoff -a
sed -i 's|/swap.img none swap sw 0 0|#/swap.img none swap sw 0 0|' /etc/fstab
cat /etc/fstab | grep swap
free -h
```

---

## 6. KVM VM SSH 접속 불가 (publickey)

**증상**: `ubuntu@192.168.122.x: Permission denied (publickey)`

**원인**: cloud-init user-data에서 chpasswd 방식이 일부 cloud image에서 동작 안 함 — 패스워드 인증이 비활성화된 상태로 VM 생성됨.

**해결**: SHA512 해시값으로 passwd 직접 지정해서 VM 재생성
```bash
# 1. 기존 VM 삭제
virsh destroy k8s-worker1
virsh undefine k8s-worker1
rm /var/lib/libvirt/images/k8s-worker1.qcow2
rm /var/lib/libvirt/images/k8s-worker1-cloud-init.iso

# 2. 패스워드 해시값 생성
python3 -c "import crypt; print(crypt.crypt('ubuntu1234', crypt.mksalt(crypt.METHOD_SHA512)))"
```

3. 생성된 해시값을 `user-data`의 `passwd` 필드에 넣어 cloud-init 설정 작성
```yaml
#cloud-config
hostname: k8s-worker1
users:
  - name: ubuntu
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: false
    passwd: "$6$생성된해시값..."
ssh_pwauth: true
package_update: false
```
```bash
# 4. cloud-init iso 재생성 후 VM 재생성
cloud-localds /var/lib/libvirt/images/k8s-worker1-cloud-init.iso \
  /tmp/worker1-user-data \
  /tmp/worker1-meta-data
```

---

## 7. KVM VM IP 재부팅 후 변경

**증상**: 재부팅 후 VM IP가 바뀜

**원인**: KVM 내부 DHCP 사용 중(192.168.122.x 대역)

**현재 IP 재확인**
```bash
virsh net-dhcp-leases default
```
> 이후 MAC 주소 고정 방식으로 바꿔 이 문제를 근본적으로 해결했습니다(아래 "네트워크" 섹션 참고).

---

## 8. Windows에서 KVM VM 직접 SSH 불가

**증상**: KVM VM IP(192.168.122.x)로 Windows에서 직접 SSH 안됨

**원인**: KVM VM은 192.168.122.x 내부 NAT 대역이라 외부에서 직접 접근 불가

**해결**: ProxyJump로 호스트를 거쳐서 접속
```cmd
ssh -J user@192.168.0.78 ubuntu@192.168.122.165   # master
ssh -J user@192.168.0.78 ubuntu@192.168.122.244   # worker1
ssh -J user@192.168.0.78 ubuntu@192.168.122.21    # worker2
```

---

## 9. Ubuntu 설치 후 무한 로딩 (로그인 프롬프트 안 나옴)

**증상**: `cloud-init finished` 메시지 이후 커서만 깜빡임

**원인**: cloud-init 완료 후 로그인 프롬프트가 가려진 상태

**해결**: 엔터 2~3번 누르기. 그래도 안 되면 VM 재시작(Restart Guest).

---

## 10. kubeadm join 실패 — `ip_forward not set to 1`

**증상**
```
[ERROR FileContent--proc-sys-net-ipv4-ip_forward]:
/proc/sys/net/ipv4/ip_forward contents are not set to 1
```

**원인**: 재부팅/신규 VM에서 IP 포워딩 sysctl이 0 상태. kubeadm preflight는 1을 요구.

**해결**
```bash
echo 1 > /proc/sys/net/ipv4/ip_forward
sysctl -w net.ipv4.ip_forward=1
echo "net.ipv4.ip_forward=1" >> /etc/sysctl.d/k8s.conf
sysctl --system
```
> hostname 관련 경고(`unable to resolve host ...`)는 치명적 아님 — 무시 가능.

---

## 11. flannel CrashLoopBackOff — br_netfilter 모듈 없음

**증상**
```
FailedCreatePodSandBox ... flannel: loadFlannelSubnetEnv failed:
/run/flannel/subnet.env: no such file or directory

Failed to check br_netfilter:
stat /proc/sys/net/bridge/bridge-nf-call-iptables: no such file or directory
```
워커 전체에서 flannel 파드가 계속 재시작 → 워커 파드 네트워크 안 됨.

**원인**: `br_netfilter`/`overlay` 커널 모듈 미로드. flannel이 bridge-nf-call-iptables를 못 찾아 죽음.

**해결**: 모든 노드(master 포함)에서:
```bash
modprobe overlay
modprobe br_netfilter
printf "overlay\nbr_netfilter\n" > /etc/modules-load.d/k8s.conf

cat > /etc/sysctl.d/k8s.conf << 'EOF'
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
sysctl --system
```
그다음 master에서 죽은 flannel 파드 삭제(자동 재생성):
```bash
kubectl delete pod -n kube-flannel --all
```

---

## 12. helm install 실패 모음 (ingress-nginx)

**증상 A** — `localhost:8080 connection refused`: 워커 노드에서 helm 실행함(워커엔 kubeconfig 없음).
→ helm/kubectl은 반드시 master VM에서 실행.

**증상 B** — `command not found: helm`: helm 미설치.
```bash
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

**증상 C** — `cannot re-use a name that is still in use` / `failed pre-install: timed out`: 이전 설치가 실패한 채 release/네임스페이스가 남음 + admission webhook job이 멈춤.
```bash
kubectl delete namespace ingress-nginx   # 통째로 정리 후 재설치
```

---

## 13. kube-apiserver CrashLoopBackOff — loopback(127.0.0.1) 방화벽 DROP ★

**증상**
```
kubectl get nodes
→ The connection to the server 192.168.122.101:6443 was refused

# kubelet 로그
"StartContainer" for "kube-apiserver" with CrashLoopBackOff
etcd Readiness probe failed: Get "http://127.0.0.1:2381/readyz": context deadline exceeded

# apiserver 로그 마지막
F Error creating leases: error creating storage factory: context deadline exceeded
```
kubelet·containerd·etcd 프로세스는 다 살아있는데 apiserver만 계속 죽음.

**진단 (핵심)**: apiserver는 `--etcd-servers=https://127.0.0.1:2379`로 **loopback으로만** etcd에 붙습니다. loopback과 노드IP를 각각 때려보면:
```bash
curl -k -m 5 https://127.0.0.1:2379/health        # → Connection timed out (X)
curl -k -m 5 https://192.168.122.101:2379/health  # → TLS 인증서 에러 (O, TCP는 됨)
```
- **127.0.0.1 → timeout / 노드IP → TLS에러** 패턴이면 확정: etcd는 멀쩡한데 **방화벽이 loopback 패킷을 DROP**하는 것.
- nftables에 아래 같은 DROP 룰이 패킷을 먹고 있음(counter 증가):
  ```
  ip daddr 127.0.0.0/8 ct status dnat ... counter packets 10247 ... drop
  ```
> `connection refused`(아무것도 안 뜸)가 아니라 `i/o timeout`(조용히 버려짐)이면 거의 항상 방화벽입니다.

**원인**: flannel/kube-proxy 반쯤 깨진 상태 + 재부팅으로 firewall(iptables/nft) 룰이 오염됨 → 오염된 룰이 loopback 트래픽까지 DROP → apiserver↔etcd 단절.

**해결**: master VM에서 방화벽을 비우고 kubelet 재시작
```bash
iptables -F
iptables -t nat -F
iptables -t mangle -F
iptables -P INPUT ACCEPT
iptables -P FORWARD ACCEPT
iptables -P OUTPUT ACCEPT
nft flush ruleset

# loopback 뚫렸는지 확인 (이제 timeout 대신 TLS 에러 = 성공)
curl -k -m 5 https://127.0.0.1:2379/health

systemctl restart kubelet
```
1~2분 후 `kubectl get nodes`, `kubectl get pods -n kube-system`으로 확인.

> 부수 증상: `sudo: unable to resolve host k8s-master` 경고는 `/etc/hosts`에 hostname이 없어서 나는 것 — 치명적 아니지만 정리 가능.
> 참고: `crictl` 미설치 시 컨테이너 로그는 `/var/log/pods/<ns>_<pod>_*/<container>/*.log` 파일을 직접 `tail` 하면 됩니다.

---

## 14. frontend CrashLoopBackOff — nginx upstream "gateway" host not found

**증상**
```
nginx: [emerg] host not found in upstream "gateway" in /etc/nginx/conf.d/default.conf:13
```
다른 6개 서비스는 `Running`인데 frontend만 계속 재시작.

**원인**: frontend 이미지의 `nginx.conf`에 `proxy_pass http://gateway:4000;`으로 호스트명이 빌드 시 고정(하드코딩)되어 있는데, 실제 k8s Service 이름은 `gateway-svc` → DNS 조회 실패 → nginx가 시작도 못 하고 죽음.

**해결**: 이미지 재빌드 없이, 같은 selector(`app: gateway`)를 갖는 `gateway`라는 이름의 Service를 추가:
```bash
cat << 'EOF' | kubectl apply -f -
apiVersion: v1
kind: Service
metadata:
  name: gateway
  namespace: shoply
spec:
  selector:
    app: gateway
  ports:
    - port: 4000
      targetPort: 4000
EOF

kubectl delete pod -n shoply -l app=frontend   # 즉시 재시작시켜 확인
```

---

## 15. 외부에서 사이트 접속 안 됨 — EIP DNAT 규칙 누락/IP불일치

**증상 A — Connection refused (즉시, ~수십ms)**: `curl -v http://<EIP>` → `Connection refused`(timeout 아니고 즉시 RST). `kubectl get ingress`, ingress-nginx 서비스는 정상(EXTERNAL-IP = VIP).

**증상 B — 502 / 타임아웃**: 클러스터 내부에서 ingress 직접 호출은 되는데 EIP로는 안 됨.

**원인**: 호스트 EC2의 PREROUTING DNAT 규칙(`-d $HOST_IP --dport 80/443 -j DNAT --to $VIP`)이 누락됐거나, `$HOST_IP`가 이전 재구축 때의 사설IP로 박혀있어 실제 IP와 불일치(EC2를 재생성/재시작하면 사설IP가 바뀜).

**진단 (호스트 EC2)**
```bash
hostname -I                                           # 현재 진짜 사설IP 확인
sudo iptables -t nat -L PREROUTING -n -v --line-numbers | grep -E "dpt:80|dpt:443"
cat /proc/sys/net/ipv4/ip_forward                     # 1 이어야 함
```

**해결**
```bash
sudo iptables -t nat -D PREROUTING <번호2>
sudo iptables -t nat -D PREROUTING <번호1>

HOST_IP=$(hostname -I | awk '{print $1}')
VIP=192.168.122.240   # MetalLB EXTERNAL-IP
sudo iptables -t nat -A PREROUTING -d $HOST_IP -p tcp --dport 80  -j DNAT --to-destination $VIP:80
sudo iptables -t nat -A PREROUTING -d $HOST_IP -p tcp --dport 443 -j DNAT --to-destination $VIP:443
```
> SG: 호스트 EC2 인바운드 80, 443(0.0.0.0/0) 허용도 같이 확인.
> `--dport 443`에 `-d $HOST_IP`를 빼면 ghcr.io pull까지 가로채는 별도 버그 → 20번 항목 참고.

---

## 16. Prometheus 타겟 down — node_exporter / kube-state-metrics 설치 누락

**증상**
```
node-onprem        2/3 up   — "<호스트IP>:9100"  Error: connect: connection refused
kube-state-onprem  0/1 up   — "<호스트IP>:30800" down
```

**원인**
- `node-onprem`: 호스트 EC2 자체에는 node_exporter가 설치 안 됨(KVM VM 안에만 설치하고 호스트를 빠뜨림)
- `kube-state-onprem`: 클러스터에 kube-state-metrics 자체가 설치 안 됨

**해결**: 호스트 EC2에 node_exporter 설치
```bash
wget https://github.com/prometheus/node_exporter/releases/download/v1.8.2/node_exporter-1.8.2.linux-amd64.tar.gz
tar xzf node_exporter-1.8.2.linux-amd64.tar.gz
sudo install -m 755 node_exporter-1.8.2.linux-amd64/node_exporter /usr/local/bin/node_exporter
sudo useradd -rs /bin/false node_exporter 2>/dev/null
sudo tee /etc/systemd/system/node_exporter.service > /dev/null << 'EOF'
[Unit]
Description=Node Exporter
After=network.target
[Service]
User=node_exporter
ExecStart=/usr/local/bin/node_exporter
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now node_exporter
```
그리고 kube-state-metrics를 helm으로 설치.

> 둘 다 "에러 없이 그냥 안 떠 있는" 형태라 놓치기 쉽습니다. 재구축 후엔 `kubectl get pods -n kube-system`에 `kube-state-metrics`/`metrics-server`가 보이는지, 호스트 EC2에 `systemctl status node_exporter`가 떠 있는지 체크리스트로 확인할 것.

---

## 17. 모니터링 타겟 down — 호스트 포워딩 (ip_forward / 실행 위치 / SG) ★

재구축·복원 후 app-onprem·kube-state·cadvisor 타겟이 전부 down인데 node-db는 up인 경우: down인 것들은 **호스트 DNAT를 거치는** 타겟, up인 건 **EC2 직접**(DB/Redis) — 호스트 포워딩 문제입니다.

**진단 순서**
```bash
curl -m5 -s -o /dev/null -w "9100: %{http_code}\n" http://<호스트IP>:9100/metrics   # 직접
curl -m5 -v http://<호스트IP>:30400/metrics 2>&1 | grep -iE "refused|timed"          # 포워딩
```
| 결과 | 원인 |
|---|---|
| 9100=200, 30400=refused | 호스트에 DNAT 없음 |
| 9100=200, 30400=timeout | 호스트 ip_forward=0 또는 FORWARD 막힘 |
| 9100도 timeout | SG가 그 포트 차단 |

**원인 ① — 호스트 명령을 master VM에서 실행 (제일 흔함)**: 프롬프트가 `root@k8s-master`이고 `unable to resolve host k8s-master`가 뜨면 VM 안입니다. DNAT/ip_forward/FORWARD는 호스트 EC2(virsh 돌아가는 머신)에서 해야 합니다.
```bash
hostname -I        # 10.0.x.x 192.168.122.1 (둘 다 보이면 호스트)
virsh list --all   # VM 4개 보이면 호스트
```

**원인 ② — 호스트 ip_forward=0**
```bash
cat /proc/sys/net/ipv4/ip_forward          # 0이면 범인
sudo sysctl -w net.ipv4.ip_forward=1
echo "net.ipv4.ip_forward=1" | sudo tee /etc/sysctl.d/99-k8s-forward.conf
```
> libvirt가 보통 자동으로 켜지만 새 호스트/복원 후엔 0인 경우 있음. VM 내부 ip_forward와 별개.

**원인 ③ — DNAT/FORWARD 누락** → 호스트에서 재적용.

---

## 18. cAdvisor CrashLoopBackOff — read-only /var/run

**증상**
```
failed to create shim task: ... error mounting ".../kube-api-access-xxx" to rootfs at
"/var/run/secrets/kubernetes.io/serviceaccount": ... mkdirat .../run/secrets: read-only file system
Exit Code: 128
```

**원인**: cAdvisor가 호스트 `/var/run`을 읽기전용으로 마운트하는데, k8s가 SA 토큰을 그 밑에 마운트하려다 read-only 충돌.

**해결**: cAdvisor는 k8s API를 안 쓰니 SA 토큰 마운트를 끔.
```bash
kubectl patch daemonset cadvisor -n kube-system --type merge \
  -p '{"spec":{"template":{"spec":{"automountServiceAccountToken":false}}}}'
```
> 매니페스트(`cadvisor-daemonset.yaml`)에도 반영됨.

---

## 19. NodePort가 외부(호스트)에서 안 됨 — kube-proxy 재시작

**증상**: 호스트 DNAT·ip_forward 다 맞는데 master로 가는 NodePort(30400~30404 등)만 timeout. 같은 포워딩 경로인 worker 대상은 됨(master 특정 문제). master에서 `curl localhost:30400`은 200인데 호스트→master:30400은 안 됨.

**원인**: 13번 항목의 loopback 방화벽 flush(`iptables -F`/`nft flush`)를 master에서 하면 kube-proxy의 NodePort 규칙(PREROUTING)도 같이 날아가 외부 접속이 깨집니다(localhost는 OUTPUT 경로라 따로 살아있어 헷갈림).

**해결**
```bash
kubectl delete pod -n kube-system -l k8s-app=kube-proxy
kubectl get pods -n kube-system -l k8s-app=kube-proxy   # 다시 Running
```

---

## 20. 이미지 pull 실패 — `tls: certificate is valid for ingress.local, not ghcr.io`

**증상**: 새로 뜨는 파드(특히 HPA 스케일업)가 `ImagePullBackOff`. `kubectl describe pod`에 `x509: certificate is valid for ingress.local, not ghcr.io`. 기존 파드는 정상, 새 노드/새 파드만 실패.

**원인**: 15번 항목의 호스트 EC2 DNAT 규칙이 목적지 IP를 안 가리고 `--dport 443` 전체를 MetalLB VIP(ingress-nginx)로 보냄. 워커 노드 → ghcr.io:443(이미지 pull) 트래픽도 호스트를 거치면서 이 규칙에 걸려 ingress-nginx로 리다이렉트 → ingress의 자체 인증서(ingress.local)를 받아 TLS 검증 실패.

**해결**
```bash
sudo iptables -t nat -D PREROUTING -p tcp --dport 80  -j DNAT --to-destination 192.168.122.240:80
sudo iptables -t nat -D PREROUTING -p tcp --dport 443 -j DNAT --to-destination 192.168.122.240:443

HOST_IP=<호스트 EC2 사설IP>
sudo iptables -t nat -A PREROUTING -d $HOST_IP -p tcp --dport 80  -j DNAT --to-destination 192.168.122.240:80
sudo iptables -t nat -A PREROUTING -d $HOST_IP -p tcp --dport 443 -j DNAT --to-destination 192.168.122.240:443

kubectl delete pod -n shoply -l app=<service> --field-selector status.phase!=Running
```
