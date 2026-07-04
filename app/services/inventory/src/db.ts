import { Pool } from 'pg';

export const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT) || 5432,
  database: process.env.POSTGRES_DB || 'shoply',
  user: process.env.POSTGRES_USER || 'shoply',
  password: process.env.POSTGRES_PASSWORD || 'shoply1234',
  max: 8,  // 파드당 8 × HPA 최대 → PG max_connections(300) 내로 제한
  connectionTimeoutMillis: 5000,  // 죽은 Primary 연결 5초 후 포기 (DB 페일오버 대응)
  keepAlive: true,                // TCP keepalive로 끊긴 연결 빠르게 감지
});

// idle 클라이언트 연결이 끊겨도(DB 페일오버/네트워크 단절) unhandled error로 프로세스가 죽지 않게
pool.on('error', (err) => console.error('[pg pool]', err.message));
