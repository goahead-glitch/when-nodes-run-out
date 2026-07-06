# AMI 백업 / 복원 — 스팟 호스트 EC2 빠른 복구

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

EC2 → AMI → 해당 AMI 선택 → AMI로 인스턴스 시작. 인스턴스 타입은 **c8i.2xlarge**(중첩 가상화 동일), 구매 옵션 **스팟**, 기존 호스트 EC2 보안그룹 사용.

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
[백업]  VM shutdown → sync → AMI 생성(No reboot)
[복원]  AMI로 스팟 시작 → EIP 재연결 → virsh start+autostart
        → ./host-network.sh (DNAT/메트릭, 호스트IP 자동)
        → configmap DB/Redis IP 패치 + rollout restart
        → Promtail/event-exporter push IP 갱신 (Loki 로그용)
        → kubectl get nodes/pods 확인
```

클러스터(VM 내부)는 qcow2에 통째로 들어있어 그대로 부활합니다(IP 고정 덕에 안 깨짐). 매번 바뀌는 IP 3종: 호스트 사설IP(`host-network.sh` 자동) + DB/Redis IP(configmap 패치) + 모니터링 IP(Promtail push URL).
