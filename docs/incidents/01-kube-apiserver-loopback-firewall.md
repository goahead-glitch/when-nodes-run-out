# 장애 내용

kube-apiserver가 CrashLoopBackOff에 빠져 `kubectl get nodes`가 응답하지 않고, 클러스터 전체가 먹통이 됨.

## 증상

- `kubectl get nodes` → `The connection to the server 192.168.122.101:6443 was refused`
- kubelet·containerd·etcd 프로세스는 모두 살아있는데 apiserver만 계속 재시작
- etcd readiness probe도 실패

## 로그

```
# kubelet 로그
"StartContainer" for "kube-apiserver" with CrashLoopBackOff
etcd Readiness probe failed: Get "http://127.0.0.1:2381/readyz": context deadline exceeded

# apiserver 로그 마지막
F Error creating leases: error creating storage factory: context deadline exceeded
```

## 원인 분석

apiserver는 `--etcd-servers=https://127.0.0.1:2379`로 **loopback으로만** etcd에 붙는 구조다. loopback과 노드IP를 각각 curl로 때려 비교했다.

```
curl -k -m 5 https://127.0.0.1:2379/health        # → Connection timed out (X)
curl -k -m 5 https://192.168.122.101:2379/health  # → TLS 인증서 에러 (O, TCP는 됨)
```

127.0.0.1은 timeout, 노드IP는 TLS에러(=TCP는 연결됨)라는 비대칭 패턴을 확인했고, nftables에서 `ip daddr 127.0.0.0/8 ct status dnat ... counter packets 10247 ... drop` 같은 DROP 룰의 카운터가 계속 올라가고 있는 걸 발견했다.

## 왜 그렇게 판단했는가

*(아래는 TROUBLESHOOTING.md에 남은 진단 순서를 보고 제가 추론해서 쓴 초안입니다 — 실제 생각 흐름과 다르면 고쳐주세요)*

`connection refused`(즉시 거부)가 아니라 `i/o timeout`(응답이 조용히 사라짐)이라는 차이에 주목했다. 전자는 "그 포트에 아무도 리스닝하지 않는다"는 뜻이고, 후자는 "패킷이 어딘가에서 버려지고 있다"는 뜻이라 서비스 자체보다 중간 경로(방화벽)를 의심하는 게 맞다고 판단했다. 같은 etcd를 loopback 경로와 노드IP 경로 두 가지로 각각 찔러봐서 "loopback 경로만 막혀 있다"는 걸 대조 실험으로 좁혔고, nftables 카운터가 실제로 증가하는 걸 보고 최종 확정했다.

## 해결 과정

master VM에서 방화벽 규칙을 전부 비우고 기본 정책을 ACCEPT로 바꿨다.

```bash
iptables -F
iptables -t nat -F
iptables -t mangle -F
iptables -P INPUT ACCEPT
iptables -P FORWARD ACCEPT
iptables -P OUTPUT ACCEPT
nft flush ruleset

# loopback 뚫렸는지 확인 (timeout 대신 TLS 에러가 나오면 성공)
curl -k -m 5 https://127.0.0.1:2379/health

systemctl restart kubelet
```

## 결과

1~2분 후 apiserver가 정상 기동되며 클러스터가 다시 응답했다. 다만 방화벽을 통째로 비우면서 kube-proxy가 관리하던 NodePort 규칙도 같이 날아가, 외부에서 NodePort로 붙던 접속이 끊기는 부수 문제가 이어졌다 — `kube-proxy` 파드를 재시작해 규칙을 재생성해야 했다(전체 20개 항목 로그는 [`../../onprem/TROUBLESHOOTING.md`](../../onprem/TROUBLESHOOTING.md) 19번 참고).

## 재발 방지

- 재부팅/재구축 과정에서 flannel·kube-proxy가 반쯤 깨진 상태로 방화벽 룰이 오염될 수 있다는 걸 확인했고, 클러스터 복원 절차([`../../onprem/BACKUP-RESTORE.md`](../../onprem/BACKUP-RESTORE.md))에 방화벽 상태 확인 단계를 넣었다.
- `connection refused` vs `i/o timeout` 구분을 이후 모든 네트워크 장애의 1차 진단 기준으로 삼았다(모니터링 타겟 진단에도 같은 원칙을 재사용).
