#!/bin/bash
# ============================================================
# 모니터링 EC2 #2 — 풀스택 (Prometheus 온프레+EKS / Loki / Grafana / Tempo)
#   기존 monitoring.sh는 그대로 두고, 비교용 2호기 유저데이터.
#   새 EC2 시작 시 User data에 이 스크립트를 넣으면 부팅만으로 전부 기동.
# ============================================================
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

MON=/home/ubuntu/monitoring
mkdir -p $MON/prometheus $MON/prometheus-eks

# ── docker-compose.yml (전 스택) ────────────────────────────
cat > $MON/docker-compose.yml <<'COMPOSE'
services:
  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    restart: always
    ports: ["9090:9090"]
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=15d'
      - '--web.enable-lifecycle'
      - '--web.enable-remote-write-receiver'
      - '--web.enable-admin-api'
      - '--enable-feature=exemplar-storage'

  prometheus-eks:
    image: prom/prometheus:latest
    container_name: prometheus-eks
    restart: always
    ports: ["9091:9090"]
    volumes:
      - ./prometheus-eks/prometheus-eks.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus_eks_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=15d'
      - '--web.enable-lifecycle'
      - '--web.enable-remote-write-receiver'
      - '--web.enable-admin-api'
      - '--enable-feature=exemplar-storage'

  loki:
    image: grafana/loki:2.9.8
    container_name: loki
    restart: always
    ports: ["3100:3100"]
    command: -config.file=/etc/loki/loki-config.yml
    volumes:
      - ./loki-config.yml:/etc/loki/loki-config.yml:ro
      - loki_data:/loki

  tempo:
    image: grafana/tempo:2.6.1
    container_name: tempo
    restart: always
    command: -config.file=/etc/tempo/tempo.yml
    ports: ["3200:3200", "4317:4317", "4318:4318"]
    volumes:
      - ./tempo.yaml:/etc/tempo/tempo.yml:ro
      - tempo_data:/var/tempo

  grafana:
    image: grafana/grafana:latest
    container_name: grafana
    restart: always
    ports: ["3000:3000"]
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
  tempo_data:
COMPOSE

# ── loki-config.yml ─────────────────────────────────────────
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

# ── tempo.yaml ──────────────────────────────────────────────
cat > $MON/tempo.yaml <<'TEMPO'
server:
  http_listen_port: 3200
distributor:
  receivers:
    otlp:
      protocols:
        grpc:
          endpoint: 0.0.0.0:4317
        http:
          endpoint: 0.0.0.0:4318
ingester:
  max_block_duration: 5m
compactor:
  compaction:
    block_retention: 168h
metrics_generator:
  registry:
    external_labels:
      source: tempo
  storage:
    path: /var/tempo/generator/wal
    remote_write:
      - url: http://prometheus:9090/api/v1/write
        send_exemplars: true
  traces_storage:
    path: /var/tempo/generator/traces
storage:
  trace:
    backend: local
    wal:
      path: /var/tempo/wal
    local:
      path: /var/tempo/blocks
overrides:
  defaults:
    metrics_generator:
      processors: [service-graphs, span-metrics]
TEMPO

# ── grafana-datasources.yml (Prometheus 온프레/EKS + Loki + Tempo) ──
cat > $MON/grafana-datasources.yml <<'GRAFANA'
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    uid: prometheus-onprem
    access: proxy
    url: http://prometheus:9090
    isDefault: true
  - name: Prometheus-EKS
    type: prometheus
    uid: prometheus-eks
    access: proxy
    url: http://prometheus-eks:9090
  - name: Loki
    type: loki
    uid: loki
    access: proxy
    url: http://loki:3100
  - name: Tempo
    type: tempo
    uid: tempo
    access: proxy
    url: http://tempo:3200
    jsonData:
      nodeGraph:
        enabled: true
      serviceMap:
        datasourceUid: prometheus-onprem
      tracesToLogsV2:
        datasourceUid: loki
      tracesToMetrics:
        datasourceUid: prometheus-onprem
GRAFANA

# ── prometheus.yml (온프레 스텁 — 실제 타겟은 따로 교체) ─────
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

# ── prometheus-eks.yml (EKS 스텁) ───────────────────────────
if [ ! -f $MON/prometheus-eks/prometheus-eks.yml ]; then
cat > $MON/prometheus-eks/prometheus-eks.yml <<'PROMEKS'
global:
  scrape_interval: 15s
  scrape_timeout: 10s
scrape_configs:
  - job_name: prometheus-eks
    static_configs:
      - targets: ["localhost:9090"]
PROMEKS
fi

chown -R ubuntu:ubuntu $MON

cd $MON && docker compose up -d

echo "Monitoring EC2 #2 (풀스택) User Data 완료: $(date)"