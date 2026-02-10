CREATE TABLE IF NOT EXISTS cosmetic_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('badge', 'sticker')),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  rarity TEXT DEFAULT 'common',
  season TEXT,
  icon_emoji TEXT,
  meta_json TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cosmetic_items_type_active
  ON cosmetic_items(type, is_active);

CREATE TABLE IF NOT EXISTS user_cosmetics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  cosmetic_id INTEGER NOT NULL,
  source TEXT DEFAULT 'unknown',
  earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, cosmetic_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (cosmetic_id) REFERENCES cosmetic_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_cosmetics_user_earned
  ON user_cosmetics(user_id, earned_at);

CREATE INDEX IF NOT EXISTS idx_user_cosmetics_cosmetic
  ON user_cosmetics(cosmetic_id);

CREATE TABLE IF NOT EXISTS user_profile_cosmetics (
  user_id INTEGER PRIMARY KEY,
  primary_badge_key TEXT,
  showcase_badge_keys_json TEXT,
  header_stickers_json TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO cosmetic_items (type, key, name, rarity, season, icon_emoji, meta_json, is_active)
VALUES
  ('badge', 'badge_default_seedling', '새싹 배지', 'common', NULL, '🌱', NULL, 1),
  ('badge', 'badge_spring_2026', '2026 봄 배지', 'rare', '2026_spring', '🌸', NULL, 1),
  ('badge', 'badge_winter_2026', '2026 겨울 배지', 'rare', '2026_winter', '❄️', NULL, 1),
  ('sticker', 'sticker_leaf', '리프 스티커', 'common', NULL, '🍃', NULL, 1),
  ('sticker', 'sticker_star', '스타 스티커', 'common', NULL, '✨', NULL, 1),
  ('sticker', 'sticker_moon', '문 스티커', 'rare', NULL, '🌙', NULL, 1);

INSERT OR IGNORE INTO user_cosmetics (user_id, cosmetic_id, source)
SELECT u.id, ci.id, 'default'
FROM users u
JOIN cosmetic_items ci ON ci.key = 'badge_default_seedling';

INSERT OR IGNORE INTO user_profile_cosmetics (
  user_id,
  primary_badge_key,
  showcase_badge_keys_json,
  header_stickers_json
)
SELECT
  u.id,
  'badge_default_seedling',
  '[]',
  '[]'
FROM users u;

UPDATE user_profile_cosmetics
SET primary_badge_key = 'badge_default_seedling'
WHERE primary_badge_key IS NULL OR TRIM(primary_badge_key) = '';

UPDATE user_profile_cosmetics
SET showcase_badge_keys_json = '[]'
WHERE showcase_badge_keys_json IS NULL OR TRIM(showcase_badge_keys_json) = '';

UPDATE user_profile_cosmetics
SET header_stickers_json = '[]'
WHERE header_stickers_json IS NULL OR TRIM(header_stickers_json) = '';
