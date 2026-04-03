CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id INTEGER NOT NULL,
  blocked_user_id INTEGER NOT NULL,
  reason_code TEXT NOT NULL DEFAULT 'harassment',
  detail TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_id, blocked_user_id),
  FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS safety_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER,
  target_type TEXT NOT NULL,
  target_post_id INTEGER,
  target_user_id INTEGER,
  source TEXT NOT NULL DEFAULT 'report',
  reason_code TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  action TEXT,
  action_detail TEXT,
  handled_by_user_id INTEGER,
  handled_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (target_post_id) REFERENCES posts(id) ON DELETE SET NULL,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (handled_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked_user
  ON user_blocks(blocked_user_id, blocker_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_created_at
  ON user_blocks(blocker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_safety_reports_status_created
  ON safety_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_safety_reports_target_post
  ON safety_reports(target_post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_safety_reports_target_user
  ON safety_reports(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_safety_reports_reporter
  ON safety_reports(reporter_id, created_at DESC);
