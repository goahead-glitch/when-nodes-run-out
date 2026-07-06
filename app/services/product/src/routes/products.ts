import { Router } from 'express';
import { pool } from '../db';
import { redis } from '../redis';

const router = Router();

const TTL_LIST   = 60;  // 상품 목록 캐시 60초
const TTL_DETAIL = 30;  // 상품 상세 캐시 30초
// 재고 수량은 캐싱 안 함 — 항상 DB 직접 조회

function stockStatus(total: number): '재고 있음' | '재고 부족' | '품절' {
  if (total === 0) return '품절';
  if (total <= 5)  return '재고 부족';
  return '재고 있음';
}

// GET /products
router.get('/', async (_req, res) => {
  try {
    const cached = await redis.get('products:list');
    if (cached) return res.json(JSON.parse(cached));

    const { rows } = await pool.query(`
      SELECT
        p.id, p.name, p.price, p.description, p.image_url,
        p.is_timesale, p.sale_price, p.sale_ends_at,
        COALESCE(SUM(GREATEST(0, i.quantity - i.reserved)), 0)::int AS total_available
      FROM products p
      LEFT JOIN inventory i ON i.product_id = p.id
      GROUP BY p.id
      ORDER BY p.is_timesale DESC, p.created_at DESC
    `);

    const result = rows.map((r) => ({
      id: r.id,
      name: r.name,
      price: r.price,
      description: r.description,
      image_url: r.image_url,
      is_timesale: r.is_timesale,
      sale_price: r.sale_price,
      sale_ends_at: r.sale_ends_at,
      stock_status: stockStatus(Number(r.total_available)),
      total_available: Number(r.total_available),  // 어드민 재고 확인용
    }));

    await redis.setex('products:list', TTL_LIST, JSON.stringify(result));
    return res.json(result);
  } catch (err) {
    console.error('[GET /products]', err);
    return res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// GET /products/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // 상품 기본 정보 — 캐시 사용
    let product: Record<string, unknown>;
    const cachedProduct = await redis.get(`products:${id}`);
    if (cachedProduct) {
      product = JSON.parse(cachedProduct);
    } else {
      const { rows } = await pool.query(
        `SELECT id, name, price, description, image_url,
                is_timesale, sale_price, sale_ends_at
         FROM products WHERE id = $1`,
        [id],
      );
      if (!rows[0]) return res.status(404).json({ message: '상품을 찾을 수 없습니다.' });
      product = rows[0];
      await redis.setex(`products:${id}`, TTL_DETAIL, JSON.stringify(product));
    }

    // 재고 — 항상 DB 직접 조회 (캐시 안 함)
    const { rows: inv } = await pool.query(
      `SELECT size, GREATEST(0, quantity - reserved)::int AS available
       FROM inventory WHERE product_id = $1 ORDER BY size`,
      [id],
    );

    const totalAvailable = inv.reduce((s, i) => s + i.available, 0);

    return res.json({
      ...product,
      stock_status: stockStatus(totalAvailable),
      sizes: inv,  // [{ size: 240, available: 5 }, ...]
    });
  } catch (err) {
    console.error(`[GET /products/${id}]`, err);
    return res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// PATCH /products/:id/timesale — 개별 타임세일 ON/OFF (어드민)
router.patch('/:id/timesale', async (req, res) => {
  const { id } = req.params;
  const { enable, discountRate, durationHours } = req.body as {
    enable: boolean; discountRate?: number; durationHours?: number;
  };

  try {
    if (enable) {
      const rate = discountRate ?? 30;
      const hours = durationHours ?? 1;
      const { rows } = await pool.query('SELECT price FROM products WHERE id = $1', [id]);
      if (!rows[0]) return res.status(404).json({ message: '상품을 찾을 수 없습니다.' });

      const salePrice = Math.round(rows[0].price * (1 - rate / 100) / 1000) * 1000;
      const saleEndsAt = new Date(Date.now() + hours * 3_600_000).toISOString();

      await pool.query(
        'UPDATE products SET is_timesale=TRUE, sale_price=$1, sale_ends_at=$2 WHERE id=$3',
        [salePrice, saleEndsAt, id],
      );
    } else {
      await pool.query(
        'UPDATE products SET is_timesale=FALSE, sale_price=NULL, sale_ends_at=NULL WHERE id=$1',
        [id],
      );
    }

    await redis.del('products:list');
    await redis.del(`products:${id}`);

    return res.json({ ok: true });
  } catch (err) {
    console.error('[PATCH /products/:id/timesale]', err);
    return res.status(500).json({ message: '서버 오류' });
  }
});

// POST /products/timesale/start — 시나리오 2 트리거: 상위 N개 타임세일 일괄 시작
router.post('/timesale/start', async (req, res) => {
  const { count = 20, discountRate = 40, durationHours = 1 } = req.body as {
    count?: number; discountRate?: number; durationHours?: number;
  };
  try {
    const rate = discountRate;
    const saleEndsAt = new Date(Date.now() + durationHours * 3_600_000).toISOString();

    const { rowCount } = await pool.query(
      `UPDATE products
       SET is_timesale  = TRUE,
           sale_price   = ROUND(price * (1 - $1::numeric / 100) / 1000) * 1000,
           sale_ends_at = $2
       WHERE id IN (
         SELECT id FROM products ORDER BY RANDOM() LIMIT $3
       )`,
      [rate, saleEndsAt, count],
    );

    await redis.del('products:list');

    return res.json({ ok: true, updated: rowCount, discountRate: rate, durationHours, saleEndsAt });
  } catch (err) {
    console.error('[POST /products/timesale/start]', err);
    return res.status(500).json({ message: '서버 오류' });
  }
});

// POST /products/timesale/stop — 모든 타임세일 종료
router.post('/timesale/stop', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'UPDATE products SET is_timesale=FALSE, sale_price=NULL, sale_ends_at=NULL WHERE is_timesale=TRUE',
    );

    const keys = await redis.keys('products:*');
    if (keys.length) await redis.del(...keys);

    return res.json({ ok: true, stopped: rowCount });
  } catch (err) {
    console.error('[POST /products/timesale/stop]', err);
    return res.status(500).json({ message: '서버 오류' });
  }
});

export default router;
