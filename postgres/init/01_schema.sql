-- ============================================================
-- Shoply MSA Schema
-- ============================================================

-- ── user 서비스 소유 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email      VARCHAR(255) UNIQUE NOT NULL,
  password   VARCHAR(255) NOT NULL,
  name       VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── product 서비스 소유 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(255) NOT NULL,
  price        INTEGER      NOT NULL,
  description  TEXT,
  image_url    VARCHAR(500),
  is_timesale  BOOLEAN      NOT NULL DEFAULT FALSE,
  sale_price   INTEGER,
  sale_ends_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── inventory 서비스 소유 ────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID    NOT NULL REFERENCES products(id),
  size       INTEGER NOT NULL,
  quantity   INTEGER NOT NULL DEFAULT 0,
  reserved   INTEGER NOT NULL DEFAULT 0,
  version    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (product_id, size)
);

-- ── order 서비스 소유 ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        REFERENCES users(id),
  status      VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING | PAID | FAILED
  total_price INTEGER     NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at     TIMESTAMPTZ,
  failed_at   TIMESTAMPTZ,
  failed_reason TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID        NOT NULL REFERENCES orders(id),
  product_id   UUID        NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  size         INTEGER     NOT NULL,
  quantity     INTEGER     NOT NULL,
  unit_price   INTEGER     NOT NULL
);

-- ── payment 서비스 소유 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID        NOT NULL REFERENCES orders(id),
  method        VARCHAR(20) NOT NULL DEFAULT 'card', -- card | bank
  status        VARCHAR(20) NOT NULL,                -- PAID | FAILED | PENDING
  amount        INTEGER     NOT NULL,
  failed_reason TEXT,                                -- PAYMENT_GATEWAY_ERROR | INSUFFICIENT_STOCK
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 인덱스 ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_inventory_product_id  ON inventory(product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id  ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_status         ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_user_id        ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_order_id     ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_products_is_timesale  ON products(is_timesale);
