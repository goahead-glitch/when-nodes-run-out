#!/bin/bash
exec > /var/log/user-data.log 2>&1
set -e

apt-get update -y

# ── Docker 설치 ──────────────────────────────────────────────
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | tee /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable docker && systemctl start docker
usermod -aG docker ubuntu

# ── 작업 디렉토리 ────────────────────────────────────────────
MON=/home/ubuntu/monitoring
mkdir -p $MON/prometheus

# ── docker-compose.yml (IP 없음 — 그대로 고정) ──────────────
cat > $MON/docker-compose.yml <<'COMPOSE'
services:
  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    restart: always
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=15d'
      - '--web.enable-lifecycle'
      - '--web.enable-remote-write-receiver'
      - '--web.enable-admin-api'

  prometheus-eks:
    image: prom/prometheus:latest
    container_name: prometheus-eks
    restart: always
    ports:
      - "9091:9090"
    volumes:
      - ./prometheus-eks/prometheus-eks.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus_eks_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=15d'
      - '--web.enable-lifecycle'
      - '--web.enable-remote-write-receiver'
      - '--web.enable-admin-api'

  loki:
    image: grafana/loki:2.9.8
    container_name: loki
    restart: always
    ports:
      - "3100:3100"
    command: -config.file=/etc/loki/loki-config.yml
    volumes:
      - ./loki-config.yml:/etc/loki/loki-config.yml:ro
      - loki_data:/loki

  grafana:
    image: grafana/grafana:latest
    container_name: grafana
    restart: always
    ports:
      - "3000:3000"
    volumes:
      - grafana_data:/var/lib/grafana
      - ./grafana-datasources.yml:/etc/grafana/provisioning/datasources/datasources.yml:ro
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=admin1234
      - GF_USERS_ALLOW_SIGN_UP=false

volumes:
  prometheus_data:
  prometheus_eks_data:
  grafana_data:
  loki_data:
COMPOSE

# ── loki-config.yml (IP 없음) ───────────────────────────────
cat > $MON/loki-config.yml <<'LOKI'
auth_enabled: false
server:
  http_listen_port: 3100
common:
  instance_addr: 127.0.0.1
  path_prefix: /loki
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules
  replication_factor: 1
  ring:
    kvstore:
      store: inmemory
schema_config:
  configs:
    - from: 2024-01-01
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h
limits_config:
  retention_period: 168h
  ingestion_rate_mb: 16
  ingestion_burst_size_mb: 32
  reject_old_samples: false
compactor:
  working_directory: /loki/compactor
  retention_enabled: true
  delete_request_store: filesystem
LOKI

# ── grafana-datasources.yml (IP 없음 — 서비스명 사용) ───────
cat > $MON/grafana-datasources.yml <<'GRAFANA'
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
  - name: Prometheus-EKS
    type: prometheus
    access: proxy
    url: http://prometheus-eks:9090
  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
GRAFANA

# ── prometheus.yml (스텁 — 크래시 방지용. 실제 타겟은 따로 교체) ──
#    재구축마다 호스트/DB/Redis 사설IP가 바뀌므로 여기엔 안 박는다.
#    실제 타겟이 든 prometheus.yml(repo: team/infra/monitoring/prometheus/prometheus.yml)로
#    교체 후:  docker compose restart prometheus
if [ ! -f $MON/prometheus/prometheus.yml ]; then
cat > $MON/prometheus/prometheus.yml <<'PROM'
global:
  scrape_interval: 15s
  scrape_timeout: 10s
scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: ["localhost:9090"]
PROM
fi

# ── prometheus-eks.yml (EKS 전용 스텁 — 실제 타겟은 따로 교체) ──
mkdir -p $MON/prometheus-eks
if [ ! -f $MON/prometheus-eks/prometheus-eks.yml ]; then
cat > $MON/prometheus-eks/prometheus-eks.yml <<'PROMEKS'
global:
  scrape_interval: 15s
  scrape_timeout: 10s
scrape_configs:
  - job_name: prometheus-eks
    static_configs:
      - targets: ["localhost:9090"]
  # ⚠️ EKS 타겟(app/node/kube-state/cadvisor/postgres/redis, env="eks")은
  #    repo: team/infra/monitoring/prometheus-eks/prometheus-eks.yml 로 교체 후
  #    docker compose restart prometheus-eks
PROMEKS
fi

chown -R ubuntu:ubuntu $MON

# ── 기동 ────────────────────────────────────────────────────
cd $MON && docker compose up -d

echo "Monitoring EC2 User Data 완료: $(date)"