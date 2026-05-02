CREATE TABLE IF NOT EXISTS admin_operational_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL DEFAULT 'system' CHECK (
    domain IN ('growth', 'campaign', 'notifications', 'monetization', 'system')
  ),
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'error')),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  context_json TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  dedupe_key TEXT UNIQUE,
  created_by_admin_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  resolved_by_admin_id INTEGER,
  FOREIGN KEY (created_by_admin_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (resolved_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_operational_alerts_status_created
  ON admin_operational_alerts(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_operational_alerts_domain_status
  ON admin_operational_alerts(domain, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_operational_alerts_code_created
  ON admin_operational_alerts(code, created_at DESC);
