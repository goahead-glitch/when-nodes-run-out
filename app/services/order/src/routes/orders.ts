import { Router } from 'express';
import { randomUUID } from 'crypto';
import { pool } from '../db';

const router = Router();

const INVENTORY_URL = process.env.INVENTORY_SERVICE_URL || 'http://localhost:4002';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FETCH_TIMEOUT = 5_000;  // inventory 호출 상한 — 노드 장애(시나리오3)로 inventory가 죽어도 무한 대기 방지

type OrderItem = { productId: string; size: number; quantity: number };

async function reserveInventory(item: OrderItem): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${INVENTORY_URL}/inventory/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (res.ok) return { ok: true };
    const data = await res.json() as { message?: string };
    return { ok: false, error: data.message ?? '재고 부족' };
  } catch {
    return { ok: false, error: 'Inventory Service 연결 오류' };
  }
}

async function releaseInventory(item: OrderItem): Promise<void> {
  try {
    await fetch(`${INVENTORY_URL}/inventory/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
  } catch {
    console.error('[release] 재고 해제 실패', item);
  }
}

// POST /orders — 주문 생성
router.post('/', async (req, res) => {
  const { items } = req.body as { items?: OrderItem[] };

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: '주문 항목이 없습니다.' });
  }

  // UUID 형식 사전 검증 — 잘못된 ID로 DB 크래시 방지
  for (const item of items) {
    if (!UUID_RE.test(item.productId)) {
      return res.status(400).json({ message: `유효하지 않은 상품 ID: ${item.productId}` });
    }
  }

  // 1. 상품 정보 조회
  let productMap: Map<string, { id: string; name: string; price: number; is_timesale: boolean; sale_price: number | null }>;
  try {
    const productIds = [...new Set(items.map((i) => i.productId))];
    const { rows } = await pool.query<{
      id: string; name: string; price: number; is_timesale: boolean; sale_price: number | null;
    }>(
      'SELECT id, name, price, is_timesale, sale_price FROM products WHERE id = ANY($1)',
      [productIds],
    );
    productMap = new Map(rows.map((p) => [p.id, p]));
  } catch (err) {
    console.error('[POST /orders] 상품 조회 실패', err);
    return res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }

  for (const item of items) {
    if (!productMap.has(item.productId)) {
      return res.status(404).json({ message: `상품을 찾을 수 없습니다: ${item.productId}` });
    }
  }

  // 2. 재고 예약
  const reserved: OrderItem[] = [];
  for (const item of items) {
    const result = await reserveInventory(item);
    if (!result.ok) {
      for (const r of reserved) await releaseInventory(r);
      return res.status(409).json({ message: result.error ?? '재고 부족' });
    }
    reserved.push(item);
  }

  // 3. 주문 DB 저장
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderId = randomUUID();
    let totalPrice = 0;
    const orderItems = items.map((item) => {
      const p = productMap.get(item.productId)!;
      const unitPrice = p.is_timesale && p.sale_price ? p.sale_price : p.price;
      totalPrice += unitPrice * item.quantity;
      return { ...item, productName: p.name, unitPrice };
    });

    const userId = (req.headers['x-user-id'] as string) || null;

    await client.query(
      'INSERT INTO orders (id, user_id, status, total_price) VALUES ($1, $2, $3, $4)',
      [orderId, userId, 'PENDING', totalPrice],
    );

    for (const item of orderItems) {
      await client.query(
        `INSERT INTO order_items (id, order_id, product_id, product_name, size, quantity, unit_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), orderId, item.productId, item.productName, item.size, item.quantity, item.unitPrice],
      );
    }

    await client.query('COMMIT');
    return res.status(201).json({ orderId, status: 'PENDING', totalPrice, items: orderItems });
  } catch (err) {
    await client.query('ROLLBACK');
    for (const r of reserved) await releaseInventory(r);
    console.error('[POST /orders] DB 저장 실패', err);
    return res.status(500).json({ message: '주문 생성 중 오류가 발생했습니다.' });
  } finally {
    client.release();
  }
});

// GET /orders/:id — 주문 조회
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: orderRows } = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (!orderRows[0]) return res.status(404).json({ message: '주문을 찾을 수 없습니다.' });

    const { rows: itemRows } = await pool.query(
      'SELECT * FROM order_items WHERE order_id = $1 ORDER BY id',
      [id],
    );
    return res.json({ ...orderRows[0], items: itemRows });
  } catch (err) {
    console.error('[GET /orders/:id]', err);
    return res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// PATCH /orders/:id/status — 상태 변경 (Payment Service 호출)
router.patch('/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status, failedReason } = req.body as { status?: string; failedReason?: string };

  if (!status || !['PAID', 'FAILED'].includes(status)) {
    return res.status(400).json({ message: '유효하지 않은 상태값입니다.' });
  }

  const now = new Date().toISOString();
  try {
    const { rows } = await pool.query(
      `UPDATE orders
       SET status        = $1,
           paid_at       = $2,
           failed_at     = $3,
           failed_reason = $4
       WHERE id = $5
       RETURNING *`,
      [status, status === 'PAID' ? now : null, status === 'FAILED' ? now : null, failedReason ?? null, id],
    );
    if (!rows[0]) return res.status(404).json({ message: '주문을 찾을 수 없습니다.' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('[PATCH /orders/:id/status]', err);
    return res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

export default router;
