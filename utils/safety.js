const { buildPublicDisplayName } = require('./accountLifecycle');
const { allAsync, getAsync, runAsync } = require('./questService');

const SAFETY_MODERATION_SLA_HOURS = 24;
const REPORT_SOURCE_REPORT = 'report';
const REPORT_SOURCE_BLOCK = 'block';
const REPORT_STATUS_QUEUED = 'queued';

const REPORT_REASON_DEFINITIONS = Object.freeze([
  { code: 'harassment', label: '괴롭힘/비방', targetTypes: ['post', 'user'] },
  { code: 'hate', label: '혐오/차별 표현', targetTypes: ['post', 'user'] },
  { code: 'sexual', label: '성적이거나 부적절한 내용', targetTypes: ['post', 'user'] },
  { code: 'violence', label: '폭력/자해 조장', targetTypes: ['post', 'user'] },
  { code: 'illegal', label: '불법/위험 행위', targetTypes: ['post', 'user'] },
  { code: 'spam', label: '광고/스팸', targetTypes: ['post', 'user'] },
  { code: 'impersonation', label: '사칭/도용', targetTypes: ['user'] },
  { code: 'other', label: '기타', targetTypes: ['post', 'user'] },
]);

const REPORT_REASON_MAP = new Map(
  REPORT_REASON_DEFINITIONS.map((definition) => [definition.code, definition])
);

function normalizeReasonCode(raw, fallback = 'other') {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim().toLowerCase();
  return REPORT_REASON_MAP.has(trimmed) ? trimmed : fallback;
}

function normalizeOptionalDetail(raw, maxLength = 1000) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function toPositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toIsoStringOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildPublicSafetyReasonDefinitions() {
  return REPORT_REASON_DEFINITIONS.map((definition) => ({
    code: definition.code,
    label: definition.label,
    target_types: [...definition.targetTypes],
  }));
}

function buildSafetyRuntimeConfig() {
  return {
    report_enabled: true,
    block_enabled: true,
    moderation_sla_hours: SAFETY_MODERATION_SLA_HOURS,
    report_reasons: buildPublicSafetyReasonDefinitions(),
  };
}

function appendViewerBlockedAuthorCondition(conditions, params, viewerId, authorColumn = 'p.user_id') {
  if (!viewerId) return;
  conditions.push(
    `NOT EXISTS (
      SELECT 1
      FROM user_blocks ub
      WHERE ub.blocker_id = ?
        AND ub.blocked_user_id = ${authorColumn}
    )`
  );
  params.push(viewerId);
}

async function isUserBlockedByViewer(viewerId, targetUserId) {
  if (!viewerId || !targetUserId) return false;
  const row = await getAsync(
    'SELECT 1 AS present FROM user_blocks WHERE blocker_id = ? AND blocked_user_id = ? LIMIT 1',
    [viewerId, targetUserId]
  );
  return Boolean(row?.present);
}

async function getActiveUserSummary(userId) {
  const parsedUserId = toPositiveInt(userId);
  if (!parsedUserId) return null;

  return getAsync(
    `
    SELECT
      id,
      nickname,
      COALESCE(account_status, 'active') AS account_status
    FROM users
    WHERE id = ?
      AND COALESCE(account_status, 'active') = 'active'
    LIMIT 1
    `,
    [parsedUserId]
  );
}

async function getPostSafetySummary(postId) {
  const parsedPostId = toPositiveInt(postId);
  if (!parsedPostId) return null;

  return getAsync(
    `
    SELECT
      p.id,
      p.user_id AS author_id,
      p.title,
      u.nickname AS author_nickname,
      COALESCE(u.account_status, 'active') AS author_account_status
    FROM posts p
    JOIN users u ON u.id = p.user_id
    WHERE p.id = ?
    LIMIT 1
    `,
    [parsedPostId]
  );
}

