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

**전부 죽은 게 아니라 일부는 살아 있다**는 점이 단서였다. 전부 죽었다면 Prometheus나 네트워크 전체를 의심했겠지만, 살아 있는 게 있으니 **살아 있는 것과 죽은 것의 차이**를 찾으면 된다.

- 살아 있는 것: `node-db` → DB EC2에 **바로** 붙는다.
- 죽은 것: 앱·kube-state·cAdvisor → 호스트 EC2를 **거쳐서(DNAT)** VM 안으로 들어간다.

그래서 클러스터나 exporter가 아니라 **호스트가 VM으로 넘겨주는 부분**이 고장 났다고 좁혔다. 그다음 같은 호스트에 포트 두 개로 curl을 쳐서 확인했다.

- 9100(호스트 자기 자신) → 되면 호스트까지 가는 길(SG)은 정상
- 30400(VM으로 넘겨야 하는 포트) → **바로 refused**면 넘겨줄 규칙(DNAT)이 없음, **timeout**이면 넘겨주는 기능(`ip_forward`)이 꺼져 있음

그리고 고치는 도중 프롬프트가 `root@k8s-master`인 걸 보고, 호스트에서 쳐야 할 명령을 **VM 안에서 치고 있었다**는 걸 알아챘다. 그 뒤로는 명령을 치기 전에 "지금 호스트인가 VM인가"(`virsh list`가 되면 호스트)부터 확인한다.

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
