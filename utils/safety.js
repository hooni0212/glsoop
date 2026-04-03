const { buildPublicDisplayName } = require('./accountLifecycle');
const { allAsync, getAsync, runAsync } = require('./questService');

const SAFETY_MODERATION_SLA_HOURS = 24;
const REPORT_SOURCE_REPORT = 'report';
const REPORT_SOURCE_BLOCK = 'block';
const REPORT_STATUS_QUEUED = 'queued';
const REPORT_DETAIL_MAX_LENGTH = 200;
const SAFETY_VALIDATION_ERROR = 'SAFETY_VALIDATION_ERROR';

const REPORT_REASON_DEFINITIONS = Object.freeze([
  { code: 'harassment', label: '괴롭힘/비방', targetTypes: ['post', 'user'] },
  { code: 'hate', label: '혐오/차별', targetTypes: ['post', 'user'] },
  { code: 'sexual', label: '선정성/음란성', targetTypes: ['post', 'user'] },
  { code: 'violence', label: '폭력성/자해/위협', targetTypes: ['post', 'user'] },
  { code: 'spam', label: '광고/스팸', targetTypes: ['post', 'user'] },
  { code: 'impersonation', label: '사칭/도용', targetTypes: ['post', 'user'] },
  { code: 'other', label: '기타', targetTypes: ['post', 'user'] },
]);

const REPORT_REASON_MAP = new Map(
  REPORT_REASON_DEFINITIONS.map((definition) => [definition.code, definition])
);

function normalizeReasonCode(raw, fallback = 'other') {
  if (typeof raw !== 'string') {
    return fallback === undefined ? 'other' : fallback;
  }
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return fallback === undefined ? 'other' : fallback;
  }
  return REPORT_REASON_MAP.has(trimmed) ? trimmed : fallback;
}

function normalizeOptionalDetail(raw, maxLength = 1000) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function createSafetyValidationError(code, message) {
  const error = new Error(message);
  error.name = SAFETY_VALIDATION_ERROR;
  error.code = code;
  error.status = 400;
  return error;
}

function isSafetyValidationError(error) {
  return (
    error?.name === SAFETY_VALIDATION_ERROR ||
    (Number(error?.status) === 400 && typeof error?.code === 'string')
  );
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
    report_detail_max_length: REPORT_DETAIL_MAX_LENGTH,
    report_detail_required_reason_codes: ['other'],
    report_reasons: buildPublicSafetyReasonDefinitions(),
  };
}

function normalizeSafetyReasonPayload(
  { reasonCode, detail } = {},
  { defaultReasonCode = 'other', detailMaxLength = REPORT_DETAIL_MAX_LENGTH } = {}
) {
  const normalizedDefaultReasonCode = normalizeReasonCode(defaultReasonCode, null);
  const rawReasonCode = typeof reasonCode === 'string' ? reasonCode.trim().toLowerCase() : '';
  const shouldUseDefaultReasonCode = !rawReasonCode;
  const normalizedReasonCode = shouldUseDefaultReasonCode
    ? normalizedDefaultReasonCode
    : normalizeReasonCode(rawReasonCode, null);

  if (!normalizedReasonCode) {
    throw createSafetyValidationError(
      'INVALID_REASON_CODE',
      '허용되지 않는 신고 사유입니다.'
    );
  }

  if (normalizedReasonCode !== 'other') {
    return {
      reasonCode: normalizedReasonCode,
      detail: null,
    };
  }

  if (typeof detail !== 'string') {
    throw createSafetyValidationError(
      'DETAIL_REQUIRED',
      `기타 사유를 선택한 경우 1자 이상 ${detailMaxLength}자 이하의 상세 설명을 입력해주세요.`
    );
  }

  const trimmedDetail = detail.trim();
  if (!trimmedDetail) {
    throw createSafetyValidationError(
      'DETAIL_REQUIRED',
      `기타 사유를 선택한 경우 1자 이상 ${detailMaxLength}자 이하의 상세 설명을 입력해주세요.`
    );
  }
  if (trimmedDetail.length > detailMaxLength) {
    throw createSafetyValidationError(
      'DETAIL_TOO_LONG',
      `상세 설명은 ${detailMaxLength}자 이하로 입력해주세요.`
    );
  }

  return {
    reasonCode: normalizedReasonCode,
    detail: trimmedDetail,
  };
}