async function createSafetyReport({
  reporterId,
  targetType,
  targetPostId = null,
  targetUserId = null,
  reasonCode,
  detail = null,
  source = REPORT_SOURCE_REPORT,
}) {
  const normalizedReasonCode = normalizeReasonCode(reasonCode);
  const normalizedDetail = normalizeOptionalDetail(detail);
  const normalizedTargetType = targetType === 'user' ? 'user' : 'post';
  const normalizedTargetPostId = toPositiveInt(targetPostId);
  const normalizedTargetUserId = toPositiveInt(targetUserId);
  const normalizedReporterId = toPositiveInt(reporterId);
  const normalizedSource = source === REPORT_SOURCE_BLOCK ? REPORT_SOURCE_BLOCK : REPORT_SOURCE_REPORT;

  const result = await runAsync(
    `
    INSERT INTO safety_reports (
      reporter_id,
      target_type,
      target_post_id,
      target_user_id,
      source,
      reason_code,
      detail,
      status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      normalizedReporterId,
      normalizedTargetType,
      normalizedTargetPostId,
      normalizedTargetUserId,
      normalizedSource,
      normalizedReasonCode,
      normalizedDetail,
      REPORT_STATUS_QUEUED,
    ]
  );

  const report = await getAsync('SELECT * FROM safety_reports WHERE id = ?', [result?.lastID || 0]);

  console.info(
    '[safety] report queued',
    JSON.stringify({
      report_id: report?.id || null,
      reporter_id: normalizedReporterId,
      target_type: normalizedTargetType,
      target_post_id: normalizedTargetPostId,
      target_user_id: normalizedTargetUserId,
      source: normalizedSource,
      reason_code: normalizedReasonCode,
      created_at: report?.created_at || null,
    })
  );

  return report;
}

async function blockUser({
  blockerId,
  blockedUserId,
  reasonCode = 'harassment',
  detail = null,
  contextPostId = null,
}) {
  const normalizedBlockerId = toPositiveInt(blockerId);
  const normalizedBlockedUserId = toPositiveInt(blockedUserId);
  const normalizedReasonCode = normalizeReasonCode(reasonCode, 'harassment');
  const normalizedDetail = normalizeOptionalDetail(detail);
  const normalizedContextPostId = toPositiveInt(contextPostId);

  if (!normalizedBlockerId || !normalizedBlockedUserId) {
    throw new Error('invalid_block_request');
  }

  const insertResult = await runAsync(
    `
    INSERT OR IGNORE INTO user_blocks (
      blocker_id,
      blocked_user_id,
      reason_code,
      detail
    )
    VALUES (?, ?, ?, ?)
    `,
    [
      normalizedBlockerId,
      normalizedBlockedUserId,
      normalizedReasonCode,
      normalizedDetail,
    ]
  );

  const blockRow = await getAsync(
    `
    SELECT blocker_id, blocked_user_id, reason_code, detail, created_at
    FROM user_blocks
    WHERE blocker_id = ? AND blocked_user_id = ?
    LIMIT 1
    `,
    [normalizedBlockerId, normalizedBlockedUserId]
  );

  const postCountRow = await getAsync(
    'SELECT COUNT(*) AS count FROM posts WHERE user_id = ?',
    [normalizedBlockedUserId]
  );

  return {
    created: Number(insertResult?.changes || 0) > 0,
    block: blockRow || null,
    hidden_post_count: Number(postCountRow?.count || 0),
    report: await createSafetyReport({
      reporterId: normalizedBlockerId,
      targetType: 'user',
      targetPostId: normalizedContextPostId,
      targetUserId: normalizedBlockedUserId,
      reasonCode: normalizedReasonCode,
      detail: normalizedDetail,
      source: REPORT_SOURCE_BLOCK,
    }),
  };
}

async function unblockUser({ blockerId, blockedUserId }) {
  const normalizedBlockerId = toPositiveInt(blockerId);
  const normalizedBlockedUserId = toPositiveInt(blockedUserId);
  if (!normalizedBlockerId || !normalizedBlockedUserId) {
    throw new Error('invalid_unblock_request');
  }

  const result = await runAsync(
    'DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_user_id = ?',
    [normalizedBlockerId, normalizedBlockedUserId]
  );

  return {
    removed: Number(result?.changes || 0) > 0,
  };
}

async function listBlockedUsers(blockerId) {
  const normalizedBlockerId = toPositiveInt(blockerId);
  if (!normalizedBlockerId) return [];

  const rows = await allAsync(
    `
    SELECT
      ub.blocked_user_id AS user_id,
      ub.reason_code,
      ub.detail,
      ub.created_at,
      u.nickname,
      COALESCE(u.account_status, 'active') AS account_status
    FROM user_blocks ub
    LEFT JOIN users u ON u.id = ub.blocked_user_id
    WHERE ub.blocker_id = ?
    ORDER BY ub.created_at DESC
    `,
    [normalizedBlockerId]
  );

  return rows.map((row) => ({
    user_id: row.user_id,
    reason_code: row.reason_code,
    detail: row.detail || null,
    created_at: toIsoStringOrNull(row.created_at) || row.created_at || null,
    display_name: buildPublicDisplayName(row.nickname, row.account_status),
    nickname: typeof row?.nickname === 'string' && row.nickname.trim() ? row.nickname.trim() : null,
  }));
}

async function listSafetyReports({ status = null, limit = 50, offset = 0 } = {}) {
  const params = [];
  const conditions = [];

  if (typeof status === 'string' && status.trim()) {
    conditions.push('sr.status = ?');
    params.push(status.trim().toLowerCase());
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  const normalizedOffset = Math.max(0, Number(offset) || 0);

  return allAsync(
    `
    SELECT
      sr.*,
      reporter.nickname AS reporter_nickname,
      target_user.nickname AS target_user_nickname,
      COALESCE(target_user.account_status, 'active') AS target_user_account_status,
      handled_by.nickname AS handled_by_nickname,
      p.title AS target_post_title
    FROM safety_reports sr
    LEFT JOIN users reporter ON reporter.id = sr.reporter_id
    LEFT JOIN users target_user ON target_user.id = sr.target_user_id
    LEFT JOIN users handled_by ON handled_by.id = sr.handled_by_user_id
    LEFT JOIN posts p ON p.id = sr.target_post_id
    ${whereClause}
    ORDER BY sr.created_at DESC, sr.id DESC
    LIMIT ? OFFSET ?
    `,
    [...params, normalizedLimit, normalizedOffset]
  );
}

async function resolveSafetyReport({
  reportId,
  status,
  action = null,
  actionDetail = null,
  handledByUserId,
}) {
  const normalizedReportId = toPositiveInt(reportId);
  const normalizedHandledByUserId = toPositiveInt(handledByUserId);
  const normalizedStatus =
    typeof status === 'string' && ['reviewing', 'actioned', 'dismissed'].includes(status.trim().toLowerCase())
      ? status.trim().toLowerCase()
      : null;
  const normalizedAction =
    typeof action === 'string' && action.trim()
      ? action.trim().toLowerCase().slice(0, 80)
      : null;
  const normalizedActionDetail = normalizeOptionalDetail(actionDetail, 500);

  if (!normalizedReportId || !normalizedHandledByUserId || !normalizedStatus) {
    throw new Error('invalid_report_resolution');
  }

  await runAsync(
    `
    UPDATE safety_reports
    SET status = ?,
        action = ?,
        action_detail = ?,
        handled_by_user_id = ?,
        handled_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [
      normalizedStatus,
      normalizedAction,
      normalizedActionDetail,
      normalizedHandledByUserId,
      normalizedReportId,
    ]
  );

  return getAsync('SELECT * FROM safety_reports WHERE id = ? LIMIT 1', [normalizedReportId]);
}

module.exports = {
  SAFETY_MODERATION_SLA_HOURS,
  buildSafetyRuntimeConfig,
  buildPublicSafetyReasonDefinitions,
  normalizeReasonCode,
  normalizeOptionalDetail,
  appendViewerBlockedAuthorCondition,
  isUserBlockedByViewer,
  getActiveUserSummary,
  getPostSafetySummary,
  createSafetyReport,
  blockUser,
  unblockUser,
  listBlockedUsers,
  listSafetyReports,
  resolveSafetyReport,
};
