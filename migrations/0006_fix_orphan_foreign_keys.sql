-- Phase 2 hotfix: clean up legacy orphan rows that violate foreign keys.
--
-- Why: older data may have been inserted/modified while PRAGMA foreign_keys was OFF.
-- Once foreign key enforcement is enabled, some deletes/inserts can start failing.
--
-- This migration is safe to run multiple times (idempotent): it only deletes rows
-- that reference missing parent rows.

-- 1) Orphan children referencing missing posts
DELETE FROM post_hashtags
WHERE post_id NOT IN (SELECT id FROM posts);

DELETE FROM likes
WHERE post_id NOT IN (SELECT id FROM posts);

-- 2) Posts referencing missing users (and any non-cascading children for those posts)
-- NOTE: likes do NOT have ON DELETE CASCADE in the legacy schema, so delete them first.
DELETE FROM likes
WHERE post_id IN (
  SELECT p.id
  FROM posts p
  LEFT JOIN users u ON u.id = p.user_id
  WHERE u.id IS NULL
);

DELETE FROM post_hashtags
WHERE post_id IN (
  SELECT p.id
  FROM posts p
  LEFT JOIN users u ON u.id = p.user_id
  WHERE u.id IS NULL
);

DELETE FROM posts
WHERE id IN (
  SELECT p.id
  FROM posts p
  LEFT JOIN users u ON u.id = p.user_id
  WHERE u.id IS NULL
);
