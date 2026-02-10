CREATE TABLE IF NOT EXISTS share_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER,
  user_id INTEGER,
  platform TEXT NOT NULL CHECK (platform IN ('mobile', 'web')),
  surface TEXT NOT NULL CHECK (LENGTH(TRIM(surface)) > 0),
  channel TEXT NOT NULL CHECK (LENGTH(TRIM(channel)) > 0),
  result TEXT NOT NULL CHECK (result IN ('shared', 'dismissed', 'failed')),
  request_id TEXT,
  meta_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_share_events_created_at
  ON share_events(created_at);

CREATE INDEX IF NOT EXISTS idx_share_events_post_created
  ON share_events(post_id, created_at);

CREATE INDEX IF NOT EXISTS idx_share_events_user_created
  ON share_events(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_share_events_platform_surface_created
  ON share_events(platform, surface, created_at);

CREATE INDEX IF NOT EXISTS idx_share_events_channel_created
  ON share_events(channel, created_at);

CREATE INDEX IF NOT EXISTS idx_share_events_result_created
  ON share_events(result, created_at);
