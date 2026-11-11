# 장애 내용

클러스터 내부는 전부 정상(파드 Ready, ingress 정상)인데 외부에서 사이트가 안 열림. EC2 재구축 이후 반복적으로 발생했고, 해결 과정에서 이미지 pull까지 깨지는 2차 장애로 번짐.

## 증상

- 외부에서 `curl http://<EIP>` → 즉시 `Connection refused` (timeout이 아니라 수십 ms 만에 거부)
- `kubectl get ingress`, ingress-nginx 서비스는 정상 (EXTERNAL-IP = MetalLB VIP)
- 클러스터 내부에서 ingress를 직접 호출하면 정상 응답

## 로그

```bash
curl -v http://<EIP>/
# → connect to <EIP> port 80 failed: Connection refused (즉시)

sudo iptables -t nat -L PREROUTING -n -v --line-numbers | grep -E "dpt:80|dpt:443"
# → 아무 규칙도 없음 (또는 옛날 사설IP가 박힌 규칙)
```

## 원인 분석

이 구조에서 외부 트래픽은 `EIP → 호스트 EC2 → iptables DNAT → MetalLB VIP → ingress` 경로를 탄다. KVM VM에는 공인 IP가 없어서 호스트의 PREROUTING DNAT 규칙이 유일한 진입로인데:

1. **규칙 자체가 없거나** (복원 직후 — iptables는 AMI에 저장되지 않음)
2. **규칙의 `-d $HOST_IP`가 이전 재구축 때의 사설IP로 박혀 있어** 현재 IP와 불일치 (EC2를 재생성하면 사설IP가 바뀜)

둘 중 하나였다. `hostname -I`로 현재 IP를 확인해 규칙의 IP와 대조하면 바로 판별됐다.

## 왜 그렇게 판단했는가

curl이 **어떻게 실패하는지**를 먼저 봤다. 실패하는 모양에 따라 패킷이 어디까지 갔는지가 갈린다.

| curl 반응 | 패킷이 어디까지 갔나 | 의심할 곳 |
|---|---|---|
| **바로** Connection refused (수십 ms) | 호스트 EC2까지는 왔는데, 받아서 넘겨줄 규칙이 없다 | 호스트의 DNAT 규칙 (없거나 IP가 틀림) |
| 한참 기다리다 timeout | 호스트까지 오지도 못했다 | 보안그룹(SG), EIP 연결 |
| 404 nginx | ingress까지 왔다 | ingress의 host 규칙 |

이번엔 **바로 refused**였다. 그러면 SG나 EIP는 통과했다는 뜻이니, 호스트 안의 DNAT 규칙만 보면 된다. 게다가 클러스터 안에서 ingress를 직접 호출하면 정상이었으니, 클러스터는 멀쩡하고 **바깥에서 들어오는 입구만 막혔다**고 판단했다. 실제로 PREROUTING을 열어 보니 규칙이 없거나 예전 사설IP가 박혀 있었다.

## 해결 과정

현재 호스트 IP를 다시 읽어 규칙을 재생성했다.

```bash
sudo iptables -t nat -D PREROUTING <옛 규칙 번호들>   # 낡은 규칙 제거

HOST_IP=$(hostname -I | awk '{print $1}')
VIP=192.168.122.240   # MetalLB EXTERNAL-IP
sudo iptables -t nat -A PREROUTING -d $HOST_IP -p tcp --dport 80  -j DNAT --to-destination $VIP:80
sudo iptables -t nat -A PREROUTING -d $HOST_IP -p tcp --dport 443 -j DNAT --to-destination $VIP:443
```

## 결과

외부 접속은 복구됐지만, 한 번은 `-d $HOST_IP` 없이 `--dport 443` 전체를 DNAT하는 규칙을 넣었다가 **2차 장애**를 만들었다 — 워커 노드가 ghcr.io로 이미지를 pull하는 443 트래픽까지 ingress로 리다이렉트돼, 새로 뜨는 파드마다 `x509: certificate is valid for ingress.local, not ghcr.io` 에러로 ImagePullBackOff에 빠졌다. 목적지 IP를 명시한 규칙으로 교체하고 실패한 파드를 지워 해결했다(상세: [`../../onprem/TROUBLESHOOTING.md`](../../onprem/TROUBLESHOOTING.md) 20번).

## 재발 방지

- IP 자동 감지(`hostname -I`) 기반의 `host-network.sh` 스크립트로 규칙 생성을 스크립트화해, 재구축 때마다 손으로 IP를 박다가 틀리는 실수를 제거했다([`../../onprem/scripts/host-network.sh`](../../onprem/scripts/host-network.sh)).
- 복원 절차에 `@reboot` crontab으로 이 스크립트를 자동 실행하도록 등록했다([`../../onprem/BACKUP-RESTORE.md`](../../onprem/BACKUP-RESTORE.md)).
- DNAT 규칙은 반드시 `-d <목적지IP>`로 범위를 좁힌다 — 포트 전체를 잡는 광역 규칙은 정상 아웃바운드 트래픽까지 삼킨다는 걸 2차 장애로 배웠다.
