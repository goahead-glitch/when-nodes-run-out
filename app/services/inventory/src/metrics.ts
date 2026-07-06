import { Registry, Histogram, Counter, collectDefaultMetrics } from 'prom-client';

export const register = new Registry();
collectDefaultMetrics({ register });

export const httpDuration = new Histogram({
  name: 'inventory_service_http_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

export const stockConflicts = new Counter({
  name: 'inventory_stock_conflicts_total',
  help: 'Number of stock reservation failures due to insufficient stock',
  registers: [register],
});
