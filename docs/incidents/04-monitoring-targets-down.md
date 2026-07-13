# 장애 내용

재구축·복원 후 Prometheus 타겟 다수가 down. 앱 메트릭·kube-state·cAdvisor가 전부 안 잡혀서 실험 관측이 불가능한 상태 — 이 프로젝트는 관측이 목적이라, 모니터링이 죽으면 실험 자체가 무의미해진다.

## 증상

- `app-onprem`, `kube-state-onprem`, `cadvisor` 타겟 전부 down
- 그런데 `node-db`(PostgreSQL/Redis EC2의 node_exporter) 타겟은 **up**
- 에러 알림은 없음 — Prometheus 타겟 페이지를 열어보고서야 발견

## 로그

```
node-onprem        2/3 up   — "<호스트IP>:9100"  Error: connect: connection refused
kube-state-onprem  0/1 up   — "<호스트IP>:30800" down
```

```bash
curl -m5 -s -o /dev/null -w "9100: %{http_code}\n" http://<호스트IP>:9100/metrics   # 직접 경로
curl -m5 -v http://<호스트IP>:30400/metrics 2>&1 | grep -iE "refused|timed"          # DNAT 경유 경로
```

## 원인 분석

down인 타겟과 up인 타겟의 차이를 보니 경로가 갈렸다 — down인 것들은 전부 **호스트 DNAT를 경유**하는 타겟이고, up인 것은 **EC2에 직접** 붙는 타겟이었다. 즉 클러스터나 exporter의 문제가 아니라 호스트 포워딩 계층의 문제.

curl 두 방으로 원인을 표로 좁혔다:

| 결과 | 원인 |
|---|---|
| 9100=200, 30400=refused | 호스트에 DNAT 규칙 없음 |
| 9100=200, 30400=timeout | 호스트 `ip_forward=0` 또는 FORWARD 차단 |
| 9100도 timeout | SG가 그 포트 자체를 차단 |

추가로 두 개의 함정이 겹쳐 있었다:

1. **호스트에서 실행해야 할 명령을 master VM 안에서 치고 있었다** — 프롬프트가 `root@k8s-master`인 걸 뒤늦게 확인. DNAT/ip_forward는 virsh가 돌아가는 호스트 EC2의 설정이다.
2. 최초 구축 때는 아예 **node_exporter(호스트)·kube-state-metrics(클러스터)가 설치 자체가 안 돼 있었다** — 에러 없이 "그냥 안 떠 있는" 형태라 놓쳤다.

## 왜 그렇게 판단했는가

*(아래는 TROUBLESHOOTING.md에 남은 진단 순서를 보고 재구성한 초안입니다 — 실제 생각 흐름과 다르면 고쳐주세요)*

"전부 죽었다"가 아니라 **"일부는 살아있다"는 게 단서**라고 봤다. 살아있는 것(node-db)과 죽은 것(app/kube-state/cadvisor)의 공통점을 찾으면 고장난 계층이 나온다 — 이 경우 갈림길이 "호스트 DNAT 경유 여부"였다. 그리고 지금 어느 머신에 있는지 확인하는 습관(`hostname -I`에 `192.168.122.1`이 보이면 호스트, `virsh list`가 되면 호스트)을 진단 첫 단계로 넣었다. loopback 방화벽 장애([01](01-kube-apiserver-loopback-firewall.md))에서 세운 "refused=리스너 없음 / timeout=패킷이 버려짐" 원칙을 여기서도 그대로 재사용했다.

## 해결 과정

1. **호스트 EC2로 나와서**(master VM 아님) `ip_forward` 확인·활성화:
   ```bash
   cat /proc/sys/net/ipv4/ip_forward          # 0이면 범인
   sudo sysctl -w net.ipv4.ip_forward=1
   echo "net.ipv4.ip_forward=1" | sudo tee /etc/sysctl.d/99-k8s-forward.conf
   ```
2. 누락된 DNAT/FORWARD 규칙을 `host-network.sh`로 재적용
3. 최초 구축 시점에는 호스트에 node_exporter를 systemd 서비스로 설치하고, 클러스터에 kube-state-metrics를 helm으로 설치

## 결과

Prometheus 타겟이 전부 up으로 복구되어 Grafana 대시보드에 노드 CPU·Pending 파드·앱 메트릭이 다시 흐르기 시작했다. 이 상태가 확보된 뒤에야 온프레미스 한계 실험과 EKS 비교 실험을 신뢰할 수 있는 데이터로 진행할 수 있었다.

## 재발 방지

- 재구축 후 체크리스트에 추가: `kubectl get pods -n kube-system`에 kube-state-metrics/metrics-server가 있는지, 호스트에서 `systemctl status node_exporter`가 active인지 — **"에러 없이 조용히 빠져 있는" 실패는 체크리스트로만 잡을 수 있다.**
- 진단 시작 전에 "여기가 호스트인가 VM인가"부터 확인하는 습관을 절차화했다(`virsh list`가 되면 호스트).
- 타겟이 여러 개 죽으면 개별로 파지 말고, up/down을 가르는 **공통 경로**부터 찾는다.
