import http from 'k6/http';
import { check, sleep } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost';
export const ACCOUNT_COUNT = Number(__ENV.ACCOUNT_COUNT || 2000);
export const TEST_PASSWORD = __ENV.TEST_PASSWORD || 'Test1234!';

// 상품 상세에서 선택할 수 있는 신발 사이즈 후보.
const SIZES = [240, 250, 260, 270, 280, 290, 300];

// k6는 VU마다 JS 실행 컨텍스트가 분리된다.
// 그래서 이 변수는 전체 테스트 공용이 아니라 "각 VU 전용 토큰 캐시"로 동작한다.
let cachedToken = '';

// 실제 사용자가 화면을 보고 잠깐 머무르는 시간을 흉내 낸다.
// 모든 VU가 같은 박자로 요청하지 않게 만들어 그래프가 더 현실적으로 흔들린다.
export function think(min, max) {
  sleep(min + Math.random() * (max - min));
}

// 응답이 JSON이 아니거나 특정 필드가 없을 때 k6 스크립트가 죽지 않도록 안전하게 파싱한다.
export function safeJson(res, path) {
  try {
    return path === undefined || path === null ? res.json() : res.json(path);
  } catch {
    return null;
  }
}

// VU 번호를 테스트 계정 번호에 매핑한다.
// 예: VU 1 -> test1@shoply.com, VU 200 -> test200@shoply.com
export function getUser() {
  const userNumber = ((__VU - 1) % ACCOUNT_COUNT) + 1;

  return {
    email: `test${userNumber}@shoply.com`,
    password: TEST_PASSWORD,
  };
}

export function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

export function randomSize() {
  return randomItem(SIZES);
}

// 각 VU는 최초 1회만 로그인하고 이후 반복에서는 같은 JWT 토큰을 재사용한다.
// 로그인 API 부하가 과하게 섞이지 않도록 실제 사용자 세션 흐름에 맞춘 구조다.
export function loginOnce() {
  if (cachedToken) {
    return cachedToken;
  }

  const user = getUser();
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({
      email: user.email,
      password: user.password,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'POST /api/auth/login', api: 'login' },
    },
  );

  const loginOk = check(loginRes, {
    'login status is 200': (res) => res.status === 200,
    'login token exists': (res) => Boolean(safeJson(res, 'token')),
  });

  if (!loginOk || loginRes.status !== 200) {
    return '';
  }

  cachedToken = safeJson(loginRes, 'token') || '';
  return cachedToken;
}

// normal: 상품 20개에 분산, timesale: 상위 3개 상품에 집중.
// 스파이크/타임세일 시나리오에서 특정 상품으로 트래픽이 몰리는 상황을 만든다.
export function pickProduct(products, mode = 'normal') {
  if (!Array.isArray(products) || products.length === 0) {
    return null;
  }

  const availableProducts = products.filter((product) => (
    product?.id && Number(product.total_available ?? product.totalAvailable ?? 0) > 0
  ));
  const candidates = availableProducts.length > 0 ? availableProducts : products;

  if (mode === 'timesale') {
    return randomItem(candidates.slice(0, Math.min(3, candidates.length)));
  }

  if (mode === 'normal') {
    return randomItem(candidates.slice(0, Math.min(20, candidates.length)));
  }

  return randomItem(candidates);
}

// 상품 상세 응답에 재고가 있는 사이즈가 있으면 그 중 하나를 고르고,
// 사이즈 정보가 없으면 기본 사이즈 후보에서 랜덤 선택한다.
export function pickSize(product) {
  const availableSizes = Array.isArray(product?.sizes)
    ? product.sizes.filter((size) => Number(size.available ?? size.stock ?? 0) > 0)
    : [];

  if (availableSizes.length > 0) {
    return randomItem(availableSizes).size;
  }

  return randomSize();
}

// 공식 E2E 부하 흐름:
// 로그인 1회 -> 상품 목록 -> 상품 상세 -> 주문 생성 -> 결제.
export function runE2E(productMode = 'normal') {
  const token = loginOnce();

  if (!token) {
    think(0.5, 1.0);
    return;
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  // 1. 상품 목록 조회: 사용자가 쇼핑몰에서 상품 리스트를 보는 단계.
  const productsRes = http.get(`${BASE_URL}/api/products`, {
    headers,
    tags: { name: 'GET /api/products', api: 'products-list' },
  });

  const productsOk = check(productsRes, {
    'products list status is 200 or 304': (res) => res.status === 200 || res.status === 304,
  });

  if (!productsOk) {
    think(0.5, 1.0);
    return;
  }

  const productsPayload = safeJson(productsRes);
  const products = Array.isArray(productsPayload) ? productsPayload : productsPayload?.products;
  const selectedProduct = pickProduct(products, productMode);

  const productSelected = check(selectedProduct, {
    'product selected': (product) => product !== null && Boolean(product.id),
  });

  if (!productSelected || !selectedProduct) {
    think(0.5, 1.0);
    return;
  }

  think(0.5, 1.0);

  // 2. 상품 상세 조회: 선택한 상품의 상세 정보와 사이즈/재고를 확인한다.
  const productId = selectedProduct.id;
  const productDetailRes = http.get(`${BASE_URL}/api/products/${productId}`, {
    headers,
    tags: { name: 'GET /api/products/:id', api: 'product-detail' },
  });

  const detailOk = check(productDetailRes, {
    'product detail status is 200 or 304': (res) => res.status === 200 || res.status === 304,
  });

  if (!detailOk || productDetailRes.status !== 200) {
    think(0.5, 1.0);
    return;
  }

  const productPayload = safeJson(productDetailRes);
  const product = productPayload?.product ?? productPayload;
  const selectedSize = pickSize(product);

  think(0.5, 1.5);

  // 3. 주문 생성: 선택한 상품, 사이즈, 수량 1개로 주문을 만든다.
  const orderRes = http.post(
    `${BASE_URL}/api/orders`,
    JSON.stringify({
      items: [
        {
          productId,
          size: selectedSize,
          quantity: 1,
        },
      ],
    }),
    {
      headers,
      tags: { name: 'POST /api/orders', api: 'order-create' },
    },
  );

  const orderOk = check(orderRes, {
    'order status is 201': (res) => res.status === 201,
    'orderId exists': (res) => Boolean(safeJson(res, 'orderId')),
  });

  if (!orderOk || orderRes.status !== 201) {
    think(0.5, 1.0);
    return;
  }

  const orderId = safeJson(orderRes, 'orderId');
  if (!orderId) {
    think(0.5, 1.0);
    return;
  }

  think(0.5, 1.0);

  // 4. 결제 요청: 생성된 주문 ID로 결제를 진행한다.
  // card 비중을 높이고 bank를 일부 섞어 실제 결제 방식 분포를 단순화해 반영한다.
  const paymentRes = http.post(
    `${BASE_URL}/api/payments`,
    JSON.stringify({
      orderId,
      method: Math.random() < 0.8 ? 'card' : 'bank',
    }),
    {
      headers,
      tags: { name: 'POST /api/payments', api: 'payment-create' },
    },
  );

  check(paymentRes, {
    'payment status is 200': (res) => res.status === 200,
    'paymentId exists': (res) => Boolean(safeJson(res, 'paymentId')),
    'payment has processed status': (res) => ['PAID', 'FAILED'].includes(String(safeJson(res, 'status'))),
  });

  think(0.5, 1.0);
}
