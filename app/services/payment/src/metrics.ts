import { Registry, Histogram, Counter, collectDefaultMetrics } from 'prom-client';

export const register = new Registry();
collectDefaultMetrics({ register });

export const httpDuration = new Histogram({
  name: 'payment_service_http_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

export const paymentTotal = new Counter({
  name: 'payment_processed_total',
  help: 'Total number of payments processed',
  labelNames: ['status'],
  registers: [register],
});