function parseSafetyRequestPayload(
  body = {},
  { defaultReasonCode = 'other', allowContextPostId = false } = {}
) {
  const normalized = normalizeSafetyReasonPayload(
    {
      reasonCode: body?.reason_code,
      detail: body?.detail,
    },
    { defaultReasonCode }
  );

  return {
    ...normalized,
    contextPostId: allowContextPostId ? toPositiveInt(body?.context_post_id) : null,
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
  const normalizedPayload = normalizeSafetyReasonPayload(
    { reasonCode, detail },
    { defaultReasonCode: 'other' }
  );
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
      normalizedPayload.reasonCode,
      normalizedPayload.detail,
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
      reason_code: normalizedPayload.reasonCode,
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
  const normalizedPayload = normalizeSafetyReasonPayload(
    { reasonCode, detail },
    { defaultReasonCode: 'harassment' }
  );
  const normalizedContextPostId = toPositiveInt(contextPostId);

  if (!normalizedBlockerId || !normalizedBlockedUserId) {
    throw new Error('invalid_block_request');
  }

  await runAsync('BEGIN IMMEDIATE TRANSACTION');

  try {
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
        normalizedPayload.reasonCode,
        normalizedPayload.detail,
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

    const created = Number(insertResult?.changes || 0) > 0;
    const report = created
      ? await createSafetyReport({
          reporterId: normalizedBlockerId,
          targetType: 'user',
          targetPostId: normalizedContextPostId,
          targetUserId: normalizedBlockedUserId,
          reasonCode: normalizedPayload.reasonCode,
          detail: normalizedPayload.detail,
          source: REPORT_SOURCE_BLOCK,
        })
      : null;

    await runAsync('COMMIT');

    return {
      created,
      block: blockRow || null,
      hidden_post_count: Number(postCountRow?.count || 0),
      report,
      context_post_id: normalizedContextPostId,
    };
  } catch (error) {
    await runAsync('ROLLBACK');
    throw error;
  }
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

function normalizeSafetySources(sources) {
  const values = Array.isArray(sources) ? sources : [sources];
  const normalized = values
    .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
    .filter((value) => value === REPORT_SOURCE_REPORT || value === REPORT_SOURCE_BLOCK);

  return normalized.length ? [...new Set(normalized)] : [REPORT_SOURCE_REPORT];
}

async function listSafetyReports({
  status = null,
  limit = 50,
  offset = 0,
  sources = [REPORT_SOURCE_REPORT],
} = {}) {
  const params = [];
  const conditions = [];
  const normalizedSources = normalizeSafetySources(sources);

  conditions.push(`sr.source IN (${normalizedSources.map(() => '?').join(', ')})`);
  params.push(...normalizedSources);

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
      COALESCE(reporter.account_status, 'active') AS reporter_account_status,
      target_user.nickname AS target_user_nickname,
      COALESCE(target_user.account_status, 'active') AS target_user_account_status,
      handled_by.nickname AS handled_by_nickname,
      COALESCE(handled_by.account_status, 'active') AS handled_by_account_status,
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
  ).then((rows) =>
    rows.map((row) => ({
      ...row,
      created_at: toIsoStringOrNull(row.created_at) || row.created_at || null,
      handled_at: toIsoStringOrNull(row.handled_at) || row.handled_at || null,
      reporter_display_name: buildPublicDisplayName(
        row.reporter_nickname,
        row.reporter_account_status
      ),
      target_user_display_name: buildPublicDisplayName(
        row.target_user_nickname,
        row.target_user_account_status
      ),
      handled_by_display_name: buildPublicDisplayName(
        row.handled_by_nickname,
        row.handled_by_account_status
      ),
    }))
  );
}

async function listReportedPosts({
  threshold = 5,
  limit = 50,
  offset = 0,
  excludeDismissed = true,
} = {}) {
  const normalizedThreshold = Math.max(1, Number(threshold) || 5);
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  const normalizedOffset = Math.max(0, Number(offset) || 0);
  const params = [REPORT_SOURCE_REPORT];
  const dismissedClause = excludeDismissed ? "AND sr.status != 'dismissed'" : '';

  const rows = await allAsync(
    `
    SELECT
      sr.target_post_id,
      p.title AS target_post_title,
      sr.target_user_id,
      target_user.nickname AS target_user_nickname,
      COALESCE(target_user.account_status, 'active') AS target_user_account_status,
      COUNT(*) AS report_count,
      COUNT(DISTINCT sr.reporter_id) AS unique_reporter_count,
      MAX(sr.created_at) AS latest_reported_at
    FROM safety_reports sr
    LEFT JOIN posts p ON p.id = sr.target_post_id
    LEFT JOIN users target_user ON target_user.id = sr.target_user_id
    WHERE sr.source = ?
      AND sr.target_type = 'post'
      AND sr.target_post_id IS NOT NULL
      ${dismissedClause}
    GROUP BY
      sr.target_post_id,
      p.title,
      sr.target_user_id,
      target_user.nickname,
      target_user.account_status
    HAVING COUNT(*) >= ?
    ORDER BY
      unique_reporter_count DESC,
      report_count DESC,
      latest_reported_at DESC
    LIMIT ? OFFSET ?
    `,
    [...params, normalizedThreshold, normalizedLimit, normalizedOffset]
  );

  return rows.map((row) => ({
    target_post_id: row.target_post_id,
    target_post_title: row.target_post_title || null,
    target_user_id: row.target_user_id,
    target_user_display_name: buildPublicDisplayName(
      row.target_user_nickname,
      row.target_user_account_status
    ),
    target_user_nickname:
      typeof row?.target_user_nickname === 'string' && row.target_user_nickname.trim()
        ? row.target_user_nickname.trim()
        : null,
    report_count: Number(row.report_count || 0),
    unique_reporter_count: Number(row.unique_reporter_count || 0),
    latest_reported_at:
      toIsoStringOrNull(row.latest_reported_at) || row.latest_reported_at || null,
  }));
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
  REPORT_DETAIL_MAX_LENGTH,
  buildSafetyRuntimeConfig,
  buildPublicSafetyReasonDefinitions,
  createSafetyValidationError,
  isSafetyValidationError,
  normalizeReasonCode,
  normalizeOptionalDetail,
  normalizeSafetyReasonPayload,
  parseSafetyRequestPayload,
  appendViewerBlockedAuthorCondition,
  isUserBlockedByViewer,
  getActiveUserSummary,
  getPostSafetySummary,
  createSafetyReport,
  blockUser,
  unblockUser,
  listBlockedUsers,
  listSafetyReports,
  listReportedPosts,
  resolveSafetyReport,
};
