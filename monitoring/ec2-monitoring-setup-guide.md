# Monitoring EC2 설정 가이드

> Prometheus + Grafana Docker Compose 구성  
> t3.small EC2, EIP 고정 필수

---

## 전제 조건

- t3.small EC2 생성 완료 + EIP 할당 완료
- 보안그룹 인바운드:

| 포트 | 소스 | 용도 |
|------|------|------|
| 22 | Admin IP/32 | SSH |
| 9090 | Admin IP/32 | Prometheus UI |
| 3000 | Admin IP/32 | Grafana 대시보드 |
| 9090 | k6 EC2 SG | 온프레 k6 결과 수신 (remote-write) |
| 9091 | k6 EC2 SG | EKS k6 결과 수신 (remote-write) |
| 3100 | c8i-flex.2xlarge SG | 온프레 클러스터 로그 수신 (Promtail·event-exporter → Loki) |

- 보안그룹 아웃바운드:

| 포트 | 목적지 | 용도 |
|------|--------|------|
| 30400~30404 | c8i-flex.2xlarge SG | 온프레미스 앱 메트릭 NodePort |
| 30400~30404 | 0.0.0.0/0 | EKS 앱 메트릭 NodePort (cross-VPC) |
| 9100, 39101~39103 | c8i-flex.2xlarge SG | 온프레미스 node_exporter (호스트 / worker1·2·3) |
| 38080~38081 | c8i-flex.2xlarge SG | 온프레미스 cAdvisor (worker1·2) |
| 9100 | 0.0.0.0/0 | EKS node_exporter (cross-VPC) |
| 9187 | PostgreSQL SG | postgresql_exporter |
| 9121 | Redis SG | redis_exporter (양쪽) |
| 30800 | c8i-flex.2xlarge SG | 온프레미스 kube-state-metrics |
| 30800 | 0.0.0.0/0 | EKS kube-state-metrics (cross-VPC) |

---

## 1. EC2 User Data (인스턴스 생성 시)

> **파일 참고:** [`userdata/monitoring.sh`](../userdata/monitoring.sh) 내용을 User Data에 붙여넣기
>
> 완료 확인: `cat /var/log/user-data.log`

---

## 2. 파일 전송 (로컬에서, 이 저장소 루트 기준)

```bash
scp -i ~/key/aws-3tier-keypair.pem -r \
  ./monitoring \
  ubuntu@<Monitoring-EC2-공인IP>:~/
```

---

## 3. Prometheus 설정의 호스트 IP 바꾸기

파일 위치: `~/monitoring/prometheus/prometheus-onprem.yml` (`docker-compose.yml`이 이 파일을 사용)

온프레미스 타겟(앱 메트릭·cAdvisor·node_exporter·kube-state-metrics)은 전부 **호스트 EC2 한 곳**으로 수집합니다. KVM VM에는 공인 IP가 없어서, 호스트가 포트별로 각 VM에 넘겨주기(DNAT) 때문입니다([`onprem/scripts/host-network.sh`](../onprem/scripts/host-network.sh)). 그래서 VM별 IP는 필요 없고, **파일 안의 호스트 사설 IP 한 곳만** 현재 값으로 바꾸면 됩니다.

**호스트 사설 IP 확인 (호스트 EC2에서):**
```bash
hostname -I | awk '{print $1}'
```

**IP 교체 (모니터링 EC2에서):**
```bash
OLD=10.0.11.78          # 파일에 적혀 있는 이전 호스트 IP
NEW=<호스트-EC2-사설IP>
sed -i "s/$OLD/$NEW/g" ~/monitoring/prometheus/prometheus-onprem.yml
```

| 수집 대상 | 포트(호스트 기준) |
|---|---|
| 앱 메트릭 (gateway·product·inventory·order·payment) | 30400~30404 |
| cAdvisor (worker1·2) | 38080·38081 |
| node_exporter (호스트 / worker1·2·3) | 9100 / 39101~39103 |
| kube-state-metrics | 30800 (고정) |

