INSERT OR IGNORE INTO cosmetic_items (type, key, name, rarity, season, icon_emoji, meta_json, is_active)
VALUES
  (
    'badge',
    'badge_summer_2026',
    '2026 여름 배지',
    'rare',
    '2026_summer',
    '☀️',
    '{"source":"season_campaign_reward"}',
    1
  ),
  (
    'badge',
    'badge_autumn_2026',
    '2026 가을 배지',
    'rare',
    '2026_autumn',
    '🍂',
    '{"source":"season_campaign_reward"}',
    1
  );

UPDATE cosmetic_items
SET meta_json = '{"source":"season_campaign_reward"}'
WHERE key IN ('badge_spring_2026', 'badge_winter_2026')
  AND (meta_json IS NULL OR TRIM(meta_json) = '');
