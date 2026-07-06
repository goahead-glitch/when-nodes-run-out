import http from 'k6/http';
import { check, sleep } from 'k6';

// 현실적 유저 대기시간(think time) — 실제 사용자는 페이지 보고 잠깐 멈춘다
function think(min, max) {
  sleep(min + Math.random() * (max - min));
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost';

// 20개 상품으로 분산
const PRODUCTS = [
  '86f68efd-84f7-4630-9c50-4133f95cc67d',
  '311362ee-0a57-4775-bd3f-648a732f5531',
  '5bb32797-8f48-43e9-a883-f610e0aa4641',
  '7fe0aeac-7db0-4e6d-9c33-3086b563c6e4',
  '4f553095-66bd-49af-9737-8cb535fdee9f',
  '8d23364d-58e9-4c89-a216-1c7dfb1623c5',
  '2c7088d7-d7d2-4cd3-9116-36df13064fa6',
  '67881ad7-21e2-4c11-a5ac-61712c4d9f16',
  'd381b9a2-ae14-4e05-8aea-6c8520141b34',
  '6bd56564-d9b5-4e4a-b38d-6c892f2b3a4f',
  'a3e37a1b-86cf-4391-aa71-7f453f9ee844',
  'b66c42b2-1e9c-4591-b2d4-e1cf00a94b64',
  '018dc528-8d39-4129-8d70-73bd03edda26',
  '70a6e8b4-a8ff-49c1-9047-d3a06e569464',
  '70454e30-c868-41c5-8e30-8608cce7d563',
  'fe03aab0-8c29-4b8b-a286-52686420c959',
  '0fb80662-7c19-4ae9-8031-2e134fc52aca',
  '3f2b6696-cc02-4769-a0f0-09a780ceeeca',
  'a0ad92e7-29e6-419c-a576-6c8c6234beb4',
  '157192dd-1412-4afe-9ec7-cfdda556d25e',
];

// ── 부하 프로파일: 100명씩 3개 웨이브가 2분 간격으로 시작, 각 7분 유지 ──
// Wave1: 0:00 시작 → 7:00 종료
// Wave2: 2:00 시작 → 9:00 종료
// Wave3: 4:00 시작 → 11:00 종료
// 겹치는 구간(4:00~7:00)이 3웨이브 동시 활성 = 최고점 300명.
// 이후 먼저 시작한 웨이브가 먼저 빠지면서 300→200→100→0 계단식으로 감소.
// 각 진입/퇴장은 20초간 램프(완전 동시접속이 아닌 현실적 유입 흉내).
export const options = {
  scenarios: {
    wave: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 100 },   // Wave1 진입 (0:00)
        { duration: '1m40s', target: 100 }, // 유지 → 2:00
        { duration: '20s', target: 200 },   // Wave2 진입 (2:00)
        { duration: '1m40s', target: 200 }, // 유지 → 4:00
        { duration: '20s', target: 300 },   // Wave3 진입 (4:00)
        { duration: '2m40s', target: 300 }, // ★ 최고점 유지 → 7:00
        { duration: '20s', target: 200 },   // Wave1 퇴장 (7:00)
        { duration: '1m40s', target: 200 }, // 유지 → 9:00
        { duration: '20s', target: 100 },   // Wave2 퇴장 (9:00)
        { duration: '1m40s', target: 100 }, // 유지 → 11:00
        { duration: '20s', target: 0 },     // Wave3 퇴장 (11:00)
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<3000'],
    http_req_failed: ['rate<0.3'],
  },
};

// ── setup(): 테스트 시작 전 토큰 1개 발급 ───────────────────────
export function setup() {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: 'test1@shoply.com', password: 'Test1234!' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  const token = res.status === 200 ? res.json('token') : '';
  console.log(`로그인 ${res.status === 200 ? '성공' : '실패'}`);
  return { token };
}

export default function (data) {

  const authHeaders = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.token}`,
    },
  };

  // ── 1. 홈페이지 접속 ────────────────────────────────────────
  const homeRes = http.get(`${BASE_URL}/`);
  check(homeRes, { '홈 200': (r) => r.status === 200 });
  think(0.5, 1.0);   // 홈 둘러보는 시간

  // ── 2. 상품 페이지 접속 ──────────────────────────────────────
  const productId = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
  const productRes = http.get(`${BASE_URL}/api/products/${productId}`, authHeaders);
  check(productRes, { '상품 200': (r) => r.status === 200 });

  if (productRes.status !== 200) return;

  think(0.5, 1.5);   // 상품 보고 살지 고민하는 시간

  const product = productRes.json();
  const availableSizes = product.sizes ? product.sizes.filter((s) => s.available > 0) : [];

  if (availableSizes.length === 0) return;

  const selectedSize = availableSizes[Math.floor(Math.random() * availableSizes.length)];

  // ── 3. 주문 생성 ──────────────────────────────────────────────
  const orderRes = http.post(
    `${BASE_URL}/api/orders`,
    JSON.stringify({
      items: [{ productId, size: selectedSize.size, quantity: 1 }],
    }),
    authHeaders,
  );
  check(orderRes, { '주문 201': (r) => r.status === 201 });

  if (orderRes.status !== 201) return;

  const orderId = orderRes.json('orderId');

  // ── 4. 결제 ───────────────────────────────────────────────────
  const paymentRes = http.post(
    `${BASE_URL}/api/payments`,
    JSON.stringify({
      orderId,
      method: 'CARD',
      delivery: { name: 'a', phone: 'a', address: 'a' },
    }),
    authHeaders,
  );
  check(paymentRes, {
    '결제 200': (r) => r.status === 200,
    '결제 처리됨': (r) => {
      try { return ['PAID', 'FAILED'].includes(r.json('status')); }
      catch { return false; }
    },
  });
}
