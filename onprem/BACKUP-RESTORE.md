# 백업 / 복원 — 스팟 호스트 EC2 빠른 복구

두 가지 방법을 모두 써 봤습니다. **AMI 백업**(AWS에 보관, 월 비용 발생, 복원이 가장 빠름)과 **qcow2 수동 백업**(PC에 보관, 무료, 새 EC2에 KVM을 다시 깔아야 함 — [`restore-cluster.sh`](scripts/restore-cluster.sh)로 자동화)입니다. qcow2 방식은 [아래 섹션](#qcow2-수동-백업--pc-보관-무료)에 있습니다.

## AMI 백업

호스트 EC2(KVM을 돌리는 그 머신)를 AMI로 통째 백업해두고, 스팟이 회수(terminate)되거나 새로 띄울 때 그 AMI로 몇 분 만에 복구합니다. AMI에는 KVM VM 디스크(qcow2)까지 들어있어 클러스터가 그대로 부활합니다.

> 스팟 인스턴스는 회수되면 terminate → root EBS가 같이 삭제됩니다. AMI(=루트 EBS 스냅샷 포함)를 떠두지 않으면 복구 불가능합니다.

## 무엇이 보존되나

| 위치 | AMI에 포함? | 비고 |
|---|:---:|---|
| 호스트 `/home/ubuntu/k8s`, `/scripts` | ✅ | root EBS에 있으면 포함 |
| KVM VM 디스크 `/var/lib/libvirt/images/*.qcow2` | ✅ | 클러스터 상태 통째(root EBS에 있을 때) |
| VM 내부(쿠버 클러스터·앱·ingress) | ✅ | qcow2 안에 있어 그대로 부활 |
| 호스트 iptables DNAT / ip_forward | ❌ | 새 EC2라 비어있음 → 재설정 필요 |
| 호스트 EC2 사설IP | ❌ | 매번 바뀜 → `host-network.sh`가 자동 감지 |
| DB·Redis·모니터링 EC2 | ❌ | 각자 별도 인스턴스, IP 갱신 필요 |

> qcow2가 별도 데이터 EBS 볼륨에 있으면 AMI(root만)에 안 들어갑니다 — 이 프로젝트는 `/var/lib/libvirt/images`가 root EBS라 AMI 하나로 끝납니다.

## 1. AMI 생성 (백업)

1. VM을 잠깐 멈춰 qcow2 일관성 확보
   ```bash
   sudo virsh shutdown k8s-master k8s-worker1 k8s-worker2 k8s-worker3
   sudo virsh list --all          # 다 'shut off' 확인
   sync                           # 메모리 버퍼 → 디스크 flush
   ```
2. (최초 1회 권장) 아래 "무삽질 복원" 섹션의 영구화를 먼저 해두면, 이 AMI로 복원 시 부팅만으로 클러스터가 올라옵니다.
3. AWS 콘솔 → EC2 → 인스턴스 선택 → 작업 → 이미지 및 템플릿 → 이미지 생성. **"재부팅 안 함(No reboot)"** 체크(스팟이라 재부팅 회피).
4. AMI 상태가 `available`이 되면 완료 (같이 생기는 스냅샷이 실제 디스크 백업본).
5. AMI 떴으면 VM 다시 켜기: `sudo virsh start k8s-master k8s-worker1 k8s-worker2 k8s-worker3`

## 2. AMI로 새 인스턴스 시작 (복원)

EC2 → AMI → 해당 AMI 선택 → AMI로 인스턴스 시작. 인스턴스 타입은 **c8i-flex.2xlarge**(중첩 가상화 동일), 구매 옵션 **스팟**, 기존 호스트 EC2 보안그룹 사용.

> 중첩 가상화(vmx/svm)는 AMI에 설정이 안 따라올 수 있습니다. 새 인스턴스에서 `grep -c 'vmx\|svm' /proc/cpuinfo`가 0이면 인스턴스 타입/CPU 옵션에서 다시 켭니다.

## 3. EIP 재연결

EC2 → 탄력적 IP → 기존 EIP 선택 → 작업 → 탄력적 IP 주소 연결 → 새 인스턴스 선택. 공인 IP가 그대로 유지됩니다.

## 4. KVM VM 살리기 (autostart)

복원 직후 `virsh list`가 비어 보이는 건 VM이 꺼진 상태(autostart 미설정)라서입니다.
```bash
sudo virsh list --all                 # VM 4개가 'shut off'로 보이면 정상
sudo virsh net-start default 2>/dev/null
for vm in k8s-master k8s-worker1 k8s-worker2 k8s-worker3; do
  sudo virsh start $vm
  sudo virsh autostart $vm             # 다음부턴 부팅 시 자동으로 뜨게
done
sudo virsh list --all                  # 4개 다 'running'
sudo virsh net-dhcp-leases default     # IP가 그대로인지 (MAC 고정이라 안 바뀜)
```

## 4-1. flannel 살리기 — br_netfilter (VM 4대 전부)

재부팅하면 `br_netfilter` 모듈이 빠집니다 → flannel이 CrashLoopBackOff → 모든 파드가 ContainerCreating에 멈춥니다. **master·worker1·worker2·worker3 4대 각각에서** 처리해야 합니다(한 대라도 빠지면 그 노드의 파드가 안 뜸).

> 아래 "무삽질 복원" 섹션처럼 모듈을 영구화해서 AMI를 구웠으면 이 단계는 불필요합니다.

```bash
ssh ubuntu@<각 VM IP>
hostname   # 어느 노드인지 꼭 확인
sudo modprobe overlay br_netfilter
cat /proc/sys/net/bridge/bridge-nf-call-iptables    # 1 나와야 성공
```
4대 다 확인되면 master에서:
```bash
kubectl delete pod -n kube-flannel --all
kubectl get pods -n kube-flannel -o wide -w         # 4개 다 1/1 Running

# 백업 이전 '유령' 파드 일괄 정리
kubectl delete pod -A --field-selector status.phase!=Running --force --grace-period=0
```

## 5. 호스트 네트워크 재설정 (DNAT + 메트릭 포워딩)

```bash
cd ~/scripts
./host-network.sh
#   MetalLB EXTERNAL-IP가 다르면:  VIP=192.168.122.24x ./host-network.sh
```

## 6. DB / Redis 사설IP 갱신 (configmap)

DB·Redis EC2를 새로 띄웠으면 사설IP가 바뀝니다. 옛 IP면 백엔드 파드가 `0/1`(헬스체크 실패)로 안 뜹니다.
```bash
kubectl get cm shoply-config -n shoply \
  -o jsonpath='{.data.POSTGRES_HOST}{"  "}{.data.REDIS_HOST}{"\n"}'

cat > ~/cm-patch.json <<'JSON'
{"data":{"POSTGRES_HOST":"<DB-새-사설IP>","REDIS_HOST":"<Redis-새-사설IP>"}}
JSON
kubectl patch configmap shoply-config -n shoply --type merge --patch-file ~/cm-patch.json
kubectl rollout restart deployment -n shoply
kubectl get pods -n shoply -w
```
> 백엔드 파드가 `Running`인데 `0/1`로 남으면 거의 이 IP 불일치입니다.

## 6-1. Loki 로그 수집 IP 갱신 (Promtail / event-exporter)

모니터링 EC2도 새로 뜨면 사설IP가 바뀝니다. Promtail·event-exporter가 옛 IP로 push하면 Grafana Loki가 텅 빕니다.
```bash
kubectl get cm promtail-config -n kube-system -o yaml | grep "url:"
kubectl get cm event-exporter-config -n kube-system -o yaml | grep "url:"

OLD=<옛-모니터링-IP>
MON=<현재-모니터링-IP>
sed -i "s|http://$OLD:3100|http://$MON:3100|" \
  /home/ubuntu/k8s/onprem/promtail-loki.yaml \
  /home/ubuntu/k8s/onprem/event-exporter-loki.yaml
kubectl apply -f /home/ubuntu/k8s/onprem/promtail-loki.yaml
kubectl apply -f /home/ubuntu/k8s/onprem/event-exporter-loki.yaml
kubectl rollout restart ds/promtail -n kube-system
kubectl rollout restart deploy/event-exporter -n kube-system
```
확인: `curl -s http://localhost:3100/loki/api/v1/label/namespace/values`에 `"shoply"`가 나오면 OK.

## 7. 확인

```bash
kubectl get nodes                       # 4개 Ready
kubectl get pods -A -o wide
kubectl get svc -n ingress-nginx ingress-nginx-controller   # EXTERNAL-IP 확인

curl http://<EIP>/api/products
```

## 7-1. 다음 복원을 "무삽질"로 — 영구화 후 AMI 재생성

4-1(br_netfilter)·4(autostart)를 매번 손으로 하는 게 반복 작업의 원인이었습니다. 한 번 영구화해서 AMI를 다시 구우면, 다음 복원부턴 부팅만으로 클러스터까지 자동으로 올라옵니다.

**① 각 VM(master·worker1·2·3)에서 — 모듈 부팅 자동로드**
```bash
printf "overlay\nbr_netfilter\n" | sudo tee /etc/modules-load.d/k8s.conf
```

**② 호스트 EC2에서 — VM 자동시작 + host-network.sh 부팅 자동실행**
```bash
sudo virsh autostart k8s-master k8s-worker1 k8s-worker2 k8s-worker3
(crontab -l 2>/dev/null; echo "@reboot sleep 30 && /home/ubuntu/scripts/host-network.sh") | crontab -
```

**③ 이 상태로 AMI 다시 굽기.** 다음부터는: AMI로 시작 → EIP 재연결 → (자동) VM 부팅·모듈로드·DNAT → DB/Redis IP만 바뀌었으면 6단계 패치만 하면 끝입니다.

## qcow2 수동 백업 — PC 보관 (무료)

> 셋팅을 다 끝낸 클러스터를 **qcow2 통째로 백업 → PC 보관 → 새 EC2에 풀어서 부활**시킵니다.
> 재구축 때마다 겪던 고생(br_netfilter · flannel · metrics-server · configmap IP …)을 건너뛰고, "서버 다운 → 재구축 1~2시간"을 "복원 몇 분"으로 줄입니다.

### 원리

VM = `/var/lib/libvirt/images/*.qcow2`(디스크) + libvirt XML(정의). **이 둘만 있으면** 어느 KVM 호스트에서든 되살릴 수 있습니다.

```
[정상 클러스터] → 정지 → qcow2+XML 백업 → tar → PC 보관
                                              ↓ (나중에)
[새 EC2] ← virsh define+start ← qcow2+XML ← 업로드 ← PC
```

### 백업 전 필수 — VM IP 고정

복원 시 VM이 **새 IP**를 받으면 인증서 · kubeconfig · etcd가 옛 IP를 가리켜 **클러스터가 깨집니다.** 백업 전에 IP를 고정합니다.

```bash
# 호스트 EC2 — 각 VM의 MAC 확인
for vm in k8s-master k8s-worker1 k8s-worker2 k8s-worker3; do
  echo "$vm: $(sudo virsh domiflist $vm | awk 'NR==3{print $5}')"
done

# DHCP 예약 (MAC → 고정 IP). 현재 IP 그대로 박는 걸 권장
sudo virsh net-update default add ip-dhcp-host \
  "<host mac='<master-MAC>' name='k8s-master' ip='192.168.122.51'/>" --live --config
# worker1·2·3도 각각 (현재 virsh net-dhcp-leases default 의 IP로)
```
> XML에 MAC이 보존되므로, 예약만 같이 살리면 복원해도 같은 IP를 받습니다.

### 백업 (호스트 EC2 → PC)

```bash
# 1. VM 정지 (콜드 백업 — etcd 일관성 위해 필수. 켜진 채 복사 금지)
for vm in k8s-master k8s-worker1 k8s-worker2 k8s-worker3; do sudo virsh shutdown $vm; done
sudo virsh list --all        # 전부 shut off 확인 (안 꺼지면 sudo virsh destroy <vm>)

# 2. XML 정의 + 네트워크 백업
mkdir -p ~/vm-backup
for vm in k8s-master k8s-worker1 k8s-worker2 k8s-worker3; do
  sudo virsh dumpxml $vm > ~/vm-backup/$vm.xml
done
sudo virsh net-dumpxml default > ~/vm-backup/default-net.xml

# 3. qcow2 압축 복사 (30GB 할당이라도 실제 사용분만 → 용량이 크게 줄어듦)
for vm in k8s-master k8s-worker1 k8s-worker2 k8s-worker3; do
  sudo qemu-img convert -O qcow2 -c \
    /var/lib/libvirt/images/$vm.qcow2 ~/vm-backup/$vm.qcow2
done

# 4. 한 덩어리로 묶기
sudo tar czf ~/shoply-cluster.tar.gz -C ~/vm-backup .
ls -lh ~/shoply-cluster.tar.gz       # 보통 15~40GB

# 5. (백업 후 다시 쓰려면) VM 재시작
for vm in k8s-master k8s-worker1 k8s-worker2 k8s-worker3; do sudo virsh start $vm; done
```

PC로 다운로드:
```bash
scp -i key.pem ubuntu@<EC2-공인IP>:~/shoply-cluster.tar.gz ~/Downloads/
```

> 용량을 더 줄이려면 백업 전 VM 안에서 `sudo apt clean && sudo journalctl --vacuum-time=1d && sudo fstrim -av`.

### 복원 (새 EC2) — `restore-cluster.sh`

qcow2 복원의 유일한 번거로움은 "새 EC2에 KVM 또 깔기"입니다. [`scripts/restore-cluster.sh`](scripts/restore-cluster.sh)가 **디스크 확장 + KVM 설치 + DNS + qcow2 배치 + VM 정의/시작 + 호스트 네트워크(DNAT)**를 한 번에 합니다.

```bash
# 새 EC2(중첩 가상화 켜진 인스턴스 — onprem/README.md "KVM 가상머신 구축" 참고)에서
scp -i key.pem ~/Downloads/shoply-cluster.tar.gz ubuntu@<새EC2>:~/
scp -i key.pem scripts/restore-cluster.sh scripts/host-network.sh ubuntu@<새EC2>:~/
ssh -i key.pem ubuntu@<새EC2>
chmod +x restore-cluster.sh host-network.sh
./restore-cluster.sh shoply-cluster.tar.gz
```
> cloud-init ISO(cdrom) 참조는 스크립트가 자동 제거(`virt-xml --remove-device --disk device=cdrom`)하므로 ISO는 백업하지 않아도 됩니다.

### 복원 후 체크리스트

| 항목 | 확인/조치 |
|---|---|
| VM IP | `virsh net-dhcp-leases default` → 백업 때와 같은 IP인지 (고정했으면 OK) |
| 클러스터 | master에서 `kubectl get nodes` (4개 Ready), `kubectl get pods -A` |
| 호스트 IP 갱신 | 새 EC2는 새 사설IP → 모니터링 `prometheus.yml`의 **호스트 IP만** 교체 (VM 내부는 그대로) |
| DNAT | 새 EC2라 iptables가 비어 있음 → `host-network.sh` (스크립트가 자동 실행) |
| 외부 서버 | DB · Redis · 모니터링 EC2도 새로 떴으면 IP 갱신 — 위 [6. DB / Redis 사설IP 갱신](#6-db--redis-사설ip-갱신-configmap), [6-1. Loki](#6-1-loki-로그-수집-ip-갱신-promtail--event-exporter) 참고 |

### 흔한 함정

1. **cloud-init ISO 참조 에러** — XML이 `*-cloud-init.iso`(cdrom)를 참조하는데 복원 시 그 파일이 없으면 `virsh start`가 실패합니다. → 스크립트가 cdrom 디바이스를 지우고 시작합니다(cloud-init은 최초 1회로 이미 끝남).
2. **켜진 채 백업** → etcd가 어중간한 상태로 복사돼 복원 시 깨짐. **반드시 정지 후.**
3. **IP 안 고정** → 복원 시 IP가 바뀌어 클러스터가 깨짐 (위 "IP 고정" 필수).
4. **default 네트워크 대역 불일치** — 새 호스트의 libvirt default도 `192.168.122.0/24`여야 함(기본값이라 보통 일치). 다르면 `~/vm-backup/default-net.xml`로 맞춥니다.

### AMI vs qcow2 (비용 포함)

| 방법 | 보관 | 호스트가 죽어도? | 복원 시 KVM 설치 | 비용 |
|---|---|---|---|---|
| **qcow2 백업** | 내 PC | ✅ 부활 | 필요 (스크립트로 자동) | **무료** |
| virsh snapshot | EC2 디스크 | ❌ 같이 사라짐 | — | 무료 |
| EC2 AMI | AWS | ✅ 부활 | 불필요 (다 들어 있음) | 월 약 $2.5~3.3 (EBS 스냅샷) |

→ 무료로 가려면 qcow2 백업 + `restore-cluster.sh`, 비용을 감수하고 가장 빠른 복원을 원하면 AMI. 둘 다 떠 두면 가장 안전합니다.

## 트러블슈팅 — "파드는 다 Running인데 사이트가 안 들어감"

파드가 다 Ready인데 사이트가 안 열리면, 클러스터가 아니라 진입 경로(호스트/SG/ingress) 문제입니다. `curl -v http://<EIP>/`로 먼저 분류합니다.

| curl 반응 | 원인 | 조치 |
|---|---|---|
| 즉시 Connection refused | 호스트 iptables 비어 80/443 DNAT 없음(복원 직후 가장 흔함) | `./host-network.sh` + `sudo virsh net-start default` |
| 한참 멈추다 timeout | SG 인바운드 80/443 미허용, 또는 EIP가 새 인스턴스에 연결 안 됨 | SG 확인 + EIP를 현재 호스트에 연결(associate) |
| 404 nginx | ingress까지 도달했으나 host 규칙 매칭 실패 | 도메인 매핑 또는 catch-all ingress 적용 |

### 증상별 표

| 증상 | 원인 / 조치 |
|---|---|
| `kubectl get nodes` → `...:6443 was refused` (apiserver CrashLoop) | master VM 방화벽이 loopback(127.0.0.1)을 DROP — 재부팅 후 자주 발생. `curl -k -m 5 https://127.0.0.1:2379/health`가 timeout이면 확정 → [`TROUBLESHOOTING.md` 13번](TROUBLESHOOTING.md#13-kube-apiserver-crashloopbackoff--loopback127001-방화벽-drop-) |
| 위 조치(방화벽 flush) 후 호스트→master NodePort만 timeout | flush로 kube-proxy 규칙도 지워짐 → kube-proxy 파드 재시작([`TROUBLESHOOTING.md` 19번](TROUBLESHOOTING.md#19-nodeport가-외부호스트에서-안-됨--kube-proxy-재시작)) |
| 모든 파드 `ContainerCreating` + `flannel ... subnet.env: no such file` | flannel CrashLoop 먼저 해결(4-1) |
| flannel 파드 `CrashLoopBackOff`(일부 노드만) | 그 노드에 br_netfilter 안 올라옴 → 그 워커 안에서 modprobe |
| `modprobe` 했는데 계속 `no such file` | master에서 친 것일 수 있음 — 죽은 그 워커 안에서 해야 함 |
| `virsh list`에 VM 안 보임 | `--all`로 보면 'shut off' → `virsh start` + `autostart` |
| `virsh list --all`도 비어있는데 qcow2는 있음 | 정의만 날아감 → `virsh define` 또는 virt-install `--import` 재정의 |
| qcow2 파일조차 없음 | 별도 EBS였고 AMI(root)에 미포함 → 그 볼륨 스냅샷으로 복구 |
| 외부 curl Connection refused | 호스트 DNAT 누락/IP불일치 → `./host-network.sh` 재실행 |
| 백엔드 파드 `0/1` | DB/Redis IP 불일치 → 6단계 configmap 패치 |
| Grafana Loki 로그 안 뜸 | 모니터링 IP 바뀜 → 6-1단계 |
| `grep -c vmx /proc/cpuinfo` = 0 | 중첩 가상화 꺼짐 → 인스턴스 CPU 옵션에서 재활성화 |

## 요약

```
[AMI 백업]  VM shutdown → sync → AMI 생성(No reboot)
[AMI 복원]  AMI로 스팟 시작 → EIP 재연결 → virsh start+autostart
        → ./host-network.sh (DNAT/메트릭, 호스트IP 자동)
        → configmap DB/Redis IP 패치 + rollout restart
        → Promtail/event-exporter push IP 갱신 (Loki 로그용)
        → kubectl get nodes/pods 확인

[qcow2 백업]  VM shutdown → dumpxml + qemu-img convert -c → tar → PC
[qcow2 복원]  새 EC2 → ./restore-cluster.sh <tar> (KVM 설치~DNAT 자동) → IP 갱신
```

클러스터(VM 내부)는 qcow2에 통째로 들어있어 그대로 부활합니다(IP 고정 덕에 안 깨짐). 매번 바뀌는 IP 3종: 호스트 사설IP(`host-network.sh` 자동) + DB/Redis IP(configmap 패치) + 모니터링 IP(Promtail push URL).
