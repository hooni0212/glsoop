const db = require('../db');
const { normalizeDateFields } = require('./dateTime');

const ACCOUNT_STATUS_ACTIVE = 'active';
const ACCOUNT_STATUS_DEACTIVATED = 'deactivated';
const ACCOUNT_CLOSURE_CONFIRM_TEXT = 'DELETE';
const DEACTIVATION_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
const ANONYMOUS_AUTHOR_NAME = '익명';

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

function toIso(ms) {
  return new Date(ms).toISOString();
}

function toMs(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeAccountStatus(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return raw === ACCOUNT_STATUS_DEACTIVATED
    ? ACCOUNT_STATUS_DEACTIVATED
    : ACCOUNT_STATUS_ACTIVE;
}

function isDeactivatedAccount(value) {
  return normalizeAccountStatus(value) === ACCOUNT_STATUS_DEACTIVATED;
}

function isWithinDeactivationGracePeriod(row, nowMs = Date.now()) {
  if (!isDeactivatedAccount(row?.account_status)) return false;
  const purgeAtMs = toMs(row?.scheduled_purge_at);
  return Boolean(purgeAtMs && purgeAtMs > nowMs);
}

function normalizeTrimmedText(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function buildPublicDisplayName(nickname, accountStatus = ACCOUNT_STATUS_ACTIVE) {
  if (isDeactivatedAccount(accountStatus)) {
    return ANONYMOUS_AUTHOR_NAME;
  }

  const normalizedNickname = normalizeTrimmedText(nickname);
  return normalizedNickname || ANONYMOUS_AUTHOR_NAME;
}

function normalizePublicPostAuthor(row) {
  const normalizedRow = normalizeDateFields(row, ['created_at']);
  if (!normalizedRow) {
    return normalizedRow;
  }

  const hasAuthorAccountStatus = Object.prototype.hasOwnProperty.call(
    normalizedRow,
    'author_account_status'
  );
  const displayName = hasAuthorAccountStatus
    ? buildPublicDisplayName(
        normalizedRow.author_nickname,
        normalizedRow.author_account_status
      )
    : normalizeTrimmedText(normalizedRow.author_nickname) ||
      normalizeTrimmedText(normalizedRow.author_name) ||
      ANONYMOUS_AUTHOR_NAME;
  const normalizedNickname = hasAuthorAccountStatus
    ? displayName === ANONYMOUS_AUTHOR_NAME
      ? ANONYMOUS_AUTHOR_NAME
      : normalizeTrimmedText(normalizedRow.author_nickname) || ANONYMOUS_AUTHOR_NAME
    : normalizeTrimmedText(normalizedRow.author_nickname) || null;

  const nextRow = {
    ...normalizedRow,
    author_display_name: displayName,
    author_name: displayName,
    author_nickname: normalizedNickname,
    author_email: null,
  };

  if (hasAuthorAccountStatus && isDeactivatedAccount(normalizedRow.author_account_status)) {
    nextRow.author_id = null;
  }

  if (hasAuthorAccountStatus) {
    delete nextRow.author_account_status;
  }

  return nextRow;
}

async function getExistingTables() {
  const rows = await dbAll(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  );
  return new Set(rows.map((row) => row.name).filter(Boolean));
}

async function runIfTableExists(existingTables, tableName, sql, params = []) {
  if (!existingTables.has(tableName)) {
    return { changes: 0, skipped: true };
  }
  return dbRun(sql, params);
}

async function purgeUserAccount(userId, options = {}) {
  if (!userId) {
    return { deleted: false, changes: 0 };
  }

  const deletePosts = options.deletePosts !== false;
  const userRow = await dbGet(
    `
    SELECT id, email
    FROM users
    WHERE id = ?
    LIMIT 1
    `,
    [userId]
  );
  if (!userRow) {
    return { deleted: false, changes: 0 };
  }

  const existingTables = await getExistingTables();
  let changeCount = 0;

  await dbRun('BEGIN IMMEDIATE');
  try {
    const statements = [
      ['otp_verifications', 'DELETE FROM otp_verifications WHERE user_id = ?', [userId]],
      ['user_achievements', 'DELETE FROM user_achievements WHERE user_id = ?', [userId]],
      ['user_quest_state', 'DELETE FROM user_quest_state WHERE user_id = ?', [userId]],
      ['xp_log', 'DELETE FROM xp_log WHERE user_id = ?', [userId]],
      ['user_profile_cosmetics', 'DELETE FROM user_profile_cosmetics WHERE user_id = ?', [userId]],
      ['user_profile_backgrounds', 'DELETE FROM user_profile_backgrounds WHERE user_id = ?', [userId]],
      ['user_cosmetics', 'DELETE FROM user_cosmetics WHERE user_id = ?', [userId]],
      ['user_entitlements', 'DELETE FROM user_entitlements WHERE user_id = ?', [userId]],
      ['user_consent_events', 'DELETE FROM user_consent_events WHERE user_id = ?', [userId]],
      ['ux_events', 'DELETE FROM ux_events WHERE user_id = ?', [userId]],
      ['auth_sessions', 'DELETE FROM auth_sessions WHERE user_id = ?', [userId]],
      ['auth_login_state', 'DELETE FROM auth_login_state WHERE user_id = ?', [userId]],
      [
        'auth_login_events',
        'DELETE FROM auth_login_events WHERE user_id = ? OR email = ?',
        [userId, userRow.email || null],
      ],
      ['follows', 'DELETE FROM follows WHERE follower_id = ? OR followee_id = ?', [userId, userId]],
      ['likes', 'DELETE FROM likes WHERE user_id = ?', [userId]],
      ['bookmark_lists', 'DELETE FROM bookmark_lists WHERE user_id = ?', [userId]],
    ];

    for (const [tableName, sql, params] of statements) {
      const result = await runIfTableExists(existingTables, tableName, sql, params);
      changeCount += Number(result?.changes || 0);
    }

    if (deletePosts) {
      const likeCleanup = await runIfTableExists(
        existingTables,
        'likes',
        'DELETE FROM likes WHERE post_id IN (SELECT id FROM posts WHERE user_id = ?)',
        [userId]
      );
      changeCount += Number(likeCleanup?.changes || 0);

      const postCleanup = await runIfTableExists(
        existingTables,
        'posts',
        'DELETE FROM posts WHERE user_id = ?',
        [userId]
      );
      changeCount += Number(postCleanup?.changes || 0);
    }

    const userDelete = await runIfTableExists(
      existingTables,
      'users',
      'DELETE FROM users WHERE id = ?',
      [userId]
    );
    changeCount += Number(userDelete?.changes || 0);

    await dbRun('COMMIT');
  } catch (error) {
    try {
      await dbRun('ROLLBACK');
    } catch (rollbackError) {
      console.error('[accountLifecycle] rollback failed:', rollbackError);
    }
    throw error;
  }

  return { deleted: true, changes: changeCount };
}

async function deactivateUserAccount(userId, nowMs = Date.now()) {
  if (!userId) {
    return { deactivated: false, scheduledPurgeAt: null };
  }
  const deactivatedAt = toIso(nowMs);
  const scheduledPurgeAt = toIso(nowMs + DEACTIVATION_GRACE_MS);
  const result = await dbRun(
    `
    UPDATE users
    SET account_status = ?,
        deactivated_at = ?,
        scheduled_purge_at = ?
    WHERE id = ?
    `,
    [ACCOUNT_STATUS_DEACTIVATED, deactivatedAt, scheduledPurgeAt, userId]
  );

  return {
    deactivated: Number(result?.changes || 0) > 0,
    deactivatedAt,
    scheduledPurgeAt,
  };
}

async function restoreDeactivatedUserAccount(userId) {
  if (!userId) {
    return { restored: false };
  }
  const result = await dbRun(
    `
    UPDATE users
    SET account_status = ?,
        deactivated_at = NULL,
        scheduled_purge_at = NULL
    WHERE id = ?
    `,
    [ACCOUNT_STATUS_ACTIVE, userId]
  );
  return { restored: Number(result?.changes || 0) > 0 };
}

module.exports = {
  ACCOUNT_STATUS_ACTIVE,
  ACCOUNT_STATUS_DEACTIVATED,
  ACCOUNT_CLOSURE_CONFIRM_TEXT,
  DEACTIVATION_GRACE_MS,
  ANONYMOUS_AUTHOR_NAME,
  toIso,
  toMs,
  normalizeAccountStatus,
  isDeactivatedAccount,
  isWithinDeactivationGracePeriod,
  buildPublicDisplayName,
  normalizePublicPostAuthor,
  purgeUserAccount,
  deactivateUserAccount,
  restoreDeactivatedUserAccount,
};
