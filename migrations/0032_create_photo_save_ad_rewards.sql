CREATE TABLE IF NOT EXISTS photo_save_ad_rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  post_id INTEGER,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  ad_unit_id TEXT,
  reward_type TEXT,
  reward_amount INTEGER DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('earned', 'consumed', 'expired')),
  earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  consumed_at DATETIME,
  expires_at DATETIME NOT NULL,
  raw_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_photo_save_ad_rewards_user_status
  ON photo_save_ad_rewards(user_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_photo_save_ad_rewards_post_created
  ON photo_save_ad_rewards(post_id, created_at);

CREATE TABLE IF NOT EXISTS photo_save_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  post_id INTEGER,
  access_type TEXT NOT NULL CHECK (access_type IN ('free', 'rewarded_ad', 'premium')),
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  rewarded_grant_id INTEGER,
  request_id TEXT,
  meta_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL,
  FOREIGN KEY (rewarded_grant_id) REFERENCES photo_save_ad_rewards(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_photo_save_events_user_created
  ON photo_save_events(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_photo_save_events_post_created
  ON photo_save_events(post_id, created_at);

CREATE INDEX IF NOT EXISTS idx_photo_save_events_access_created
  ON photo_save_events(access_type, created_at);
