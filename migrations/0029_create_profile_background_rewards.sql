CREATE TABLE IF NOT EXISTS profile_background_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  rarity TEXT DEFAULT 'common',
  season TEXT,
  icon_emoji TEXT,
  preview_colors_json TEXT,
  meta_json TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_profile_background_items_active
  ON profile_background_items(is_active, rarity);

CREATE TABLE IF NOT EXISTS user_profile_backgrounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  background_id INTEGER NOT NULL,
  source TEXT DEFAULT 'unknown',
  earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, background_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (background_id) REFERENCES profile_background_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_profile_backgrounds_user_earned
  ON user_profile_backgrounds(user_id, earned_at);

ALTER TABLE user_profile_cosmetics ADD COLUMN profile_background_key TEXT;

INSERT OR IGNORE INTO profile_background_items
  (key, name, rarity, season, icon_emoji, preview_colors_json, meta_json, is_active)
VALUES
  (
    'background_default_paper',
    '기본 종이 배경',
    'common',
    NULL,
    '📜',
    '["#F8F5EC","#E8F1E8"]',
    '{"tone":"paper","source":"default"}',
    1
  ),
  (
    'background_writer_grove',
    '작가의 작은 숲',
    'rare',
    NULL,
    '🌳',
    '["#EAF5EE","#C7E3D0"]',
    '{"tone":"forest","source":"achievement","achievement_codes":["posts_50"]}',
    1
  ),
  (
    'background_deep_forest',
    '깊은 숲의 리듬',
    'epic',
    NULL,
    '🌲',
    '["#DCEFE5","#8DBB9E"]',
    '{"tone":"deep_forest","source":"achievement","achievement_codes":["streak_30"]}',
    1
  ),
  (
    'background_prompt_letters',
    '보내지 못한 편지',
    'rare',
    NULL,
    '💌',
    '["#FFF1E8","#E8F0FF"]',
    '{"tone":"letter","source":"prompt_quest"}',
    1
  );

INSERT OR IGNORE INTO user_profile_backgrounds (user_id, background_id, source)
SELECT u.id, pbi.id, 'default'
FROM users u
JOIN profile_background_items pbi ON pbi.key = 'background_default_paper';

UPDATE user_profile_cosmetics
SET profile_background_key = 'background_default_paper'
WHERE profile_background_key IS NULL OR TRIM(profile_background_key) = '';

INSERT OR IGNORE INTO cosmetic_items (type, key, name, rarity, season, icon_emoji, meta_json, is_active)
VALUES
  ('badge', 'badge_first_post', '첫 글 배지', 'common', NULL, '🌱', '{"source":"achievement","achievement_code":"first_post"}', 1),
  ('badge', 'badge_posts_10', '열 편의 시작 배지', 'common', NULL, '🌿', '{"source":"achievement","achievement_code":"posts_10"}', 1),
  ('badge', 'badge_posts_50', '단단한 나무 배지', 'rare', NULL, '🌳', '{"source":"achievement","achievement_code":"posts_50"}', 1),
  ('badge', 'badge_first_like', '첫 공감 배지', 'common', NULL, '✨', '{"source":"achievement","achievement_code":"first_like"}', 1),
  ('badge', 'badge_loved_post', '사랑받은 글 배지', 'rare', NULL, '💙', '{"source":"achievement","achievement_code":"likes_10_single"}', 1),
  ('badge', 'badge_streak_3', '리듬 찾기 배지', 'common', NULL, '🔥', '{"source":"achievement","achievement_code":"streak_3"}', 1),
  ('badge', 'badge_streak_7', '꾸준한 발걸음 배지', 'rare', NULL, '🌠', '{"source":"achievement","achievement_code":"streak_7"}', 1),
  ('badge', 'badge_streak_30', '숲의 주인 배지', 'epic', NULL, '🏆', '{"source":"achievement","achievement_code":"streak_30"}', 1),
  ('badge', 'badge_first_bookmark', '첫 보금자리 배지', 'common', NULL, '📌', '{"source":"achievement","achievement_code":"first_bookmark"}', 1);

UPDATE quest_templates
SET ui_json = '{"icon":"🌱","label":"업적","position_index":1,"legacy_key":"first_post","display_order":1,"rewards":{"cosmetics":["badge_first_post"]}}'
WHERE template_kind = 'achievement' AND code = 'first_post';

UPDATE quest_templates
SET ui_json = '{"icon":"🌿","label":"업적","position_index":2,"legacy_key":"posts_10","display_order":2,"rewards":{"cosmetics":["badge_posts_10"]}}'
WHERE template_kind = 'achievement' AND code = 'posts_10';

UPDATE quest_templates
SET ui_json = '{"icon":"🌳","label":"업적","position_index":3,"legacy_key":"posts_50","display_order":3,"rewards":{"cosmetics":["badge_posts_50","background_writer_grove"]}}'
WHERE template_kind = 'achievement' AND code = 'posts_50';

UPDATE quest_templates
SET ui_json = '{"icon":"✨","label":"업적","position_index":4,"legacy_key":"first_like","display_order":4,"legacy_condition":"LIKE_RECEIVED_TOTAL","rewards":{"cosmetics":["badge_first_like"]}}'
WHERE template_kind = 'achievement' AND code = 'first_like';

UPDATE quest_templates
SET ui_json = '{"icon":"💙","label":"업적","position_index":5,"legacy_key":"likes_10_single","display_order":5,"legacy_condition":"LIKE_RECEIVED_SINGLE_POST","rewards":{"cosmetics":["badge_loved_post"]}}'
WHERE template_kind = 'achievement' AND code = 'likes_10_single';

UPDATE quest_templates
SET ui_json = '{"icon":"🔥","label":"업적","position_index":6,"legacy_key":"streak_3","display_order":6,"rewards":{"cosmetics":["badge_streak_3"]}}'
WHERE template_kind = 'achievement' AND code = 'streak_3';

UPDATE quest_templates
SET ui_json = '{"icon":"🌠","label":"업적","position_index":7,"legacy_key":"streak_7","display_order":7,"rewards":{"cosmetics":["badge_streak_7"]}}'
WHERE template_kind = 'achievement' AND code = 'streak_7';

UPDATE quest_templates
SET ui_json = '{"icon":"🏆","label":"업적","position_index":8,"legacy_key":"streak_30","display_order":8,"rewards":{"cosmetics":["badge_streak_30","background_deep_forest"]}}'
WHERE template_kind = 'achievement' AND code = 'streak_30';

UPDATE quest_templates
SET ui_json = '{"icon":"📌","label":"업적","position_index":9,"legacy_key":"first_bookmark","display_order":9,"rewards":{"cosmetics":["badge_first_bookmark"]}}'
WHERE template_kind = 'achievement' AND code = 'first_bookmark';
