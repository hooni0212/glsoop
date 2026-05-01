ALTER TABLE push_delivery_queue ADD COLUMN next_attempt_at DATETIME;
ALTER TABLE push_delivery_queue ADD COLUMN locked_at DATETIME;
ALTER TABLE push_delivery_queue ADD COLUMN last_attempt_at DATETIME;
ALTER TABLE push_delivery_queue ADD COLUMN provider_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_push_delivery_queue_ready
  ON push_delivery_queue(status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_push_delivery_queue_locked
  ON push_delivery_queue(locked_at);
