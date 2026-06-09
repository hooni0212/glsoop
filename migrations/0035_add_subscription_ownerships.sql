ALTER TABLE purchases ADD COLUMN original_transaction_id TEXT;
ALTER TABLE purchases ADD COLUMN app_account_token TEXT;
ALTER TABLE purchases ADD COLUMN environment TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE purchases ADD COLUMN web_order_line_item_id TEXT;
ALTER TABLE purchases ADD COLUMN ownership_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_purchases_subscription_identity
  ON purchases(platform, environment, store_sku, original_transaction_id)
  WHERE original_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_ownership
  ON purchases(ownership_id);

CREATE TABLE IF NOT EXISTS subscription_ownerships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('apple', 'google', 'web')),
  store_sku TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'unknown',
  original_transaction_id TEXT NOT NULL,
  app_account_token TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'refunded', 'canceled', 'pending')),
  first_transaction_id TEXT,
  latest_transaction_id TEXT,
  expires_at DATETIME,
  raw_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  transferred_at DATETIME,
  transferred_from_user_id INTEGER,
  UNIQUE(platform, environment, store_sku, original_transaction_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (transferred_from_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_subscription_ownerships_user_status
  ON subscription_ownerships(user_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_subscription_ownerships_identity
  ON subscription_ownerships(platform, environment, original_transaction_id);

INSERT OR IGNORE INTO subscription_ownerships (
  user_id,
  platform,
  store_sku,
  environment,
  original_transaction_id,
  app_account_token,
  status,
  first_transaction_id,
  latest_transaction_id,
  expires_at,
  raw_json
)
SELECT
  p.user_id,
  p.platform,
  p.store_sku,
  COALESCE(NULLIF(p.environment, ''), 'unknown'),
  COALESCE(NULLIF(p.original_transaction_id, ''), p.transaction_id, p.purchase_token),
  p.app_account_token,
  p.status,
  p.transaction_id,
  p.transaction_id,
  p.expires_at,
  p.raw_json
FROM purchases p
JOIN products pr
  ON pr.platform = p.platform
 AND pr.store_sku = p.store_sku
WHERE pr.product_type = 'subscription'
  AND COALESCE(NULLIF(p.original_transaction_id, ''), p.transaction_id, p.purchase_token) IS NOT NULL;

UPDATE purchases
SET ownership_id = (
  SELECT so.id
  FROM subscription_ownerships so
  WHERE so.platform = purchases.platform
    AND so.store_sku = purchases.store_sku
    AND so.environment = COALESCE(NULLIF(purchases.environment, ''), 'unknown')
    AND so.original_transaction_id = COALESCE(
      NULLIF(purchases.original_transaction_id, ''),
      purchases.transaction_id,
      purchases.purchase_token
    )
  LIMIT 1
)
WHERE ownership_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM products pr
    WHERE pr.platform = purchases.platform
      AND pr.store_sku = purchases.store_sku
      AND pr.product_type = 'subscription'
  );

ALTER TABLE monetization_webhook_events ADD COLUMN original_transaction_id TEXT;
ALTER TABLE monetization_webhook_events ADD COLUMN app_account_token TEXT;
ALTER TABLE monetization_webhook_events ADD COLUMN environment TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE monetization_webhook_events ADD COLUMN store_sku TEXT;
ALTER TABLE monetization_webhook_events ADD COLUMN ownership_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_monetization_webhook_events_original_transaction
  ON monetization_webhook_events(provider, environment, original_transaction_id)
  WHERE original_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_monetization_webhook_events_ownership
  ON monetization_webhook_events(ownership_id);
