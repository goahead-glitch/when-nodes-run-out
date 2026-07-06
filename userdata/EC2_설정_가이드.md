# EC2 설정 가이드 — PostgreSQL · Redis

> EC2 인스턴스 생성 시 User Data 설정과 Docker Compose 실행 방법

---

## 목차

1. [PostgreSQL EC2](#1-postgresql-ec2)
2. [Redis EC2](#2-redis-ec2)
3. [파일 전송 방법](#3-파일-전송-방법)
4. [실행 및 확인](#4-실행-및-확인)
5. [재시작 및 초기화](#5-재시작-및-초기화)

---

## 1. PostgreSQL EC2

### 인스턴스 스펙

| 항목 | 값 |
|------|-----|
| 인스턴스 타입 | t3.medium |
| AMI | Ubuntu 24.04 LTS |
| 스토리지 | 30GB gp3 |
| 보안그룹 | 5432 (c8i.2xlarge SG), 9187 (Monitoring SG), 22 (Admin IP) |
| 퍼블릭 IP | 필요 (파일 전송용 SCP, 이후 보안그룹으로 제한) |
| 키페어 | aws-3tier-keypair.pem |

### User Data (EC2 생성 시 붙여넣기)

> AWS 콘솔 → EC2 인스턴스 시작 → 고급 세부 정보 → 사용자 데이터
>
> **파일 참고:** `msa_shoply/infra/userdata/postgresql.sh` 내용을 붙여넣기

> 완료 확인: `cat /var/log/user-data.log`

---

## 2. Redis EC2

### 인스턴스 스펙

| 항목 | 값 |
|------|-----|
| 인스턴스 타입 | t3.micro |
| AMI | Ubuntu 24.04 LTS |
| 스토리지 | 8GB gp3 |
| 보안그룹 | 6379 (c8i.2xlarge SG 또는 Worker Node SG), 9121 (Monitoring SG), 22 (Admin IP) |
| 퍼블릭 IP | 필요 (파일 전송용 SCP) |
| 키페어 | aws-3tier-keypair.pem |

### User Data (EC2 생성 시 붙여넣기)

> **파일 참고:** `msa_shoply/infra/userdata/redis.sh` 내용을 붙여넣기

---

## 3. 파일 전송 방법

> EC2 기동 후 User Data 완료 확인 → 파일 전송 순서

### PostgreSQL EC2로 전송

```bash
# 로컬 Mac에서 실행
# infra/postgres/ 폴더 전체를 서버로 전송
scp -i ~/key/aws-3tier-keypair.pem -r \
  /Users/kimminseo/shopping_k8s/msa_shoply/infra/postgres \
  ubuntu@<PostgreSQL-EC2-공인IP>:~/
```

전송 결과:
```
~/postgres/
├── docker-compose.yml
└── init/
    ├── 01_schema.sql
    └── 02_seed.sql   ← 44,000줄, 전송에 수분 소요
```

### Redis EC2로 전송

```bash
# 로컬 Mac에서 실행
scp -i ~/key/aws-3tier-keypair.pem -r \
  /Users/kimminseo/shopping_k8s/msa_shoply/infra/redis \
  ubuntu@<Redis-EC2-공인IP>:~/
```

---

## 4. 실행 및 확인

### PostgreSQL 실행

```bash
# PostgreSQL EC2에 SSH 접속
ssh -i ~/key/aws-3tier-keypair.pem ubuntu@<PostgreSQL-EC2-공인IP>

# 컨테이너 실행
cd ~/postgres
docker compose up -d

# 로그 확인 (초기 SQL 실행 완료까지 대기 — seed.sql 적재 수분 소요)
docker compose logs -f

# 완료 후 확인
docker compose ps
# STATE: running (healthy)

# 데이터 적재 확인
docker exec -it shoply-postgres psql -U shoply -d shoply \
  -c "SELECT COUNT(*) FROM products;"
# 500

docker exec -it shoply-postgres psql -U shoply -d shoply \
  -c "SELECT COUNT(*) FROM inventory;"
# 3000

docker exec -it shoply-postgres psql -U shoply -d shoply \
  -c "SELECT email FROM users WHERE email LIKE 'test%' OR email = 'admin@shoply.com';"
```

### Redis 실행

```bash
# Redis EC2에 SSH 접속
ssh -i ~/key/aws-3tier-keypair.pem ubuntu@<Redis-EC2-공인IP>

# 컨테이너 실행
cd ~/redis
docker compose up -d

# 확인
docker exec -it shoply-redis redis-cli ping
# PONG

docker compose ps
# STATE: running (healthy)
```

---

## 5. 재시작 및 초기화

### 컨테이너 재시작 (데이터 유지)

```bash
# PostgreSQL
docker compose restart

# Redis
docker compose restart
```

### 데이터 초기화 없이 컨테이너만 재생성

```bash
docker compose down && docker compose up -d
```

### PostgreSQL 데이터 완전 초기화 (볼륨 삭제)

> 시드 데이터부터 다시 넣어야 할 때

```bash
cd ~/postgres
docker compose down -v          # 볼륨까지 삭제
docker compose up -d            # 재기동 시 init/ SQL 자동 실행
docker compose logs -f          # 완료 대기
```

### 실험 전 빠른 초기화 (볼륨 유지 — 데이터는 남기고 상태만 리셋)

```bash
docker exec -it shoply-postgres psql -U shoply -d shoply << 'EOF'
TRUNCATE payments, order_items, orders RESTART IDENTITY CASCADE;
UPDATE inventory SET reserved = 0;
UPDATE products
SET is_timesale = FALSE, sale_price = NULL, sale_ends_at = NULL;
EOF
```

### Redis 캐시 초기화

```bash
docker exec -it shoply-redis redis-cli FLUSHALL
# OK

docker exec -it shoply-redis redis-cli DBSIZE
# (integer) 0
```

---

## 보안그룹 요약

### PostgreSQL SG (온프레미스)

| 방향 | 포트 | 소스 | 이유 |
|------|------|------|------|
| 인바운드 | 5432 | c8i.2xlarge SG | k8s 파드 → DB |
| 인바운드 | 9187 | Monitoring SG | postgresql_exporter |
| 인바운드 | 9100 | Monitoring SG | node_exporter |
| 인바운드 | 22 | Admin IP/32 | SSH |
| 아웃바운드 | 전체 | 0.0.0.0/0 | — |

### Redis SG (온프레미스)

| 방향 | 포트 | 소스 | 이유 |
|------|------|------|------|
| 인바운드 | 6379 | c8i.2xlarge SG | k8s 파드 → Redis |
| 인바운드 | 9121 | Monitoring SG | redis_exporter |
| 인바운드 | 9100 | Monitoring SG | node_exporter |
| 인바운드 | 22 | Admin IP/32 | SSH |
| 아웃바운드 | 전체 | 0.0.0.0/0 | — |

### Redis SG (EKS)

| 방향 | 포트 | 소스 | 이유 |
|------|------|------|------|
| 인바운드 | 6379 | Worker Node SG | k8s 파드 → Redis |
| 인바운드 | 9121 | Monitoring EIP/32 | redis_exporter (cross-VPC) |
| 인바운드 | 9100 | Monitoring EIP/32 | node_exporter (cross-VPC) |
| 인바운드 | 22 | Admin IP/32 | SSH |
| 아웃바운드 | 전체 | 0.0.0.0/0 | — |
