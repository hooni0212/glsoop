CREATE TABLE IF NOT EXISTS post_writing_event_contexts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  event_key TEXT NOT NULL,
  event_title TEXT,
  prompt_key TEXT NOT NULL,
  prompt_day INTEGER,
  prompt_title TEXT,
  prompt_body TEXT,
  source TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_post_writing_event_contexts_post
  ON post_writing_event_contexts(post_id);

CREATE INDEX IF NOT EXISTS idx_post_writing_event_contexts_user_event
  ON post_writing_event_contexts(user_id, event_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_post_writing_event_contexts_prompt
  ON post_writing_event_contexts(event_key, prompt_key, created_at DESC);
