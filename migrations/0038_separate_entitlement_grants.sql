CREATE TABLE IF NOT EXISTS user_entitlement_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  entitlement_key TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('admin', 'promo')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  starts_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ends_at DATETIME,
  meta_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, entitlement_key, source),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_entitlement_grants_user_status
  ON user_entitlement_grants(user_id, status);

CREATE INDEX IF NOT EXISTS idx_user_entitlement_grants_key_status
  ON user_entitlement_grants(entitlement_key, status);

INSERT OR IGNORE INTO user_entitlement_grants (
  user_id,
  entitlement_key,
  source,
  status,
  starts_at,
  ends_at,
  meta_json,
  created_at,
  updated_at
)
SELECT
  user_id,
  entitlement_key,
  source,
  status,
  starts_at,
  ends_at,
  meta_json,
  created_at,
  updated_at
FROM user_entitlements
WHERE source IN ('admin', 'promo');

DELETE FROM user_entitlements
WHERE source IN ('admin', 'promo');
