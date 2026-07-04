import express from 'express';
import { pool } from './db';
import authRouter from './routes/auth';
import { register, httpDuration } from './metrics';

// UUID → :id 정규화로 route 라벨 고카디널리티 방지
function normalizeRoute(path: string): string {
  return path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');
}

const app = express();
const PORT = Number(process.env.USER_PORT) || 4005;

app.use(express.json());
app.use((req, res, next) => {
  const route = normalizeRoute(req.path);
  const end = httpDuration.startTimer({ method: req.method, route });
  res.on('finish', () => end({ status: String(res.statusCode) }));
  next();
});

app.use('/auth', authRouter);

app.get('/livez', (_req, res) => res.status(200).json({ status: 'alive' }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'user' });
  } catch {
    res.status(503).json({ status: 'error' });
  }
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

const server = app.listen(PORT, () => {
  console.log(`[user-service] :${PORT}`);
});


// Graceful shutdown — 진행 중 요청 처리 후 종료 (시나리오 B/C MTTR 정밀도)
process.on('SIGTERM', () => {
  console.log('[SIGTERM] graceful shutdown');
  server.close(() => process.exit(0));
});


