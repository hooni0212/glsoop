CREATE TABLE IF NOT EXISTS quest_post_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  post_id INTEGER NOT NULL,
  state_id INTEGER NOT NULL,
  campaign_id INTEGER NOT NULL,
  template_id INTEGER NOT NULL,
  prompt_key TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(state_id, post_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (state_id) REFERENCES user_quest_state(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES quest_campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES quest_templates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quest_post_submissions_user_template
  ON quest_post_submissions(user_id, campaign_id, template_id);

CREATE INDEX IF NOT EXISTS idx_quest_post_submissions_state
  ON quest_post_submissions(state_id, created_at DESC);
