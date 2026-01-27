-- Seed legacy achievement templates and attach to the permanent "업적" campaign.

INSERT OR IGNORE INTO quest_templates
  (name, description, condition_type, category, target_value, reward_xp, is_active, template_kind, code, ui_json)
VALUES
  ('첫 걸음', '첫 글을 작성했습니다.', 'POST_COUNT_TOTAL', 'habit', 1, 0, 1, 'achievement', 'first_post',
   '{"icon":"🌱","label":"업적","position_index":1,"legacy_key":"first_post","display_order":1}');
UPDATE quest_templates
SET name = '첫 걸음',
    description = '첫 글을 작성했습니다.',
    condition_type = 'POST_COUNT_TOTAL',
    category = 'habit',
    target_value = 1,
    reward_xp = 0,
    is_active = 1,
    template_kind = 'achievement',
    ui_json = '{"icon":"🌱","label":"업적","position_index":1,"legacy_key":"first_post","display_order":1}'
WHERE code = 'first_post';

INSERT INTO quest_campaign_items (campaign_id, template_id, sort_order)
SELECT qc.id, qt.id, 1
FROM quest_campaigns qc
JOIN quest_templates qt ON qt.code = 'first_post'
WHERE qc.campaign_type = 'permanent'
  AND qc.name = '업적'
  AND NOT EXISTS (
    SELECT 1
    FROM quest_campaign_items qci
    WHERE qci.campaign_id = qc.id AND qci.template_id = qt.id
  );

INSERT OR IGNORE INTO quest_templates
  (name, description, condition_type, category, target_value, reward_xp, is_active, template_kind, code, ui_json)
VALUES
  ('조심스러운 시작', '글 10개를 작성했습니다.', 'POST_COUNT_TOTAL', 'count_posts', 10, 0, 1, 'achievement', 'posts_10',
   '{"icon":"🌿","label":"업적","position_index":2,"legacy_key":"posts_10","display_order":2}');
UPDATE quest_templates
SET name = '조심스러운 시작',
    description = '글 10개를 작성했습니다.',
    condition_type = 'POST_COUNT_TOTAL',
    category = 'count_posts',
    target_value = 10,
    reward_xp = 0,
    is_active = 1,
    template_kind = 'achievement',
    ui_json = '{"icon":"🌿","label":"업적","position_index":2,"legacy_key":"posts_10","display_order":2}'
WHERE code = 'posts_10';

INSERT INTO quest_campaign_items (campaign_id, template_id, sort_order)
SELECT qc.id, qt.id, 2
FROM quest_campaigns qc
JOIN quest_templates qt ON qt.code = 'posts_10'
WHERE qc.campaign_type = 'permanent'
  AND qc.name = '업적'
  AND NOT EXISTS (
    SELECT 1
    FROM quest_campaign_items qci
    WHERE qci.campaign_id = qc.id AND qci.template_id = qt.id
  );

INSERT OR IGNORE INTO quest_templates
  (name, description, condition_type, category, target_value, reward_xp, is_active, template_kind, code, ui_json)
VALUES
  ('단단한 나무', '글 50개를 작성했습니다.', 'POST_COUNT_TOTAL', 'count_posts', 50, 0, 1, 'achievement', 'posts_50',
   '{"icon":"🌳","label":"업적","position_index":3,"legacy_key":"posts_50","display_order":3}');
UPDATE quest_templates
SET name = '단단한 나무',
    description = '글 50개를 작성했습니다.',
    condition_type = 'POST_COUNT_TOTAL',
    category = 'count_posts',
    target_value = 50,
    reward_xp = 0,
    is_active = 1,
    template_kind = 'achievement',
    ui_json = '{"icon":"🌳","label":"업적","position_index":3,"legacy_key":"posts_50","display_order":3}'
WHERE code = 'posts_50';

INSERT INTO quest_campaign_items (campaign_id, template_id, sort_order)
SELECT qc.id, qt.id, 3
FROM quest_campaigns qc
JOIN quest_templates qt ON qt.code = 'posts_50'
WHERE qc.campaign_type = 'permanent'
  AND qc.name = '업적'
  AND NOT EXISTS (
    SELECT 1
    FROM quest_campaign_items qci
    WHERE qci.campaign_id = qc.id AND qci.template_id = qt.id
  );

