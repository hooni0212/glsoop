CREATE TABLE IF NOT EXISTS ux_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  event_name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'web',
  session_id TEXT,
  anonymous_id TEXT,
  page_path TEXT,
  referrer TEXT,
  properties_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ux_events_created_at
  ON ux_events(created_at);

CREATE INDEX IF NOT EXISTS idx_ux_events_event_created
  ON ux_events(event_name, created_at);

CREATE INDEX IF NOT EXISTS idx_ux_events_user_created
  ON ux_events(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ux_events_session_created
  ON ux_events(session_id, created_at);
