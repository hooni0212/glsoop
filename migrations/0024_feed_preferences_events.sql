CREATE TABLE IF NOT EXISTS genres (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT 'genre',
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS post_genres (
  post_id INTEGER NOT NULL,
  genre_id INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'author',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, genre_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_feed_preferences (
  user_id INTEGER NOT NULL,
  genre_id INTEGER NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, genre_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS feed_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  post_id INTEGER,
  event_type TEXT NOT NULL,
  surface TEXT NOT NULL,
  genre_slug TEXT,
  dwell_ms INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_post_genres_genre
  ON post_genres(genre_id, post_id);

CREATE INDEX IF NOT EXISTS idx_feed_events_user_created
  ON feed_events(user_id, created_at DESC);

INSERT OR IGNORE INTO genres (slug, name, group_name, description, sort_order) VALUES
  ('poem', '시', 'genre', '짧고 밀도 있는 시를 모아 읽어요.', 10),
  ('essay', '에세이', 'genre', '생각과 이야기가 담긴 산문을 읽어요.', 20),
  ('short', '짧은글', 'genre', '한 화면 안에서 읽기 좋은 글이에요.', 30),
  ('comfort', '위로', 'mood', '마음을 다독이는 글이에요.', 40),
  ('dawn', '새벽', 'mood', '조용한 시간대의 감성을 담은 글이에요.', 50),
  ('relay', '릴레이', 'participation', '이어쓰기와 협업 글을 모아요.', 60);
