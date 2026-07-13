# 장애 내용

flannel 파드가 전 워커에서 CrashLoopBackOff에 빠져, 클러스터의 파드 네트워크가 통째로 동작하지 않음. 새로 뜨는 파드는 전부 ContainerCreating에서 멈춤.

## 증상

- 워커 노드 전체에서 flannel 파드가 계속 재시작
- 앱 파드들은 `ContainerCreating` 상태로 무한 대기
- 재부팅·AMI 복원 후에 반복적으로 재발

## 로그

```
FailedCreatePodSandBox ... flannel: loadFlannelSubnetEnv failed:
/run/flannel/subnet.env: no such file or directory

Failed to check br_netfilter:
stat /proc/sys/net/bridge/bridge-nf-call-iptables: no such file or directory
```

## 원인 분석

두 번째 로그가 결정적이었다. `/proc/sys/net/bridge/bridge-nf-call-iptables`는 커널 모듈 `br_netfilter`가 로드돼야만 생기는 파일인데, "no such file or directory"라는 건 모듈 자체가 안 올라와 있다는 뜻이다. flannel은 시작할 때 이 값을 확인하는데, 없으니 기동에 실패하고, flannel이 없으니 `subnet.env`도 생성되지 않아 첫 번째 에러(파드 샌드박스 생성 실패)로 이어진 것이다.

```bash
lsmod | grep br_netfilter    # → 아무것도 안 나옴 (모듈 미로드 확정)
```

## 왜 그렇게 판단했는가

*(아래는 TROUBLESHOOTING.md에 남은 진단 순서를 보고 재구성한 초안입니다 — 실제 생각 흐름과 다르면 고쳐주세요)*

에러 메시지 두 개가 인과관계로 연결돼 있다고 봤다. `subnet.env 없음`만 보면 flannel 설정 문제처럼 보이지만, 그건 결과일 뿐이고 `bridge-nf-call-iptables` 파일이 없다는 게 더 낮은 계층(커널)의 원인이라고 판단했다. `/proc/sys/` 아래 파일은 설정 파일이 아니라 커널 상태의 반영이므로, "파일이 없다 = 해당 커널 기능이 없다 = 모듈 미로드"로 좁힐 수 있었다. 또 특정 노드에서만 재발하는 경우가 있었는데, 이건 클러스터 설정(전역)이 아니라 노드별 커널 상태(지역) 문제라는 방증이었다.

## 해결 과정

모든 노드(master 포함)에서 모듈을 로드하고 영구화했다.

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

그다음 master에서 죽은 flannel 파드를 삭제해 재생성시켰다.

```bash
kubectl delete pod -n kube-flannel --all
```

## 결과

flannel 4개 파드가 전부 1/1 Running으로 복구되고, ContainerCreating에 멈춰 있던 앱 파드들이 순차적으로 기동됐다. 다만 함정이 하나 있었는데 — `modprobe`를 **master에서 치고 워커가 낫기를 기대하면 안 된다**. 커널 모듈은 노드별 상태라 죽은 그 워커 안에서 실행해야 한다(원격 SSH로 워커에 들어가서 실행).

## 재발 방지

- `/etc/modules-load.d/k8s.conf`로 부팅 시 자동 로드를 영구화하고, **이 상태로 AMI를 다시 구워** 복원 후 재발 자체를 차단했다([`../../onprem/BACKUP-RESTORE.md`](../../onprem/BACKUP-RESTORE.md)의 "무삽질 복원" 절차).
- "일부 노드만 이상하다 = 그 노드의 로컬 상태(커널 모듈, 방화벽)를 먼저 본다"를 진단 원칙으로 추가했다.
