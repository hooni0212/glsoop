ALTER TABLE users ADD COLUMN created_at DATETIME;

UPDATE users
SET created_at = COALESCE(
  (
    SELECT MIN(uce.created_at)
    FROM user_consent_events uce
    WHERE uce.user_id = users.id AND uce.source = 'signup'
  ),
  (
    SELECT MIN(ue.created_at)
    FROM ux_events ue
    WHERE ue.user_id = users.id
  ),
  (
    SELECT MIN(p.created_at)
    FROM posts p
    WHERE p.user_id = users.id
  ),
  (SELECT MIN(created_at) FROM user_consent_events),
  (SELECT MIN(created_at) FROM ux_events),
  (SELECT MIN(created_at) FROM posts),
  '2025-01-01 00:00:00'
)
WHERE created_at IS NULL;

CREATE TRIGGER IF NOT EXISTS users_set_created_at_after_insert
AFTER INSERT ON users
FOR EACH ROW
WHEN NEW.created_at IS NULL
BEGIN
  UPDATE users SET created_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE INDEX IF NOT EXISTS idx_users_created_at
  ON users(created_at);

CREATE TABLE IF NOT EXISTS user_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  draft_key TEXT NOT NULL,
  client_type TEXT NOT NULL DEFAULT 'unknown'
    CHECK (client_type IN ('web', 'native', 'unknown')),
  state_json TEXT NOT NULL,
  client_updated_at_ms INTEGER NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL DEFAULT (datetime('now', '+30 days')),
  UNIQUE(user_id, draft_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_drafts_user_updated
  ON user_drafts(user_id, client_updated_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_user_drafts_expires
  ON user_drafts(expires_at);
