# Phase 4 Summary — Legacy achievements cleanup

## What changed
- Added SQL migration `0007_drop_legacy_achievements_tables.sql` to drop the legacy `achievements` and `user_achievements` tables in a safe order.
- Removed legacy achievements table creation and related index from `db.js` auto-init logic.
- Updated `docs/DB_SCHEMA.md` to reflect the canonical quest-based schema.
- Added a verification helper script (`scripts/verify_phase4.sh`) to confirm legacy tables are absent and quest tables exist.

## Why
Phase 3 moved achievements to `quest_templates` with `template_kind='achievement'`. The old `achievements` and `user_achievements` tables are no longer used at runtime and should be removed to avoid confusion and FK issues.

## Verification commands
```bash
# Run server migrations (should apply 0007 once)
node server.js

# Verify legacy tables are gone
sqlite3 data/live/users.db ".tables" | grep -E "achievements|user_achievements" || true

# Optional helper script
./scripts/verify_phase4.sh
```
