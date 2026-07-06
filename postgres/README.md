# postgres — 공용 PostgreSQL

Shoply MSA 7개 서비스가 공유하는 PostgreSQL 16 인스턴스입니다. 별도 EC2에 Docker Compose로 띄우고, 온프레미스/EKS 양쪽 클러스터에서 이 하나의 DB를 바라봅니다(비교 실험의 공정성을 위해 DB는 통제변수로 고정).

## 구성

```yaml
postgres:          # postgres:16-alpine, DB=shoply, 포트 5432
postgres_exporter: # Prometheus용 메트릭 (커넥션 수, 락 대기 등) — 포트 9187
node_exporter:     # DB EC2 자체의 CPU/메모리/디스크 메트릭 — host network
```

## 스키마 — 서비스별 테이블 소유권

MSA 원칙대로 테이블마다 "소유 서비스"가 있고, 다른 서비스는 그 테이블을 직접 건드리지 않습니다(`db/schema.sql`, `db/seed.sql`은 `app/` 브랜치에도 동일하게 있습니다 — 로컬 개발용).

| 테이블 | 소유 서비스 | 비고 |
|---|---|---|
| `users` | user | bcrypt 해시된 비밀번호 |
| `products` | product | 타임세일 필드(`is_timesale`, `sale_price`, `sale_ends_at`) 포함 |
| `inventory` | inventory | `product_id + size` 유니크, `quantity`/`reserved`/`version` — **`SELECT FOR UPDATE`(app 브랜치 참고) 동시성 제어의 대상** |
| `orders` | order | `status`: PENDING/PAID/FAILED |
| `order_items` | order | 주문 시점 스냅샷(상품명·단가를 복사해둠 — 나중에 상품 정보가 바뀌어도 주문 내역은 안 바뀜) |
| `payments` | payment | `failed_reason`: `PAYMENT_GATEWAY_ERROR` / `INSUFFICIENT_STOCK` |

인덱스는 조회가 잦은 컬럼(`inventory.product_id`, `orders.status`/`user_id`, `payments.order_id`, `products.is_timesale`)에 걸려 있습니다.

## 시드 데이터

`init/02_seed.sql`이 컨테이너 최초 기동 시 자동 실행됩니다.
- 관리자 1명(`admin@shoply.com`) + 테스트 계정 다수(`test1@shoply.com` ~) — 비밀번호는 bcrypt 해시로 저장, 원문은 `Test1234!`
- k6 부하테스트용으로 상품 20종 + 재고 데이터 포함

## 실행

```bash
cd postgres
docker compose up -d
docker compose ps
```
- 접속: `psql -h <DB-EC2-IP> -U shoply -d shoply` (비밀번호 `shoply1234`)
- `max_connections`은 EKS 쪽에서는 300으로 늘려 파드 수 × 커넥션 풀 합산에 대응합니다(`app/docker-compose.yml` 참고).

## 재구축 시 체크

DB EC2를 새로 띄우면 사설 IP가 바뀝니다. `onprem/` k8s의 ConfigMap(`POSTGRES_HOST`)을 새 IP로 패치하지 않으면 백엔드 파드가 `Running`인데 `0/1`(헬스체크 실패)로 남습니다 — 자세한 절차는 [`onprem/BACKUP-RESTORE.md`](../onprem/BACKUP-RESTORE.md) 6단계를 참고하세요.
