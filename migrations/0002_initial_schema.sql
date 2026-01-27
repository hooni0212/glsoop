CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  nickname TEXT,
  bio TEXT,
  about TEXT,
  email TEXT NOT NULL UNIQUE,
  pw TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0,
  is_verified INTEGER DEFAULT 0,
  verification_token TEXT,
  verification_expires DATETIME,
  reset_token TEXT,
  reset_expires DATETIME,
  level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 0,
  streak_days INTEGER DEFAULT 0,
  max_streak_days INTEGER DEFAULT 0,
  last_post_date TEXT
);

CREATE TABLE otp_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE pending_signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  nickname TEXT,
  email TEXT NOT NULL UNIQUE,
  pw_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
);

CREATE TABLE pending_otp_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pending_id INTEGER NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pending_id) REFERENCES pending_signups(id) ON DELETE CASCADE
);

CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT DEFAULT 'short',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE likes (
  user_id INTEGER NOT NULL,
  post_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, post_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (post_id) REFERENCES posts(id)
);

CREATE TABLE follows (
  follower_id INTEGER NOT NULL,
  followee_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follower_id, followee_id),
  FOREIGN KEY (follower_id) REFERENCES users(id),
  FOREIGN KEY (followee_id) REFERENCES users(id)
);

CREATE TABLE hashtags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE post_hashtags (
  post_id INTEGER NOT NULL,
  hashtag_id INTEGER NOT NULL,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (hashtag_id) REFERENCES hashtags(id) ON DELETE CASCADE
);

CREATE TABLE bookmark_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE bookmark_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL,
  post_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(list_id, post_id),
  FOREIGN KEY (list_id) REFERENCES bookmark_lists(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE xp_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  meta TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE achievements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  target_value INTEGER NOT NULL,
  position_index INTEGER,
  extra_json TEXT
);

CREATE TABLE user_achievements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  achievement_id INTEGER NOT NULL,
  progress_value INTEGER NOT NULL DEFAULT 0,
  unlocked_at DATETIME,
  UNIQUE(user_id, achievement_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (achievement_id) REFERENCES achievements(id)
);

CREATE TABLE quest_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  condition_type TEXT NOT NULL,
  category TEXT,
  target_value INTEGER NOT NULL,
  reward_xp INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE quest_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  campaign_type TEXT DEFAULT 'event',
  start_at DATETIME,
  end_at DATETIME,
  is_active INTEGER DEFAULT 0,
  priority INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE quest_campaign_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  template_id INTEGER NOT NULL,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (campaign_id) REFERENCES quest_campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES quest_templates(id) ON DELETE CASCADE
);

CREATE TABLE user_quest_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  campaign_id INTEGER NOT NULL,
  template_id INTEGER NOT NULL,
  progress INTEGER DEFAULT 0,
  reset_key TEXT,
  completed_at DATETIME,
  UNIQUE(user_id, campaign_id, template_id, reset_key),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (campaign_id) REFERENCES quest_campaigns(id),
  FOREIGN KEY (template_id) REFERENCES quest_templates(id)
);

CREATE INDEX idx_bookmark_lists_user ON bookmark_lists(user_id);
CREATE INDEX idx_bookmark_items_list ON bookmark_items(list_id);
CREATE INDEX idx_bookmark_items_post ON bookmark_items(post_id);
CREATE INDEX idx_pending_signups_expires ON pending_signups(expires_at);
CREATE INDEX idx_pending_otp_pending ON pending_otp_verifications(pending_id);
CREATE INDEX idx_xp_log_user_date ON xp_log(user_id, created_at);
CREATE INDEX idx_posts_created_at ON posts(created_at);
CREATE INDEX idx_posts_user_created ON posts(user_id, created_at);
CREATE INDEX idx_posts_category_created ON posts(category, created_at);
CREATE INDEX idx_likes_post ON likes(post_id);
CREATE INDEX idx_likes_user_created ON likes(user_id, created_at);
CREATE INDEX idx_follows_followee ON follows(followee_id);
CREATE UNIQUE INDEX uq_post_hashtags ON post_hashtags(post_id, hashtag_id);
CREATE INDEX idx_post_hashtags_tag ON post_hashtags(hashtag_id);
CREATE INDEX idx_post_hashtags_post ON post_hashtags(post_id);
CREATE INDEX idx_user_ach_user ON user_achievements(user_id);
CREATE INDEX idx_user_quest_user_campaign ON user_quest_state(user_id, campaign_id, reset_key);
