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

에러가 두 개 떴는데, **어느 쪽이 원인이고 어느 쪽이 결과인지**부터 나눴다.

- `subnet.env 없음` — 이 파일은 flannel이 정상적으로 뜨면 **스스로 만드는 파일**이다. 그러니 이 에러는 "flannel이 제대로 안 떴다"는 **결과**일 뿐이다.
- `bridge-nf-call-iptables 없음` — `/proc/sys/` 아래 파일은 사람이 만드는 설정 파일이 아니라, **커널 기능이 켜져 있으면 자동으로 보이는 파일**이다. 이게 없다는 건 그 기능(br_netfilter 모듈)이 아예 꺼져 있다는 뜻이다. 이쪽이 **원인**이다.

정리하면 순서는 이렇다.

```
br_netfilter 모듈 안 올라옴 → flannel 기동 실패 → subnet.env 안 만들어짐 → 파드 생성 실패
```

그래서 flannel 설정을 뒤지지 않고 맨 앞 단계인 모듈부터 확인했고, `lsmod`에 아무것도 안 나오는 걸로 확정했다. 그리고 커널 모듈은 노드마다 따로 올라가는 것이라, 한 노드에서 고쳤다고 다른 노드가 낫지 않는다는 점도 여기서 알게 됐다.

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
