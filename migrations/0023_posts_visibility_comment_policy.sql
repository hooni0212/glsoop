ALTER TABLE posts ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
ALTER TABLE posts ADD COLUMN comment_policy TEXT NOT NULL DEFAULT 'logged_in';
ALTER TABLE posts ADD COLUMN visibility_updated_at DATETIME;
ALTER TABLE posts ADD COLUMN comment_policy_updated_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_posts_visibility_created
  ON posts(visibility, created_at DESC);