> EKS용 Prometheus(`prometheus-eks`, 9091)는 EKS 워커 노드의 kube-state-metrics(30800)·node_exporter(9100)·앱 메트릭(30400~30404)·cAdvisor를 수집하고, EKS 쪽 k6 결과(remote-write)도 받습니다. 설정 파일은 `prometheus-eks/prometheus-eks.yml`입니다.

---

## 4. 실행

```bash
ssh -i ~/key/aws-3tier-keypair.pem ubuntu@<Monitoring-EC2-공인IP>

cd ~/monitoring
docker compose up -d
docker compose ps
```

**접속:**
- Prometheus: `http://<Monitoring-EIP>:9090`
- Grafana: `http://<Monitoring-EIP>:3000`
  - ID: `admin` / PW: `admin1234` (실습용 기본값 — 외부 노출 시 반드시 변경)

---

## 5. Grafana 설정

### 데이터소스 (자동 등록)
`docker-compose.yml`이 [`grafana-datasources.yml`](grafana-datasources.yml)을 Grafana에 연결해 두어, Grafana를 켜면 아래 4개가 자동으로 등록됩니다. 따로 추가할 필요가 없습니다.

| 이름 | 주소 | ID(uid) | 용도 |
|---|---|---|---|
| Prometheus | `http://prometheus:9090` | `prometheus-onprem` | 온프레미스 메트릭 + 온프레 k6 결과 |
| Prometheus-EKS | `http://prometheus-eks:9091` | `prometheus-eks` | EKS k6 결과 |
| Loki | `http://loki:3100` | `loki` | 클러스터 로그·이벤트 |
| Tempo | `http://tempo:3200` | `tempo` | 트레이스 (탐색용, 실험에는 미사용) |

> Grafana 화면(Connections → Data sources)에서 직접 추가할 수도 있지만, 그러면 ID가 무작위로 만들어져 아래 대시보드 JSON이 데이터소스를 찾지 못합니다. 직접 추가한다면 ID를 위 표와 똑같이 맞춰야 합니다.

### 대시보드 가져오기 (직접 만든 JSON)
공개 템플릿 대신 실험용으로 직접 만든 대시보드를 씁니다. Dashboards → New → Import → JSON 파일 업로드.

| 파일 | 대시보드 | 용도 |
|---|---|---|
| [`grafana-dashboard-compare.json`](grafana-dashboard-compare.json) | 반반 비교 — 온프레 │ EKS | 노드 수·Running/Pending·노드별 CPU를 좌우로 비교 (실행 ② 캡처) |
| [`grafana-dashboard-load.json`](grafana-dashboard-load.json) | 부하 테스트 (k6) — 온프레 │ EKS | VU·RPS·실패율을 좌우로 비교 |
| [`grafana-dashboard-onprem.json`](grafana-dashboard-onprem.json) | 온프레미스 — 노드 자동확장 실험 | 온프레 상세 (성능·HPA·파드 자원·로그) |
| [`grafana-dashboard-eks.json`](grafana-dashboard-eks.json) | EKS 전용 — 노드 자동확장 | EKS 상세 |
| [`grafana-dashboard-recommend.json`](grafana-dashboard-recommend.json) | 온프레/EKS 토글 | 데이터소스 변수(`$ds`)로 한 화면에서 전환 |

---

## 6. Prometheus 설정 리로드 (IP 변경 후)

```bash
# prometheus.yml 수정 후 재시작 없이 반영
curl -X POST http://localhost:9090/-/reload

# 또는 컨테이너 재시작
docker compose restart prometheus
```

---

## 7. 초기화

```bash
# 컨테이너만 재시작 (데이터 유지)
docker compose restart

# 데이터 포함 완전 초기화
docker compose down -v
docker compose up -d
```
