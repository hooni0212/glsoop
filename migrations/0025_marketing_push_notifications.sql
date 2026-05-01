ALTER TABLE users ADD COLUMN marketing_push_opt_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN marketing_push_opt_in_updated_at DATETIME;

CREATE TABLE IF NOT EXISTS marketing_push_consent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  marketing_version TEXT NOT NULL,
  is_granted INTEGER NOT NULL CHECK (is_granted IN (0, 1)),
  source TEXT NOT NULL CHECK (source IN ('settings', 'signup', 'admin')),
  ip_hash TEXT,
  user_agent TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_marketing_push_consent_user_created
  ON marketing_push_consent_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS marketing_push_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target_path TEXT,
  created_by_user_id INTEGER,
  queued_count INTEGER NOT NULL DEFAULT 0,
  dry_run INTEGER NOT NULL DEFAULT 0 CHECK (dry_run IN (0, 1)),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_marketing_push_campaigns_created
  ON marketing_push_campaigns(created_at DESC);
