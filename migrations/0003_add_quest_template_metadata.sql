ALTER TABLE quest_templates ADD COLUMN template_kind TEXT NOT NULL DEFAULT 'quest';
ALTER TABLE quest_templates ADD COLUMN code TEXT;
ALTER TABLE quest_templates ADD COLUMN ui_json TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_quest_templates_code ON quest_templates(code) WHERE code IS NOT NULL;
