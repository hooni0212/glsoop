CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL CHECK (platform IN ('apple', 'google', 'web')),
  store_sku TEXT NOT NULL,
  product_type TEXT NOT NULL CHECK (
    product_type IN ('non_consumable', 'subscription', 'consumable')
  ),
  entitlement_key TEXT NOT NULL,
  title TEXT,
  description TEXT,
  season TEXT,
  meta_json TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_platform_sku
  ON products(platform, store_sku);

CREATE INDEX IF NOT EXISTS idx_products_active_platform
  ON products(is_active, platform);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('apple', 'google', 'web')),
  store_sku TEXT NOT NULL,
  transaction_id TEXT,
  purchase_token TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'refunded', 'canceled', 'pending')),
  purchased_at DATETIME NOT NULL,
  expires_at DATETIME,
  raw_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (
    (platform = 'apple' AND transaction_id IS NOT NULL)
    OR (platform = 'google' AND purchase_token IS NOT NULL)
    OR (platform = 'web')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchases_platform_transaction
  ON purchases(platform, transaction_id)
  WHERE transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchases_platform_token
  ON purchases(platform, purchase_token)
  WHERE purchase_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_user_purchased_at
  ON purchases(user_id, purchased_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchases_status_expires
  ON purchases(status, expires_at);

CREATE TABLE IF NOT EXISTS user_entitlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  entitlement_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  source TEXT NOT NULL CHECK (source IN ('iap', 'admin', 'promo')),
  starts_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ends_at DATETIME,
  meta_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, entitlement_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_entitlements_user_status
  ON user_entitlements(user_id, status);

CREATE INDEX IF NOT EXISTS idx_user_entitlements_key_status
  ON user_entitlements(entitlement_key, status);

INSERT OR IGNORE INTO products (
  platform,
  store_sku,
  product_type,
  entitlement_key,
  title,
  description,
  season,
  meta_json,
  is_active
)
VALUES
  (
    'apple',
    'pass_2026_spring',
    'non_consumable',
    'pass:2026_spring',
    '2026 봄 시즌 패스',
    '프리미엄 퀘스트와 한정 보상을 획득하세요.',
    '2026_spring',
    '{"benefits":["premium_campaign_unlock","cosmetic_rewards"]}',
    1
  ),
  (
    'google',
    'pass_2026_spring',
    'non_consumable',
    'pass:2026_spring',
    '2026 봄 시즌 패스',
    '프리미엄 퀘스트와 한정 보상을 획득하세요.',
    '2026_spring',
    '{"benefits":["premium_campaign_unlock","cosmetic_rewards"]}',
    1
  ),
  (
    'web',
    'pass_2026_spring_web',
    'non_consumable',
    'pass:2026_spring',
    '2026 봄 시즌 패스 (Web)',
    '웹 결제 연동용 시즌 패스 상품입니다.',
    '2026_spring',
    '{"benefits":["premium_campaign_unlock","cosmetic_rewards"]}',
    0
  );
