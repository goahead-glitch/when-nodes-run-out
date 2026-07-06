import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { register, httpDuration } from './metrics';

const app = express();
const PORT = Number(process.env.GATEWAY_PORT) || 4000;

// ── 서비스 URL ────────────────────────────────────────────────
const SVC = {
  user:      process.env.USER_SERVICE_URL      || 'http://localhost:4005',
  product:   process.env.PRODUCT_SERVICE_URL   || 'http://localhost:4001',
  inventory: process.env.INVENTORY_SERVICE_URL || 'http://localhost:4002',
  order:     process.env.ORDER_SERVICE_URL     || 'http://localhost:4003',
  payment:   process.env.PAYMENT_SERVICE_URL   || 'http://localhost:4004',
};

// ── Prometheus ────────────────────────────────────────────────
// route 라벨은 /api/{service} 수준으로 정규화 — UUID 포함 시 고카디널리티 방지
function normalizeGatewayRoute(path: string): string {
  const m = path.match(/^(\/api\/[^/]+)/);
  return m ? m[1] : path;
}

app.use((req, res, next) => {
  const route = normalizeGatewayRoute(req.path);
  const end = httpDuration.startTimer({ method: req.method, route });
  res.on('finish', () => end({ status: String(res.statusCode) }));
  next();
});

// ── 라우팅 ────────────────────────────────────────────────────

// 1차: User Service — /api/auth/*
app.use('/api/auth', createProxyMiddleware({
  target: SVC.user,
  changeOrigin: true,
  pathRewrite: { '^': '/auth' },  // Express strips '/api/auth' → '/login', prepend '/auth' → '/auth/login'
  on: { error: (_err, _req, res) => (res as express.Response).status(503).json({ message: 'User Service unavailable' }) },
}));

// 2차: Product Service — /api/products/*
app.use('/api/products', createProxyMiddleware({
  target: SVC.product,
  changeOrigin: true,
  pathRewrite: { '^': '/products' },
  on: { error: (_err, _req, res) => (res as express.Response).status(503).json({ message: 'Product Service unavailable' }) },
}));

// 3차: Inventory Service — /api/inventory/*
app.use('/api/inventory', createProxyMiddleware({
  target: SVC.inventory,
  changeOrigin: true,
  pathRewrite: { '^': '/inventory' },
  on: { error: (_err, _req, res) => (res as express.Response).status(503).json({ message: 'Inventory Service unavailable' }) },
}));

// 4차: Order Service — /api/orders/*
app.use('/api/orders', createProxyMiddleware({
  target: SVC.order,
  changeOrigin: true,
  pathRewrite: { '^': '/orders' },
  on: { error: (_err, _req, res) => (res as express.Response).status(503).json({ message: 'Order Service unavailable' }) },
}));

// 5차: Payment Service — /api/payments/*, /api/stats
app.use('/api/payments', createProxyMiddleware({
  target: SVC.payment,
  changeOrigin: true,
  pathRewrite: { '^': '/payments' },
  on: { error: (_err, _req, res) => (res as express.Response).status(503).json({ message: 'Payment Service unavailable' }) },
}));
app.use('/api/stats', createProxyMiddleware({
  target: SVC.payment,
  changeOrigin: true,
  pathRewrite: { '^': '/payments/stats' },
  on: { error: (_err, _req, res) => (res as express.Response).status(503).json({ message: 'Payment Service unavailable' }) },
}));

// ── 미등록 서비스 요청 → 503 ──────────────────────────────────
app.use('/api', (_req, res) => {
  res.status(503).json({ message: 'Service not available yet' });
});

// ── 헬스체크 / 메트릭 ────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'gateway' }));

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

const server = app.listen(PORT, () => {
  console.log(`[gateway] :${PORT}`);
  console.log(`  /api/auth  → ${SVC.user}`);
});


process.on('SIGTERM', () => {
  console.log('[SIGTERM] graceful shutdown');
  server.close(() => process.exit(0));
});


