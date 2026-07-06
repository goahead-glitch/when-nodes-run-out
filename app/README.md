# app — Shoply 쇼핑몰 MSA 서비스

온프레미스 vs AWS EKS 비교 실험에 사용되는 쇼핑몰 애플리케이션입니다. Express(TypeScript) 기반 마이크로서비스 7개 + React 프론트엔드로 구성되어 있으며, 두 인프라(온프레미스/EKS)에 동일하게 배포되어 부하·장애 실험의 대상이 됩니다.

품질 우선순위는 UI 완성도가 아니라 **실험 재현성·API 로직·DB 정합성**입니다. UI는 상품 조회/주문/결제/어드민의 최소 동작만 갖춥니다.

![Shoply 홈 화면](images/homepage.png)
> 타임세일 배너, 전체 상품 목록(456개), 장바구니/로그인 내비게이션을 갖춘 홈 화면.

## 기술 스택

| 영역 | 스택 |
|---|---|
| 백엔드 | Node.js 22, Express, TypeScript |
| 프론트엔드 | React 19, TanStack Router, Tailwind CSS v4, Vite 6 |
| DB | PostgreSQL 16 (`max_connections=300`) |
| 캐시 | Redis 7 |
| 인증 | JWT + bcrypt |
| 트레이싱 | OpenTelemetry (`tracing.js`, 서비스별 계측) |
| 이미지 빌드 | Docker, GitHub Actions → GHCR |

## 서비스 구성

| 서비스 | 포트 | 핵심 역할 |
|---|:---:|---|
| **gateway** | 4000 | 모든 API 진입점. `/api/*`를 각 마이크로서비스로 프록시(`http-proxy-middleware`) + Prometheus 메트릭 수집 |
| **product** | 4001 | 상품 목록/상세 조회. Redis 캐시 (목록 60초, 상세 30초) |
| **inventory** | 4002 | 재고 관리. **`SELECT FOR UPDATE`로 동시성 제어**(reserve/deduct/release) — 동시 주문 몰림에도 초과판매(oversell) 방지 |
| **order** | 4003 | 주문 생성. 재고 예약 → 주문 저장(트랜잭션). inventory 호출에 5초 타임아웃 적용(노드 장애 시 무한 대기 방지) |
| **payment** | 4004 | 결제 처리(Mock, 95% 성공률). 성공 시 재고 차감, 실패 시 예약 해제 |
| **user** | 4005 | 로그인/인증 (bcrypt 해시 + JWT 발급) |
| **frontend** | 80 | React 쇼핑몰 UI — 상품 목록/상세, 타임세일, 주문/결제, 로그인, 어드민, 통계 |

각 백엔드 서비스는 `Dockerfile`(TypeScript 빌드 → Node 실행)을 갖고 있으며 `docker-compose.yml`로 로컬에서 전체 스택을 띄울 수 있습니다.

### 요청 흐름

```
클라이언트 → gateway(:4000)
              ├─ /api/auth/*      → user(:4005)
              ├─ /api/products/*  → product(:4001)
              ├─ /api/inventory/* → inventory(:4002)
              ├─ /api/orders/*    → order(:4003)
              └─ /api/payments/*  → payment(:4004)
```
gateway는 요청 경로를 `/api/{service}` 수준으로 정규화해 Prometheus 라벨의 카디널리티를 낮추고, 각 프록시 대상이 죽으면 503으로 즉시 응답합니다(무한 대기 방지).

## 핵심 설계 결정

- **재고 동시성 — `SELECT FOR UPDATE`**: k6로 동시 주문을 몰아도 재고가 마이너스로 내려가지 않도록 inventory 서비스에서 행 잠금을 사용합니다.
- **Mock 결제 95% 성공률**: 실제 PG 연동 없이 결제 실패 시나리오(재고 롤백 포함)를 재현하기 위한 선택입니다.
- **Redis 캐시 TTL 차등(목록 60초/상세 30초)**: 상품 목록은 자주 안 바뀌지만 상세는 재고 반영이 더 즉각적이어야 해서 TTL을 짧게 뒀습니다.
- **DB 페일오버 대응**: `pg.Pool`에 `connectionTimeoutMillis: 5000`, `keepAlive: true`, 그리고 idle 커넥션이 끊겨도 프로세스가 죽지 않도록 `pool.on('error', ...)` 핸들러를 추가했습니다. Primary DB가 죽는 노드 장애 시나리오(실험 3)에서 서비스가 크래시 루프에 빠지지 않게 하기 위함입니다.
- **liveness/readiness 분리**(`/livez` vs `/health`): DB가 죽었을 때 전체 파드가 재시작 루프에 빠지는 것을 막기 위해, "프로세스가 살아있는지"(`/livez`)와 "트래픽을 받을 준비가 됐는지"(`/health`)를 분리했습니다.
- **fetch 타임아웃**(order → inventory): 노드 장애로 inventory가 응답하지 않을 때 order가 무한 대기하지 않도록 `AbortSignal.timeout(5000)`을 적용했습니다.

## 로컬 실행

```bash
cd app
cp .env.example .env   # JWT_SECRET 등 값 채우기
docker compose build
docker compose up
```

- `postgres`/`redis`가 healthy 상태가 된 뒤 서비스들이 순차적으로 기동합니다.
- DB 초기화는 `db/schema.sql` → `db/seed.sql`(더미 상품 데이터) 순으로 자동 실행됩니다.
- 로그인 계정: `admin`(`Admin1234!`), `test1`~`test2000`(`Test1234!`)

## CI/CD

- `.github/workflows/ci.yml` — `develop`/`main`으로의 PR 시 변경된 서비스만 감지해 `tsc --noEmit` + `npm audit` + Docker 빌드 검증(push 안 함)
- `.github/workflows/cd.yml` — `develop`/`main` push 시 변경된 서비스 이미지를 빌드해 GHCR(`ghcr.io/<owner>/shoply-<service>`)로 푸시, Trivy로 취약점 스캔(빌드는 막지 않음), 결과를 Slack으로 알림
- `.github/workflows/cd-otel.yml` — `app` 브랜치 push 시 OpenTelemetry 계측이 포함된 이미지를 `:otel` 태그로 별도 빌드(기존 `:latest`에 영향 없음)
