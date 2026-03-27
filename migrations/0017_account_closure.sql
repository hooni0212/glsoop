ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'deactivated'));
ALTER TABLE users ADD COLUMN deactivated_at DATETIME;
ALTER TABLE users ADD COLUMN scheduled_purge_at DATETIME;

UPDATE users
SET account_status = COALESCE(NULLIF(TRIM(account_status), ''), 'active')
WHERE account_status IS NULL OR TRIM(account_status) = '';
