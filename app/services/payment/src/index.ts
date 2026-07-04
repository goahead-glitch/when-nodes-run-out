import express from 'express';
import { pool } from './db';
import { redis } from './redis';
import paymentsRouter from './routes/payments';
import { register, httpDuration } from './metrics';

// UUID → :id 정규화로 route 라벨 고카디널리티 방지
function normalizeRoute(path: string): string {
  return path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');
}

const app = express();
const PORT = Number(process.env.PAYMENT_PORT) || 4004;

app.use(express.json());
app.use((req, res, next) => {
  const route = normalizeRoute(req.path);
  const end = httpDuration.startTimer({ method: req.method, route });
  res.on('finish', () => end({ status: String(res.statusCode) }));
  next();
});

// /payments/*        — 결제 처리
// /payments/stats    — 통계 (gateway: /api/stats → /payments/stats)
app.use('/payments', paymentsRouter);

app.get('/livez', (_req, res) => res.status(200).json({ status: 'alive' }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    await redis.ping();
    res.json({ status: 'ok', service: 'payment' });
  } catch {
    res.status(503).json({ status: 'error' });
  }
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

const server = app.listen(PORT, () => {
  console.log(`[payment-service] :${PORT}`);
});

// Graceful shutdown — 진행 중 요청 처리 후 종료 (시나리오 B/C MTTR 정밀도)
process.on('SIGTERM', () => {
  console.log('[SIGTERM] graceful shutdown');
  server.close(() => process.exit(0));
});


