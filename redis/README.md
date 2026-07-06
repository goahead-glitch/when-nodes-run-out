# redis — 공용 캐시

Shoply 앱의 캐시 레이어입니다. 별도 EC2에 Docker Compose로 띄우고, postgres와 마찬가지로 온프레미스/EKS 양쪽이 공유하는 통제변수입니다.

## 구성

```yaml
redis:          # redis:7-alpine, maxmemory 256mb, allkeys-lru, RDB/AOF 저장 끔(--save "") — 순수 캐시 용도
redis_exporter: # Prometheus용 메트릭 — 포트 9121
node_exporter:  # Redis EC2 자체의 CPU/메모리 메트릭 — host network
```

- **`maxmemory-policy allkeys-lru`**: 캐시 전용이라 메모리가 차면 가장 오래 안 쓴 키부터 자동으로 밀어냅니다.
- **`--save ""`**: RDB 스냅샷을 끕니다 — 캐시는 유실돼도 DB에서 다시 채워지므로 영속성이 필요 없고, 디스크 I/O를 줄입니다.

## 사용처

`app/services/product`가 주 사용자입니다:

| 캐시 키 | TTL | 용도 |
|---|---|---|
| `products:list` | 60초 | 상품 목록 조회 캐시 |
| `products:{id}` | 30초 | 상품 상세 조회 캐시(재고 반영이 더 즉각적이어야 해서 목록보다 짧게) |

상품 정보 수정/삭제 시 관련 키를 즉시 `del`해서 캐시 정합성을 맞춥니다. inventory/payment 서비스도 Redis 클라이언트(`ioredis`)를 연결해두고 있지만, 실제 캐싱 로직은 product에 집중되어 있습니다.

## 실행

```bash
cd redis
docker compose up -d
docker compose ps
```
- 접속 확인: `redis-cli -h <Redis-EC2-IP> ping` → `PONG`

## 재구축 시 체크

Redis EC2를 새로 띄우면 사설 IP가 바뀝니다. `onprem/` k8s의 ConfigMap(`REDIS_HOST`)을 새 IP로 패치하지 않으면 product 서비스가 캐시 연결에 실패합니다(에러 핸들러가 있어 크래시는 안 나지만 캐시가 항상 미스로 동작) — 절차는 [`onprem/BACKUP-RESTORE.md`](../onprem/BACKUP-RESTORE.md) 6단계 참고.
