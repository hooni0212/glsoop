ALTER TABLE ux_events
  ADD COLUMN device_class TEXT NOT NULL DEFAULT 'unknown'
  CHECK (device_class IN ('desktop', 'mobile', 'tablet', 'unknown'));

ALTER TABLE ux_events
  ADD COLUMN platform_family TEXT NOT NULL DEFAULT 'unknown'
  CHECK (platform_family IN ('ios', 'android', 'windows', 'macos', 'linux', 'chromeos', 'unknown'));

CREATE INDEX IF NOT EXISTS idx_ux_events_device_created
  ON ux_events(device_class, created_at);

CREATE INDEX IF NOT EXISTS idx_ux_events_platform_created
  ON ux_events(platform_family, created_at);
