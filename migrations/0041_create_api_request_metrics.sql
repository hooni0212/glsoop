CREATE TABLE IF NOT EXISTS api_request_daily_metrics (
  day_key TEXT NOT NULL,
  route_key TEXT NOT NULL,
  method TEXT NOT NULL,
  status_class INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  duration_total_ms INTEGER NOT NULL DEFAULT 0,
  duration_max_ms INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (day_key, route_key, method, status_class)
);

CREATE INDEX IF NOT EXISTS idx_api_request_metrics_day
  ON api_request_daily_metrics(day_key);
