ALTER TABLE users ADD COLUMN profile_photo_url TEXT;
ALTER TABLE users ADD COLUMN profile_photo_thumbnail_url TEXT;
ALTER TABLE users ADD COLUMN profile_photo_key TEXT;
ALTER TABLE users ADD COLUMN profile_photo_updated_at DATETIME;

CREATE TABLE IF NOT EXISTS user_profile_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  public_url TEXT NOT NULL,
  thumbnail_url TEXT,
  width INTEGER,
  height INTEGER,
  mime_type TEXT,
  byte_size INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'replaced', 'deleted', 'blocked')
  ),
  moderation_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (
    moderation_status IN ('unreviewed', 'approved', 'reported', 'removed')
  ),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_profile_photos_user_status
  ON user_profile_photos(user_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_profile_photos_active_user
  ON user_profile_photos(user_id)
  WHERE status = 'active';
