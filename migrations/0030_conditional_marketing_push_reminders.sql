ALTER TABLE marketing_push_campaigns ADD COLUMN campaign_key TEXT;
ALTER TABLE marketing_push_campaigns ADD COLUMN campaign_kind TEXT;
ALTER TABLE marketing_push_campaigns ADD COLUMN scheduled_for_date TEXT;
ALTER TABLE marketing_push_campaigns ADD COLUMN target_rule_json TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_push_campaigns_key
  ON marketing_push_campaigns(campaign_key)
  WHERE campaign_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_push_campaigns_kind_date
  ON marketing_push_campaigns(campaign_kind, scheduled_for_date);
