CREATE TABLE IF NOT EXISTS monetization_webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL CHECK (provider IN ('apple', 'google')),
  event_id TEXT NOT NULL,
  event_type TEXT,
  payload_json TEXT,
  transaction_id TEXT,
  purchase_token TEXT,
  purchase_status TEXT CHECK (purchase_status IN ('active', 'expired', 'refunded', 'canceled', 'pending')),
  expires_at DATETIME,
  purchase_id INTEGER,
  user_id INTEGER,
  process_state TEXT NOT NULL DEFAULT 'received' CHECK (process_state IN ('received', 'processed', 'ignored', 'failed')),
  process_message TEXT,
  received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME,
  UNIQUE(provider, event_id),
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_monetization_webhook_events_provider_received
  ON monetization_webhook_events(provider, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_monetization_webhook_events_state_received
  ON monetization_webhook_events(process_state, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_monetization_webhook_events_purchase
  ON monetization_webhook_events(purchase_id, user_id);

CREATE TABLE IF NOT EXISTS monetization_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL DEFAULT 'warn' CHECK (level IN ('info', 'warn', 'error')),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  context_json TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  resolved_by_admin_id INTEGER,
  FOREIGN KEY (resolved_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_monetization_alerts_status_created
  ON monetization_alerts(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_monetization_alerts_code_created
  ON monetization_alerts(code, created_at DESC);
