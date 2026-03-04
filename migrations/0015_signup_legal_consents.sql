ALTER TABLE users ADD COLUMN marketing_email_opt_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN marketing_opt_in_updated_at DATETIME;

ALTER TABLE pending_signups ADD COLUMN age_confirmed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pending_signups ADD COLUMN terms_version TEXT;
ALTER TABLE pending_signups ADD COLUMN privacy_version TEXT;
ALTER TABLE pending_signups ADD COLUMN marketing_version TEXT;
ALTER TABLE pending_signups ADD COLUMN marketing_email_opt_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pending_signups ADD COLUMN consent_ip_hash TEXT;
ALTER TABLE pending_signups ADD COLUMN consent_user_agent TEXT;
ALTER TABLE pending_signups ADD COLUMN consent_recorded_at DATETIME NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';

UPDATE pending_signups
SET consent_recorded_at = CURRENT_TIMESTAMP
WHERE consent_recorded_at = '1970-01-01T00:00:00.000Z';

CREATE TABLE IF NOT EXISTS user_consent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  consent_type TEXT NOT NULL CHECK (consent_type IN ('terms', 'privacy', 'marketing')),
  consent_version TEXT NOT NULL,
  is_granted INTEGER NOT NULL CHECK (is_granted IN (0, 1)),
  source TEXT NOT NULL CHECK (source IN ('signup', 'mypage')),
  ip_hash TEXT,
  user_agent TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_consent_events_user_type_created
  ON user_consent_events(user_id, consent_type, created_at DESC);
