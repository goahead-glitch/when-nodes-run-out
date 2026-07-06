import { Router } from 'express';
import { randomUUID } from 'crypto';
import { pool } from '../db';
import { redis } from '../redis';
import { paymentTotal } from '../metrics';

const router = Router();

const ORDER_URL     = process.env.ORDER_SERVICE_URL     || 'http://localhost:4003';
const INVENTORY_URL = process.env.INVENTORY_SERVICE_URL || 'http://localhost:4002';

const FETCH_TIMEOUT = 10_000;

const FAIL_REASONS = ['PAYMENT_GATEWAY_ERROR', 'INSUFFICIENT_STOCK'] as const;
type FailReason = typeof FAIL_REASONS[number] | 'INVENTORY_DEDUCT_FAILED';

type OrderItem = { product_id: string; size: number; quantity: number; product_name: string };
type Order = { id: string; status: string; total_price: number; items: OrderItem[] };

async function getOrder(orderId: string): Promise<Order | null> {
  try {
    const res = await fetch(`${ORDER_URL}/orders/${orderId}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!res.ok) return null;
    return await res.json() as Order;
  } catch {
    return null;
  }
}

async function updateOrderStatus(orderId: string, status: string, failedReason?: string) {
  try {
    await fetch(`${ORDER_URL}/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, failedReason }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
  } catch {
    console.error(`[updateOrderStatus] ${orderId} → ${status} 실패`);
  }
}

// boolean 반환 — 전체 성공 여부
async function adjustInventory(action: 'deduct' | 'release', items: OrderItem[]): Promise<boolean> {
  let allOk = true;
  for (const item of items) {
    try {
      const res = await fetch(`${INVENTORY_URL}/inventory/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: item.product_id, size: item.size, quantity: item.quantity }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });
      if (!res.ok) {
        console.error(`[adjustInventory] ${action} HTTP ${res.status}`, item);
        allOk = false;
      }
    } catch (err) {
      console.error(`[adjustInventory] ${action} 연결 실패`, item);
      allOk = false;
    }
  }
  return allOk;
}

async function savePayment(paymentId: string, orderId: string, method: string, status: string, amount: number, failedReason: string | null) {
  await pool.query(
    `INSERT INTO payments (id, order_id, method, status, amount, failed_reason) VALUES ($1, $2, $3, $4, $5, $6)`,
    [paymentId, orderId, method, status, amount, failedReason],
  );
}

// POST /payments — 결제 처리
router.post('/', async (req, res) => {
  const { orderId, method } = req.body as { orderId?: string; method?: string };

  if (!orderId || !method) {
    return res.status(400).json({ message: 'orderId와 method는 필수입니다.' });
  }

  // 1. 주문 조회
  const order = await getOrder(orderId);
  if (!order) return res.status(404).json({ message: '주문을 찾을 수 없습니다.' });
  if (order.status !== 'PENDING') {
    return res.status(400).json({ message: `이미 처리된 주문입니다 (${order.status}).` });
  }

  // 2. Mock 결제 (95% 성공)
  const isSuccess = Math.random() < 0.95;
  const paymentId = randomUUID();

  if (isSuccess) {
    // 3a. 재고 실차감
    const deductOk = await adjustInventory('deduct', order.items);

    if (!deductOk) {
      // deduct 실패 → 예약 해제 → FAILED 처리 (DB 정합성 우선)
      console.error(`[payments] deduct 실패 — orderId: ${orderId}. 예약 해제 후 FAILED 처리`);
      await adjustInventory('release', order.items);
      await updateOrderStatus(orderId, 'FAILED', 'INVENTORY_DEDUCT_FAILED');
      await savePayment(paymentId, orderId, method, 'FAILED', order.total_price, 'INVENTORY_DEDUCT_FAILED');
      await redis.del('stats:realtime');
      paymentTotal.inc({ status: 'FAILED' });
      return res.json({ paymentId, orderId, status: 'FAILED', amount: order.total_price, failedReason: 'INVENTORY_DEDUCT_FAILED' });
    }

    // deduct 성공 → PAID
    await updateOrderStatus(orderId, 'PAID');
    await savePayment(paymentId, orderId, method, 'PAID', order.total_price, null);
    await redis.del('stats:realtime');
    paymentTotal.inc({ status: 'PAID' });
    return res.json({ paymentId, orderId, status: 'PAID', amount: order.total_price, failedReason: null });

  } else {
    // 3b. 결제 실패 → 예약 해제
    const failReason = FAIL_REASONS[Math.floor(Math.random() * FAIL_REASONS.length)] as FailReason;
    await adjustInventory('release', order.items);
    await updateOrderStatus(orderId, 'FAILED', failReason);
    await savePayment(paymentId, orderId, method, 'FAILED', order.total_price, failReason);
    await redis.del('stats:realtime');
    paymentTotal.inc({ status: 'FAILED' });
    return res.json({ paymentId, orderId, status: 'FAILED', amount: order.total_price, failedReason: failReason });
  }
});

// GET /stats — 결제 통계 (TTL 3초 캐시)
router.get('/stats', async (_req, res) => {
  try {
    const cached = await redis.get('stats:realtime');
    if (cached) return res.json(JSON.parse(cached));

    const { rows: [summary] } = await pool.query<{
      total: number; success: number; failed: number;
    }>(`
      SELECT
        COUNT(*)::int                                   AS total,
        COUNT(*) FILTER (WHERE status = 'PAID')::int   AS success,
        COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed
      FROM payments
    `);

    const { rows: recent } = await pool.query(`
      SELECT
        p.created_at                                                  AS time,
        oi.product_name                                               AS product,
        oi.size::text                                                 AS size,
        CASE WHEN p.status = 'PAID' THEN 'SUCCESS' ELSE 'FAILED' END AS status,
        p.failed_reason                                               AS reason
      FROM payments p
      LEFT JOIN LATERAL (
        SELECT product_name, size FROM order_items
        WHERE order_id = p.order_id ORDER BY id LIMIT 1
      ) oi ON true
      ORDER BY p.created_at DESC
      LIMIT 15
    `);

    const settled = summary.success + summary.failed;
    const rate    = settled === 0 ? 0 : Math.round((summary.success / settled) * 100);
    const result  = { ...summary, rate, recent };

    await redis.setex('stats:realtime', 3, JSON.stringify(result));
    return res.json(result);
  } catch (err) {
    console.error('[GET /stats]', err);
    return res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

export default router;
