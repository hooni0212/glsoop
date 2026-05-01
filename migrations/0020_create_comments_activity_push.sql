CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  parent_comment_id INTEGER,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  deleted_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_comment_id) REFERENCES comments(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_post_created
  ON comments(post_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_comments_user_created
  ON comments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_parent
  ON comments(parent_comment_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_comments_post_status
  ON comments(post_id, status);

CREATE TABLE IF NOT EXISTS activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_user_id INTEGER NOT NULL,
  actor_user_id INTEGER,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'post_liked',
      'post_bookmarked',
      'comment_created',
      'comment_replied',
      'system'
    )
  ),
  post_id INTEGER,
  comment_id INTEGER,
  parent_comment_id INTEGER,
  title TEXT,
  body TEXT,
  meta_json TEXT,
  read_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  unique_key TEXT,
  FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE SET NULL,
  FOREIGN KEY (parent_comment_id) REFERENCES comments(id) ON DELETE SET NULL,
  UNIQUE(unique_key)
);

CREATE INDEX IF NOT EXISTS idx_activity_recipient_created
  ON activity_events(recipient_user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_recipient_read_created
  ON activity_events(recipient_user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_post
  ON activity_events(post_id, created_at DESC);

CREATE TABLE IF NOT EXISTS push_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web', 'unknown')),
  device_id TEXT,
  app_version TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user_enabled
  ON push_tokens(user_id, enabled, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS push_delivery_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_event_id INTEGER NOT NULL,
  recipient_user_id INTEGER NOT NULL,
  push_token_id INTEGER,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'sent', 'failed', 'skipped')
  ),
  provider TEXT NOT NULL DEFAULT 'expo',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload_json TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME,
  FOREIGN KEY (activity_event_id) REFERENCES activity_events(id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (push_token_id) REFERENCES push_tokens(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_push_delivery_queue_status_created
  ON push_delivery_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_push_delivery_queue_recipient
  ON push_delivery_queue(recipient_user_id, created_at DESC);
