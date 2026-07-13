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

- 보안그룹 아웃바운드:

| 포트 | 목적지 | 용도 |
|------|--------|------|
| 30400~30404 | c8i.2xlarge SG | 온프레미스 앱 메트릭 NodePort |
| 30400~30404 | 0.0.0.0/0 | EKS 앱 메트릭 NodePort (cross-VPC) |
| 9100 | c8i.2xlarge SG | 온프레미스 node_exporter |
| 9100 | 0.0.0.0/0 | EKS node_exporter (cross-VPC) |
| 9187 | PostgreSQL SG | postgresql_exporter |
| 9121 | Redis SG | redis_exporter (양쪽) |
| NodePort | c8i.2xlarge SG | kube-state-metrics |

---

## 1. EC2 User Data (인스턴스 생성 시)

> **파일 참고:** `msa_shoply/infra/userdata/monitoring.sh` 내용을 User Data에 붙여넣기
>
> 완료 확인: `cat /var/log/user-data.log`

---

## 2. 파일 전송 (로컬 Mac에서)

```bash
scp -i ~/key/aws-3tier-keypair.pem -r \
  /Users/kimminseo/shopping_k8s/msa_shoply/infra/monitoring \
  ubuntu@<Monitoring-EC2-공인IP>:~/
```

---

## 3. prometheus.yml IP 채우기

파일 위치: `~/monitoring/prometheus/prometheus.yml`

| 플레이스홀더 | 실제 값 |
|-------------|--------|
| `<c8i-사설IP>` | c8i.2xlarge 사설 IP (lxc list로 확인) |
| `<LXD_MASTER_IP>` | VM1 Master LXD IP |
| `<LXD_WORKER1_IP>` | VM2 Worker1 LXD IP |
| `<LXD_WORKER2_IP>` | VM3 Worker2 LXD IP |
| `<PostgreSQL-사설IP>` | PostgreSQL EC2 사설 IP (`10.0.2.128`) |
| `<Redis-사설IP>` | Redis EC2 사설 IP (`10.0.6.15`) |
| `<EKS-worker1-공인IP>` | EKS Worker Node 1 공인 IP |
| `<EKS-worker2-공인IP>` | EKS Worker Node 2 공인 IP |
| `<EKS-Redis-공인IP>` | EKS Redis EC2 공인 IP |
| `<kube-state-NodePort>` | kube-state-metrics NodePort (보통 31000번대) |
| `<pg-exporter-NodePort>` | EKS postgresql_exporter NodePort |

**LXD IP 확인 방법 (c8i.2xlarge에서):**
```bash
lxc list
```

**kube-state-metrics NodePort 확인:**
```bash
lxc exec k8s-master -- kubectl get svc -n monitoring
```

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
  - ID: `admin` / PW: `admin1234`

---

## 5. Grafana 설정

### Prometheus 데이터소스 추가
1. 좌측 메뉴 → Connections → Data sources → Add data source
2. Prometheus 선택
3. URL: `http://prometheus:9090`
4. Save & Test

### 대시보드 Import (템플릿)

| 대시보드 | ID | 용도 |
|---------|-----|------|
| Node Exporter Full | `1860` | CPU/Memory per node |
| Kubernetes Cluster Monitoring | `315` | Pod/Node/Pending Pod |
| PostgreSQL Database | `9628` | DB 커넥션, Lock 대기 |
| Redis Dashboard | `11835` | 캐시 히트율 |

Import 방법: Dashboards → Import → ID 입력 → Load

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
