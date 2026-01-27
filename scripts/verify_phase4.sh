#!/usr/bin/env bash

set -euo pipefail

DB_PATH="${DB_PATH:-data/live/users.db}"

if [ ! -f "$DB_PATH" ]; then
  echo "[phase4 verify] DB not found at $DB_PATH. Skipping verification."
  exit 0
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "[phase4 verify] sqlite3 not available in PATH."
  exit 1
fi

echo "[phase4 verify] tables in $DB_PATH"

LEGACY_TABLES=$(sqlite3 "$DB_PATH" ".tables" | tr ' ' '\n' | grep -E '^(achievements|user_achievements)$' || true)
if [ -n "$LEGACY_TABLES" ]; then
  echo "[phase4 verify] legacy tables still present:"
  echo "$LEGACY_TABLES"
else
  echo "[phase4 verify] legacy achievements tables: OK (absent)"
fi

REQUIRED_TABLES=(quest_templates quest_campaigns quest_campaign_items user_quest_state)
for table in "${REQUIRED_TABLES[@]}"; do
  if sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'" | grep -q "${table}"; then
    echo "[phase4 verify] ${table}: OK"
  else
    echo "[phase4 verify] ${table}: MISSING"
  fi
 done
