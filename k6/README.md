# k6 부하 테스트

---

## 시나리오 흐름

```
setup() - 테스트 시작 전 1회만 로그인 (test1@shoply.com) → JWT 토큰 발급
         → 모든 VU가 토큰 공유 (user 서비스 과부하 방지)

1. 홈페이지 접속         GET /
2. 상품 페이지 접속      GET /api/products/:id  (20개 상품 중 랜덤)
3. 무작위 사이즈 선택 후 주문  POST /api/orders
4. 배송지 입력(a,a,a) 후 결제 POST /api/payments
```

> 2~4단계는 `Authorization: Bearer <token>` 헤더 포함

---

## 웨이브 구성 (총 2000명 / 노드 한계 탐색용)

| 웨이브 | 시작 | VUs |
|---|---|---|
| A~J | 0~9분 (1분 간격) | 각 200명 |

- **9분 시점 최대 동시 접속자: 2000명**
- **sleep 없음 → 최대 부하**
- **총 실행 시간: 14분**
- HPA maxReplicas: 100 (제한 없음), scale-down cooldown: 60초

---

## 테스트 전 재고 리셋

> 20개 상품 전체 재고 9999로 초기화

```bash
docker exec shoply-postgres psql -U shoply -d shoply -c "
TRUNCATE payments, order_items, orders RESTART IDENTITY CASCADE;
UPDATE inventory SET quantity = 9999, reserved = 0
WHERE product_id IN (
  '86f68efd-84f7-4630-9c50-4133f95cc67d','311362ee-0a57-4775-bd3f-648a732f5531',
  '5bb32797-8f48-43e9-a883-f610e0aa4641','7fe0aeac-7db0-4e6d-9c33-3086b563c6e4',
  '4f553095-66bd-49af-9737-8cb535fdee9f','8d23364d-58e9-4c89-a216-1c7dfb1623c5',
  '2c7088d7-d7d2-4cd3-9116-36df13064fa6','67881ad7-21e2-4c11-a5ac-61712c4d9f16',
  'd381b9a2-ae14-4e05-8aea-6c8520141b34','6bd56564-d9b5-4e4a-b38d-6c892f2b3a4f',
  'a3e37a1b-86cf-4391-aa71-7f453f9ee844','b66c42b2-1e9c-4591-b2d4-e1cf00a94b64',
  '018dc528-8d39-4129-8d70-73bd03edda26','70a6e8b4-a8ff-49c1-9047-d3a06e569464',
  '70454e30-c868-41c5-8e30-8608cce7d563','fe03aab0-8c29-4b8b-a286-52686420c959',
  '0fb80662-7c19-4ae9-8031-2e134fc52aca','3f2b6696-cc02-4769-a0f0-09a780ceeeca',
  'a0ad92e7-29e6-419c-a576-6c8c6234beb4','157192dd-1412-4afe-9ec7-cfdda556d25e'
);"
```

---

## 실행 방법

### Docker Compose 사용 (권장)

```bash
cd msa_shoply/k6

# 온프레미스 타겟
BASE_URL=http://<온프레미스-공인IP> \
PROMETHEUS_RW_URL=http://<모니터링서버-사설IP>:9090/api/v1/write \
docker compose up

# EKS 타겟
BASE_URL=http://<EKS-ALB-URL> \
PROMETHEUS_RW_URL=http://<모니터링서버-사설IP>:9090/api/v1/write \
docker compose up
```

### Docker 직접 실행

```bash
docker run --rm -i \
  -v $(pwd)/scripts:/scripts \
  -e BASE_URL=http://<공인IP> \
  -e K6_PROMETHEUS_RW_SERVER_URL=http://<모니터링-사설IP>:9090/api/v1/write \
  --network host \
  grafana/k6 run --out experimental-prometheus-rw /scripts/scenario.js
```

---

## Grafana 대시보드

Dashboards → Import → ID 입력

| ID | 이름 | 용도 |
|---|---|---|
| **18030** | k6 Prometheus - Native Histograms | RPS, 응답시간, 에러율 (권장) |
| **2587** | k6 Load Testing Results | 클래식 뷰 |

---

## API 라우팅 (게이트웨이 경유)

| 요청 경로 | 대상 서비스 |
|---|---|
| `GET /` | frontend |
| `POST /api/auth/login` | user-svc |
| `GET /api/products/:id` | product-svc |
| `POST /api/orders` | order-svc |
| `POST /api/payments` | payment-svc |

---

## 테스트 계정

- 이메일: `test1@shoply.com` ~ `test2000@shoply.com`
- 비밀번호: `Test1234!`
- 매 이터레이션마다 1~2000 중 랜덤 선택