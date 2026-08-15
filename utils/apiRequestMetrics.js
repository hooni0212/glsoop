const db = require('../db');

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MAX_ROUTE_LENGTH = 180;

function formatKstDayKey(now = new Date()) {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function normalizeRouteKey(req) {
  const pathname = String(req.originalUrl || req.url || '/api')
    .split('?')[0]
    .replace(/\/+$/, '') || '/api';

  return pathname
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, '/:id')
    .slice(0, MAX_ROUTE_LENGTH);
}

function recordApiRequest(req, res, durationMs, now = new Date()) {
  if (!String(req.originalUrl || '').startsWith('/api')) return;

  const statusCode = Number(res.statusCode) || 500;
  const statusClass = Math.max(1, Math.min(5, Math.floor(statusCode / 100)));
  const safeDuration = Math.max(0, Math.min(300_000, Math.round(Number(durationMs) || 0)));
  const params = [
    formatKstDayKey(now),
    normalizeRouteKey(req),
    String(req.method || 'GET').toUpperCase().slice(0, 12),
    statusClass,
    safeDuration,
    safeDuration,
  ];

  db.run(
    `INSERT INTO api_request_daily_metrics (
       day_key, route_key, method, status_class,
       request_count, duration_total_ms, duration_max_ms, updated_at
     ) VALUES (?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(day_key, route_key, method, status_class) DO UPDATE SET
       request_count = request_count + 1,
       duration_total_ms = duration_total_ms + excluded.duration_total_ms,
       duration_max_ms = MAX(duration_max_ms, excluded.duration_max_ms),
       updated_at = CURRENT_TIMESTAMP`,
    params,
    (error) => {
      if (error && process.env.NODE_ENV !== 'test') {
        console.warn('[api-metrics] failed to record request:', error.message);
      }
    }
  );
}

function apiRequestMetricsMiddleware(req, res, next) {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    recordApiRequest(req, res, durationMs);
  });
  next();
}

module.exports = {
  apiRequestMetricsMiddleware,
  formatKstDayKey,
  normalizeRouteKey,
  recordApiRequest,
};
