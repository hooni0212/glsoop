CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  applied_at DATETIME NOT NULL DEFAULT (datetime('now'))
);
