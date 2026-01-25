INSERT INTO quest_campaigns (name, description, campaign_type, is_active, priority, created_at)
SELECT '업적', '업적 캠페인', 'permanent', 1, 1, datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM quest_campaigns WHERE campaign_type = 'permanent' AND name = '업적'
);
