CREATE INDEX IF NOT EXISTS idx_safety_reports_source_target_status_created
  ON safety_reports(source, target_type, status, target_post_id, created_at DESC);
