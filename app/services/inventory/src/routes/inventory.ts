import { Router } from 'express';
import { pool } from '../db';
import { stockConflicts } from '../metrics';

const router = Router();

// GET /inventory/:productId — 상품별 전체 사이즈 재고 조회
router.get('/:productId', async (req, res) => {
  const { productId } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT size,
              quantity,
              reserved,
              GREATEST(0, quantity - reserved)::int AS available
       FROM inventory
       WHERE product_id = $1
       ORDER BY size`,
      [productId],
    );
    return res.json(rows);
  } catch (err) {
    console.error('[GET /inventory]', err);
    return res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// POST /inventory/reserve — 재고 예약 (주문 생성 시 호출)
router.post('/reserve', async (req, res) => {
  const { productId, size, quantity } = req.body as {
    productId?: string; size?: number; quantity?: number;
  };

  if (!productId || size == null || !quantity || quantity <= 0) {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // SELECT FOR UPDATE — 동일 (productId, size)에 대한 동시 요청 직렬화
    const { rows } = await client.query(
      `SELECT id, quantity, reserved, version
       FROM inventory
       WHERE product_id = $1 AND size = $2
       FOR UPDATE`,
      [productId, size],
    );

    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: '해당 상품/사이즈를 찾을 수 없습니다.' });
    }

    const row = rows[0];
    const available = row.quantity - row.reserved;

    if (available < quantity) {
      await client.query('ROLLBACK');
      stockConflicts.inc();
      return res.status(409).json({
        message: '재고가 부족합니다.',
        available,
        requested: quantity,
      });
    }

    await client.query(
      `UPDATE inventory
       SET reserved = reserved + $1, version = version + 1
       WHERE id = $2`,
      [quantity, row.id],
    );

    await client.query('COMMIT');
    return res.json({ ok: true, available: available - quantity });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /inventory/reserve]', err);
    return res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  } finally {
    client.release();
  }
});

// POST /inventory/deduct — 재고 실차감 (결제 성공 시 호출)
router.post('/deduct', async (req, res) => {
  const { productId, size, quantity } = req.body as {
    productId?: string; size?: number; quantity?: number;
  };

  if (!productId || size == null || !quantity || quantity <= 0) {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, quantity, reserved, version
       FROM inventory
       WHERE product_id = $1 AND size = $2
       FOR UPDATE`,
      [productId, size],
    );

    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: '해당 상품/사이즈를 찾을 수 없습니다.' });
    }

    await client.query(
      `UPDATE inventory
       SET quantity = GREATEST(0, quantity - $1),
           reserved = GREATEST(0, reserved - $1),
           version  = version + 1
       WHERE id = $2`,
      [quantity, rows[0].id],
    );

    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /inventory/deduct]', err);
    return res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  } finally {
    client.release();
  }
});

// POST /inventory/release — 예약 해제 (결제 실패 시 호출)
router.post('/release', async (req, res) => {
  const { productId, size, quantity } = req.body as {
    productId?: string; size?: number; quantity?: number;
  };

  if (!productId || size == null || !quantity || quantity <= 0) {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, reserved, version
       FROM inventory
       WHERE product_id = $1 AND size = $2
       FOR UPDATE`,
      [productId, size],
    );

    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: '해당 상품/사이즈를 찾을 수 없습니다.' });
    }

    await client.query(
      `UPDATE inventory
       SET reserved = GREATEST(0, reserved - $1),
           version  = version + 1
       WHERE id = $2`,
      [quantity, rows[0].id],
    );

    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /inventory/release]', err);
    return res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  } finally {
    client.release();
  }
});

export default router;