INSERT OR IGNORE INTO quest_templates
  (name, description, condition_type, category, target_value, reward_xp, is_active, template_kind, code, ui_json)
VALUES
  ('따뜻한 첫 공감', '처음으로 공감을 받았습니다.', 'LIKE_RECEIVED', 'likes', 1, 0, 1, 'achievement', 'first_like',
   '{"icon":"✨","label":"업적","position_index":4,"legacy_key":"first_like","display_order":4,"legacy_condition":"LIKE_RECEIVED_TOTAL"}');
UPDATE quest_templates
SET name = '따뜻한 첫 공감',
    description = '처음으로 공감을 받았습니다.',
    condition_type = 'LIKE_RECEIVED',
    category = 'likes',
    target_value = 1,
    reward_xp = 0,
    is_active = 1,
    template_kind = 'achievement',
    ui_json = '{"icon":"✨","label":"업적","position_index":4,"legacy_key":"first_like","display_order":4,"legacy_condition":"LIKE_RECEIVED_TOTAL"}'
WHERE code = 'first_like';

INSERT INTO quest_campaign_items (campaign_id, template_id, sort_order)
SELECT qc.id, qt.id, 4
FROM quest_campaigns qc
JOIN quest_templates qt ON qt.code = 'first_like'
WHERE qc.campaign_type = 'permanent'
  AND qc.name = '업적'
  AND NOT EXISTS (
    SELECT 1
    FROM quest_campaign_items qci
    WHERE qci.campaign_id = qc.id AND qci.template_id = qt.id
  );

INSERT OR IGNORE INTO quest_templates
  (name, description, condition_type, category, target_value, reward_xp, is_active, template_kind, code, ui_json)
VALUES
  ('공감이 쌓이는 글', '한 글에 공감을 10개 받았습니다.', 'LIKE_RECEIVED', 'likes', 10, 0, 1, 'achievement', 'likes_10_single',
   '{"icon":"💙","label":"업적","position_index":5,"legacy_key":"likes_10_single","display_order":5,"legacy_condition":"LIKE_RECEIVED_SINGLE_POST"}');
UPDATE quest_templates
SET name = '공감이 쌓이는 글',
    description = '한 글에 공감을 10개 받았습니다.',
    condition_type = 'LIKE_RECEIVED',
    category = 'likes',
    target_value = 10,
    reward_xp = 0,
    is_active = 1,
    template_kind = 'achievement',
    ui_json = '{"icon":"💙","label":"업적","position_index":5,"legacy_key":"likes_10_single","display_order":5,"legacy_condition":"LIKE_RECEIVED_SINGLE_POST"}'
WHERE code = 'likes_10_single';

INSERT INTO quest_campaign_items (campaign_id, template_id, sort_order)
SELECT qc.id, qt.id, 5
FROM quest_campaigns qc
JOIN quest_templates qt ON qt.code = 'likes_10_single'
WHERE qc.campaign_type = 'permanent'
  AND qc.name = '업적'
  AND NOT EXISTS (
    SELECT 1
    FROM quest_campaign_items qci
    WHERE qci.campaign_id = qc.id AND qci.template_id = qt.id
  );

INSERT OR IGNORE INTO quest_templates
  (name, description, condition_type, category, target_value, reward_xp, is_active, template_kind, code, ui_json)
VALUES
  ('리듬 찾기', '3일 연속 글을 작성했습니다.', 'STREAK_DAYS', 'streak', 3, 0, 1, 'achievement', 'streak_3',
   '{"icon":"🔥","label":"업적","position_index":6,"legacy_key":"streak_3","display_order":6}');
UPDATE quest_templates
SET name = '리듬 찾기',
    description = '3일 연속 글을 작성했습니다.',
    condition_type = 'STREAK_DAYS',
    category = 'streak',
    target_value = 3,
    reward_xp = 0,
    is_active = 1,
    template_kind = 'achievement',
    ui_json = '{"icon":"🔥","label":"업적","position_index":6,"legacy_key":"streak_3","display_order":6}'
WHERE code = 'streak_3';

INSERT INTO quest_campaign_items (campaign_id, template_id, sort_order)
SELECT qc.id, qt.id, 6
FROM quest_campaigns qc
JOIN quest_templates qt ON qt.code = 'streak_3'
WHERE qc.campaign_type = 'permanent'
  AND qc.name = '업적'
  AND NOT EXISTS (
    SELECT 1
    FROM quest_campaign_items qci
    WHERE qci.campaign_id = qc.id AND qci.template_id = qt.id
  );

