-- ============================================================
-- 부하 테스트 준비 SQL — 실험(시나리오 A/B/C) 시작 전 매번 실행
-- 양쪽 환경(온프레미스/EKS)에 동일하게 적용해야 공정함
-- ============================================================

-- ── 1. k6 시나리오에서 실제로 주문하는 상품 20개 → 재고 5000개
--    계산 근거: 시나리오 A 최고 1500 RPS × 주문 30% = 450 주문/초
--              20분 동안 SKU당 약 2,000건 예상 → 5000개로 여유 확보
UPDATE inventory
SET quantity = 5000, reserved = 0
WHERE product_id IN (
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
  '157192dd-1412-4afe-9ec7-cfdda556d25e'
);

-- ── 2. 나머지 상품 재고 안전 바닥값 확보 (부하 중 품절로 실험 오염 방지)
UPDATE inventory SET quantity = 500, reserved = 0
WHERE quantity < 200
  AND product_id NOT IN (
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
  '157192dd-1412-4afe-9ec7-cfdda556d25e'
);

-- ── 3. 나머지 상품 reserved 초기화
UPDATE inventory SET reserved = 0
WHERE product_id NOT IN (
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
  '157192dd-1412-4afe-9ec7-cfdda556d25e'
);

-- ── 4. 거래 흔적 초기화
TRUNCATE TABLE payments, order_items, orders CASCADE;

-- ── 5. 확인
SELECT
  (SELECT COUNT(*)                                FROM products)            AS 전체상품수,
  (SELECT COUNT(*)                                FROM inventory)           AS 전체SKU수,
  (SELECT COUNT(*) FROM inventory
   WHERE product_id = '86f68efd-84f7-4630-9c50-4133f95cc67d')              AS k6상품1_SKU수,
  (SELECT MIN(quantity) FROM inventory
   WHERE product_id = '86f68efd-84f7-4630-9c50-4133f95cc67d')              AS k6상품1_재고최소,
  (SELECT MIN(quantity)                           FROM inventory)           AS 전체재고최소,
  (SELECT COUNT(*)                                FROM users)               AS 계정수,
  (SELECT COUNT(*)                                FROM orders)              AS 주문수_초기화확인;