INSERT OR IGNORE INTO quest_templates
  (name, description, condition_type, category, target_value, reward_xp, is_active, template_kind, code, ui_json)
VALUES
  ('꾸준한 발걸음', '7일 연속 글을 작성했습니다.', 'STREAK_DAYS', 'streak', 7, 0, 1, 'achievement', 'streak_7',
   '{"icon":"🌠","label":"업적","position_index":7,"legacy_key":"streak_7","display_order":7}');
UPDATE quest_templates
SET name = '꾸준한 발걸음',
    description = '7일 연속 글을 작성했습니다.',
    condition_type = 'STREAK_DAYS',
    category = 'streak',
    target_value = 7,
    reward_xp = 0,
    is_active = 1,
    template_kind = 'achievement',
    ui_json = '{"icon":"🌠","label":"업적","position_index":7,"legacy_key":"streak_7","display_order":7}'
WHERE code = 'streak_7';

INSERT INTO quest_campaign_items (campaign_id, template_id, sort_order)
SELECT qc.id, qt.id, 7
FROM quest_campaigns qc
JOIN quest_templates qt ON qt.code = 'streak_7'
WHERE qc.campaign_type = 'permanent'
  AND qc.name = '업적'
  AND NOT EXISTS (
    SELECT 1
    FROM quest_campaign_items qci
    WHERE qci.campaign_id = qc.id AND qci.template_id = qt.id
  );

INSERT OR IGNORE INTO quest_templates
  (name, description, condition_type, category, target_value, reward_xp, is_active, template_kind, code, ui_json)
VALUES
  ('숲의 주인', '30일 연속 글을 작성했습니다.', 'STREAK_DAYS', 'streak', 30, 0, 1, 'achievement', 'streak_30',
   '{"icon":"🏆","label":"업적","position_index":8,"legacy_key":"streak_30","display_order":8}');
UPDATE quest_templates
SET name = '숲의 주인',
    description = '30일 연속 글을 작성했습니다.',
    condition_type = 'STREAK_DAYS',
    category = 'streak',
    target_value = 30,
    reward_xp = 0,
    is_active = 1,
    template_kind = 'achievement',
    ui_json = '{"icon":"🏆","label":"업적","position_index":8,"legacy_key":"streak_30","display_order":8}'
WHERE code = 'streak_30';

INSERT INTO quest_campaign_items (campaign_id, template_id, sort_order)
SELECT qc.id, qt.id, 8
FROM quest_campaigns qc
JOIN quest_templates qt ON qt.code = 'streak_30'
WHERE qc.campaign_type = 'permanent'
  AND qc.name = '업적'
  AND NOT EXISTS (
    SELECT 1
    FROM quest_campaign_items qci
    WHERE qci.campaign_id = qc.id AND qci.template_id = qt.id
  );

INSERT OR IGNORE INTO quest_templates
  (name, description, condition_type, category, target_value, reward_xp, is_active, template_kind, code, ui_json)
VALUES
  ('첫 보금자리', '내 글이 처음으로 북마크되었습니다.', 'BOOKMARK_RECEIVED', 'bookmark', 1, 0, 1, 'achievement', 'first_bookmark',
   '{"icon":"📌","label":"업적","position_index":9,"legacy_key":"first_bookmark","display_order":9}');
UPDATE quest_templates
SET name = '첫 보금자리',
    description = '내 글이 처음으로 북마크되었습니다.',
    condition_type = 'BOOKMARK_RECEIVED',
    category = 'bookmark',
    target_value = 1,
    reward_xp = 0,
    is_active = 1,
    template_kind = 'achievement',
    ui_json = '{"icon":"📌","label":"업적","position_index":9,"legacy_key":"first_bookmark","display_order":9}'
WHERE code = 'first_bookmark';

INSERT INTO quest_campaign_items (campaign_id, template_id, sort_order)
SELECT qc.id, qt.id, 9
FROM quest_campaigns qc
JOIN quest_templates qt ON qt.code = 'first_bookmark'
WHERE qc.campaign_type = 'permanent'
  AND qc.name = '업적'
  AND NOT EXISTS (
    SELECT 1
    FROM quest_campaign_items qci
    WHERE qci.campaign_id = qc.id AND qci.template_id = qt.id
  );
