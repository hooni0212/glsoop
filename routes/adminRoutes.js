const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { authRequired, adminRequired } = require('../middleware/auth');
const { allAsync, getAsync, runAsync } = require('../utils/questService');
const {
  mergeMonetizationRawJson,
  normalizePurchaseStatus,
  reconcileMonetizationState,
} = require('../utils/monetizationState');
const { getEffectiveEntitlement } = require('../utils/entitlements');
const { purgeUserAccount } = require('../utils/accountLifecycle');
const {
  listReportedPosts,
  listSafetyReports,
  resolveSafetyReport,
  resolveSafetyReportsForPost,
} = require('../utils/safety');
const { autoClaimExpiredQuestRewards } = require('../utils/questRewardClaimService');
const {
  createAdminOperationalAlert,
  mapOperationalAlert,
} = require('../utils/adminOperationalAlerts');
const {
  DAILY_WRITING_CAMPAIGN_KEY,
  DAILY_WRITING_PROMPTS,
  getDailyWritingCampaignProgressSteps,
  getDailyWritingCampaignStatus,
  getWritingEventDefinition,
  getWritingEventProgressSteps,
  getWritingEventStatus,
} = require('../utils/dailyWritingCampaign');

const router = express.Router();

function normalizeAdminPassword(body = {}) {
  const value = body.admin_password ?? body.adminPassword ?? body.password;
  return typeof value === 'string' ? value : '';
}

function normalizeWritingEventKey(input) {
  const value = typeof input === 'string' ? input.trim() : '';
  return value.slice(0, 160);
}

function buildWritingEventAdminPayload(status, prompts, message) {
  return {
    ok: true,
    message,
    campaign: {
      key: status.campaignKey,
      title: status.title,
      subtitle: status.subtitle,
      total_days: status.totalDays,
      current_day: status.currentDay,
      completed_days: status.completedDays,
      remaining_days: status.remainingDays,
      progress_percent: status.progressPercent,
      local_date_key: status.localDateKey,
      write_path: status.writePath,
    },
    today_prompt: {
      ...status.prompt,
      write_path: status.writePath,
    },
    prompts,
    progress_steps: getWritingEventProgressSteps(status),
    push_preset: {
      title: `${status.currentDay}일차 오늘의 글감이 열렸어요`,
      body: `${status.prompt.title} - ${status.prompt.body}`,
      target_path: status.writePath,
      include_ad_label: false,
      campaign_kind: status.pushCampaignKind || 'writing_event_prompt',
      campaign_key: `${status.campaignKey}:${status.localDateKey}`,
      scheduled_for_date: status.localDateKey,
    },
  };
}

async function deletePostReferences(postId) {
  await runAsync(
    `
    DELETE FROM push_delivery_queue
    WHERE activity_event_id IN (
      SELECT id
      FROM activity_events
      WHERE post_id = ?
         OR comment_id IN (SELECT id FROM comments WHERE post_id = ?)
         OR parent_comment_id IN (SELECT id FROM comments WHERE post_id = ?)
    )
    `,
    [postId, postId, postId]
  );
  await runAsync(
    `
    DELETE FROM activity_events
    WHERE post_id = ?
       OR comment_id IN (SELECT id FROM comments WHERE post_id = ?)
       OR parent_comment_id IN (SELECT id FROM comments WHERE post_id = ?)
    `,
    [postId, postId, postId]
  );
  await runAsync(
    'DELETE FROM comment_likes WHERE comment_id IN (SELECT id FROM comments WHERE post_id = ?)',
    [postId]
  );
  await runAsync('DELETE FROM comments WHERE post_id = ?', [postId]);

  await runAsync('DELETE FROM likes WHERE post_id = ?', [postId]);
  await runAsync('DELETE FROM bookmark_items WHERE post_id = ?', [postId]);
  await runAsync('DELETE FROM post_hashtags WHERE post_id = ?', [postId]);
  await runAsync('DELETE FROM post_genres WHERE post_id = ?', [postId]);
  await runAsync('DELETE FROM quest_post_submissions WHERE post_id = ?', [postId]);
  await runAsync('DELETE FROM post_writing_event_contexts WHERE post_id = ?', [postId]);

  await runAsync('UPDATE share_events SET post_id = NULL WHERE post_id = ?', [postId]);
  await runAsync('UPDATE safety_reports SET target_post_id = NULL WHERE target_post_id = ?', [postId]);
  await runAsync('UPDATE feed_events SET post_id = NULL WHERE post_id = ?', [postId]);
  await runAsync('UPDATE photo_save_ad_rewards SET post_id = NULL WHERE post_id = ?', [postId]);
  await runAsync('UPDATE photo_save_events SET post_id = NULL WHERE post_id = ?', [postId]);
}

async function deleteAdminPost(postId) {
  await runAsync('BEGIN IMMEDIATE');

  try {
    const post = await getAsync(
      `
      SELECT
        p.id,
        p.title,
        p.user_id,
        u.nickname AS author_nickname
      FROM posts p
      LEFT JOIN users u ON u.id = p.user_id
      WHERE p.id = ?
      LIMIT 1
      `,
      [postId]
    );

    if (!post) {
      await runAsync('ROLLBACK');
      return null;
    }

    await deletePostReferences(postId);

    const deleted = await runAsync('DELETE FROM posts WHERE id = ?', [postId]);
    if (Number(deleted?.changes || 0) === 0) {
      await runAsync('ROLLBACK');
      return null;
    }

    await runAsync('COMMIT');
    return { post, deleted: true };
  } catch (error) {
    try {
      await runAsync('ROLLBACK');
    } catch (rollbackError) {
      console.error('[admin/posts/delete] rollback failed:', rollbackError);
    }
    throw error;
  }
}

async function verifyAdminPasswordForDangerAction(req, res) {
  const adminPassword = normalizeAdminPassword(req.body);
  if (!adminPassword.trim()) {
    res.status(400).json({
      ok: false,
      code: 'ADMIN_PASSWORD_REQUIRED',
      message: '관리자 비밀번호를 입력해주세요.',
    });
    return false;
  }

  const adminUser = await getAsync('SELECT id, pw, is_admin FROM users WHERE id = ? LIMIT 1', [
    req.user?.id,
  ]);

  if (!adminUser || Number(adminUser.is_admin) !== 1 || typeof adminUser.pw !== 'string') {
    res.status(403).json({
      ok: false,
      code: 'ADMIN_PASSWORD_FORBIDDEN',
      message: '관리자 권한을 확인할 수 없습니다.',
    });
    return false;
  }

  const passwordMatched = await bcrypt.compare(adminPassword, adminUser.pw);
  if (!passwordMatched) {
    res.status(403).json({
      ok: false,
      code: 'ADMIN_PASSWORD_INVALID',
      message: '관리자 비밀번호가 일치하지 않습니다.',
    });
    return false;
  }

  return true;
}

async function ensureAchievementCampaign() {
  const existing = await getAsync(
    "SELECT id FROM quest_campaigns WHERE LOWER(campaign_type) = 'permanent' AND name = '업적' LIMIT 1"
  );
  if (existing) return existing.id;
  const result = await runAsync(
    `INSERT INTO quest_campaigns (name, description, campaign_type, is_active, priority)
     VALUES (?, ?, ?, ?, ?)`,
    ['업적', '업적 캠페인', 'permanent', 1, 1]
  );
  return result?.lastID || null;
}

async function getAchievementCampaignId() {
  const existing = await getAsync(
    "SELECT id FROM quest_campaigns WHERE LOWER(campaign_type) = 'permanent' AND name = '업적' LIMIT 1"
  );
  return existing?.id || null;
}

async function ensureCampaignItem(campaignId, templateId) {
  if (!campaignId || !templateId) return;
  const existing = await getAsync(
    'SELECT id FROM quest_campaign_items WHERE campaign_id = ? AND template_id = ? LIMIT 1',
    [campaignId, templateId]
  );
  if (existing) return;
  const orderRow = await getAsync(
    'SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM quest_campaign_items WHERE campaign_id = ?',
    [campaignId]
  );
  const nextOrder = (orderRow?.max_sort || 0) + 1;
  await runAsync(
    'INSERT INTO quest_campaign_items (campaign_id, template_id, sort_order) VALUES (?, ?, ?)',
    [campaignId, templateId, nextOrder]
  );
}

async function backfillAchievementTemplate(campaignId, templateId) {
  if (!campaignId || !templateId) return { changes: 0 };
  return runAsync(
    `INSERT OR IGNORE INTO user_quest_state
      (user_id, campaign_id, template_id, progress, reset_key)
     SELECT u.id, ?, ?, 0, 'permanent'
     FROM users u`,
    [campaignId, templateId]
  );
}

async function backfillAllAchievements(campaignId) {
  if (!campaignId) return { changes: 0 };
  return runAsync(
    `INSERT OR IGNORE INTO user_quest_state
      (user_id, campaign_id, template_id, progress, reset_key)
     SELECT u.id, ?, qci.template_id, 0, 'permanent'
     FROM users u
     JOIN quest_campaign_items qci ON qci.campaign_id = ?
     JOIN quest_templates qt ON qt.id = qci.template_id
     WHERE qt.template_kind = 'achievement' AND qt.is_active = 1`,
    [campaignId, campaignId]
  );
}

async function removeCampaignItem(campaignId, templateId) {
  if (!campaignId || !templateId) return;
  await runAsync(
    'DELETE FROM quest_campaign_items WHERE campaign_id = ? AND template_id = ?',
    [campaignId, templateId]
  );
}

function parseJsonObject(raw) {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function validateQuestTemplatePayload({ conditionType, uiJson, targetValue }) {
  const target = Number(targetValue);
  if (!Number.isFinite(target) || target <= 0) {
    return { error: '목표는 1 이상의 숫자여야 합니다.' };
  }

  if (conditionType !== 'PROMPT_POST_CREATED') {
    return { uiJson };
  }

  const parsed = parseJsonObject(uiJson);
  const prompt = parsed?.prompt && typeof parsed.prompt === 'object' ? parsed.prompt : null;
  const key = typeof prompt?.key === 'string' ? prompt.key.trim() : '';
  const title = typeof prompt?.title === 'string' ? prompt.title.trim() : '';

  if (!parsed || parsed.quest_kind !== 'writing_prompt' || !key || !title) {
    return {
      error:
        '프롬프트 글쓰기 퀘스트는 ui_json에 quest_kind=writing_prompt와 prompt.key/title이 필요합니다.',
    };
  }

  return { uiJson: JSON.stringify(parsed) };
}

// 모든 관리자 라우트에 인증/관리자 검증을 공통 적용
router.use(authRequired, adminRequired);

// 헬스 체크: admin 네임스페이스가 정상적으로 연결되었는지 확인
router.get('/', (req, res) => {
  res.json({ ok: true, message: 'admin api ready' });
});

router.get('/operational-alerts', async (req, res) => {
  const parsed = parseOperationalAlertsQuery(req.query || {});
  if (parsed.error) {
    return sendAdminError(res, 400, 'INVALID_REQUEST', parsed.error);
  }

  const where = [];
  const params = [];
  if (parsed.status !== 'all') {
    where.push('status = ?');
    params.push(parsed.status);
  }
  if (parsed.level !== 'all') {
    where.push('level = ?');
    params.push(parsed.level);
  }
  if (parsed.domain !== 'all') {
    where.push('domain = ?');
    params.push(parsed.domain);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const rows = await allAsync(
      `
      SELECT *
      FROM admin_operational_alerts
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
      `,
      [...params, parsed.limit]
    );

    return res.json({
      ok: true,
      message: '운영 알림 목록을 불러왔습니다.',
      alerts: (rows || []).map(mapOperationalAlert),
      filters: parsed,
    });
  } catch (error) {
    console.error('[admin/operational-alerts] failed:', error);
    return sendAdminError(res, 500, 'INTERNAL_ERROR', '운영 알림 목록 조회 중 오류가 발생했습니다.');
  }
});

router.post('/operational-alerts/:id/resolve', async (req, res) => {
  const alertId = parsePositiveInt(req.params.id);
  if (!alertId) {
    return sendAdminError(res, 400, 'INVALID_REQUEST', 'alert id가 올바르지 않습니다.');
  }

  try {
    await runAsync(
      `
      UPDATE admin_operational_alerts
      SET
        status = 'resolved',
        resolved_at = CURRENT_TIMESTAMP,
        resolved_by_admin_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status <> 'resolved'
      `,
      [req.user?.id || null, alertId]
    );

    const alert = await getAsync('SELECT * FROM admin_operational_alerts WHERE id = ? LIMIT 1', [
      alertId,
    ]);
    if (!alert) {
      return sendAdminError(res, 404, 'RESOURCE_NOT_FOUND', '해당 운영 알림을 찾을 수 없습니다.');
    }

    return res.json({
      ok: true,
      message: '운영 알림을 해결 처리했습니다.',
      alert: mapOperationalAlert(alert),
    });
  } catch (error) {
    console.error('[admin/operational-alerts/resolve] failed:', error);
    return sendAdminError(res, 500, 'INTERNAL_ERROR', '운영 알림 해결 처리 중 오류가 발생했습니다.');
  }
});

router.get('/growth/operations/health', async (req, res) => {
  try {
    const health = await buildGrowthOperationalHealth();
    return res.json({
      ok: true,
      message: '성장 운영 상태를 불러왔습니다.',
      health,
    });
  } catch (error) {
    console.error('[admin/growth/operations/health] failed:', error);
    return sendAdminError(res, 500, 'INTERNAL_ERROR', '성장 운영 상태 조회 중 오류가 발생했습니다.');
  }
});

router.get('/writing-campaigns/monthly-project', async (req, res) => {
  try {
    const status = getDailyWritingCampaignStatus();
    return res.json(
      buildWritingEventAdminPayload(
        status,
        DAILY_WRITING_PROMPTS,
        '글숲 한달 글쓰기 프로젝트 정보를 불러왔습니다.'
      )
    );
  } catch (error) {
    console.error('[admin/writing-campaigns/monthly-project] failed:', error);
    return sendAdminError(
      res,
      500,
      'INTERNAL_ERROR',
      '글쓰기 프로젝트 정보를 불러오는 중 오류가 발생했습니다.'
    );
  }
});

router.get('/writing-events/:eventKey', async (req, res) => {
  const eventKey = normalizeWritingEventKey(req.params.eventKey || DAILY_WRITING_CAMPAIGN_KEY);
  const event = getWritingEventDefinition(eventKey);
  if (!event) {
    return sendAdminError(res, 404, 'WRITING_EVENT_NOT_FOUND', '해당 글쓰기 이벤트를 찾을 수 없습니다.');
  }

  try {
    const status = getWritingEventStatus(event.key);
    return res.json(
      buildWritingEventAdminPayload(status, event.prompts, '글쓰기 이벤트 정보를 불러왔습니다.')
    );
  } catch (error) {
    console.error('[admin/writing-events/:eventKey] failed:', error);
    return sendAdminError(
      res,
      500,
      'INTERNAL_ERROR',
      '글쓰기 이벤트 정보를 불러오는 중 오류가 발생했습니다.'
    );
  }
});

router.post('/growth/operations/alerts/sync', async (req, res) => {
  try {
    const health = await buildGrowthOperationalHealth();
    const createdAlerts = [];
    for (const check of health.checks) {
      if (check.status === 'pass') continue;
      const alert = await createAdminOperationalAlert({
        domain: check.code.includes('CAMPAIGN') ? 'campaign' : 'growth',
        level: check.level,
        code: check.code,
        title: check.title,
        message: check.message,
        context: {
          count: check.count,
          items: check.items,
          source: 'growth_operations_health_sync',
        },
        dedupeKey: `growth-health:${check.code}`,
        createdByAdminId: req.user?.id || null,
      });
      if (alert) createdAlerts.push(alert);
    }

    return res.json({
      ok: true,
      message: '성장 운영 알림을 동기화했습니다.',
      health,
      alerts: createdAlerts,
    });
  } catch (error) {
    console.error('[admin/growth/operations/alerts/sync] failed:', error);
    return sendAdminError(res, 500, 'INTERNAL_ERROR', '성장 운영 알림 동기화 중 오류가 발생했습니다.');
  }
});

function sendAdminError(res, status, code, message) {
  return res.status(status).json({ ok: false, code, message });
}

function recordOperationalAlert(input = {}) {
  return createAdminOperationalAlert(input).catch((error) => {
    console.error('[admin/operational-alerts] failed to record alert:', error);
    return null;
  });
}

async function rollbackAdminTransactionQuietly(context) {
  try {
    await runAsync('ROLLBACK;');
  } catch (rollbackError) {
    console.error(`[admin] ${context} rollback failed:`, rollbackError);
  }
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime());
}

function parseBoundedInt(raw, fallback, min, max) {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function parseBooleanFlag(raw) {
  if (raw === true || raw === false) return raw;
  if (typeof raw === 'number') return raw === 1;
  if (typeof raw !== 'string') return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function parsePositiveInt(raw) {
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < 1) return null;
    return raw;
  }
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

const DEFAULT_SAFETY_ACTION_BY_STATUS = {
  reviewing: 'under_review',
  actioned: 'moderation_action',
  dismissed: 'no_violation',
};

function parseSafetyResolutionBody(body = {}) {
  const status =
    typeof body?.status === 'string' ? body.status.trim().toLowerCase() : '';
  const action =
    typeof body?.action === 'string' && body.action.trim()
      ? body.action.trim().toLowerCase()
      : DEFAULT_SAFETY_ACTION_BY_STATUS[status] || null;
  const actionDetail =
    typeof body?.action_detail === 'string' ? body.action_detail.trim() : null;

  if (!['reviewing', 'actioned', 'dismissed'].includes(status)) {
    return {
      error: "status는 'reviewing', 'actioned', 'dismissed' 중 하나여야 합니다.",
    };
  }

  return {
    status,
    action,
    actionDetail,
  };
}

async function deleteReportedPostWithResolution({ postId, handledByUserId, actionDetail = null }) {
  await runAsync('BEGIN IMMEDIATE');

  try {
    const post = await getAsync(
      `
      SELECT
        p.id,
        p.title,
        p.user_id,
        u.nickname AS author_nickname
      FROM posts p
      LEFT JOIN users u ON u.id = p.user_id
      WHERE p.id = ?
      LIMIT 1
      `,
      [postId]
    );

    if (!post) {
      await runAsync('ROLLBACK');
      return null;
    }

    const resolution = await runAsync(
      `
      UPDATE safety_reports
      SET status = 'actioned',
          action = 'post_deleted',
          action_detail = ?,
          handled_by_user_id = ?,
          handled_at = CURRENT_TIMESTAMP
      WHERE source = 'report'
        AND target_type = 'post'
        AND target_post_id = ?
        AND status NOT IN ('actioned', 'dismissed')
      `,
      [actionDetail, handledByUserId, postId]
    );

    await deletePostReferences(postId);

    const deleted = await runAsync('DELETE FROM posts WHERE id = ?', [postId]);
    if (Number(deleted?.changes || 0) === 0) {
      await runAsync('ROLLBACK');
      return null;
    }

    await runAsync('COMMIT');

    return {
      post,
      deleted: true,
      resolved_count: Number(resolution?.changes || 0),
    };
  } catch (error) {
    try {
      await runAsync('ROLLBACK');
    } catch (rollbackError) {
      console.error('[admin/safety/reported-posts/delete] rollback failed:', rollbackError);
    }
    throw error;
  }
}

router.get('/safety/reports', async (req, res) => {
  const limit = parseBoundedInt(req.query.limit, 50, 1, 100);
  const offset = parseBoundedInt(req.query.offset, 0, 0, 5000);
  const status =
    typeof req.query.status === 'string' && req.query.status.trim()
      ? req.query.status.trim().toLowerCase()
      : null;

  if (limit === null || offset === null) {
    return sendAdminError(res, 400, 'INVALID_REQUEST', 'limit 또는 offset 값이 올바르지 않습니다.');
  }

  try {
    const sources = ['report', 'block'];
    const reports = await listSafetyReports({
      status,
      limit,
      offset,
      sources,
    });
    return res.json({
      ok: true,
      message: '안전 신고 목록을 불러왔습니다.',
      reports,
      meta: {
        limit,
        offset,
        count: reports.length,
        status: status || 'all',
        source: 'report+block',
        sources,
      },
    });
  } catch (error) {
    console.error('[admin/safety/reports] failed:', error);
    return sendAdminError(res, 500, 'INTERNAL_ERROR', '안전 신고 목록을 불러오는 중 오류가 발생했습니다.');
  }
});

router.get('/safety/reported-posts', async (req, res) => {
  const limit = parseBoundedInt(req.query.limit, 50, 1, 100);
  const offset = parseBoundedInt(req.query.offset, 0, 0, 5000);
  const threshold = parseBoundedInt(req.query.threshold, 5, 1, 100);

  if (limit === null || offset === null || threshold === null) {
    return sendAdminError(
      res,
      400,
      'INVALID_REQUEST',
      'limit, offset 또는 threshold 값이 올바르지 않습니다.'
    );
  }

  try {
    const posts = await listReportedPosts({
      limit,
      offset,
      threshold,
      excludeDismissed: true,
    });

    return res.json({
      ok: true,
      message: '누적 신고 글 목록을 불러왔습니다.',
      posts,
      meta: {
        limit,
        offset,
        threshold,
        count: posts.length,
        source: 'report',
        target_type: 'post',
        dismissed_excluded: true,
      },
    });
  } catch (error) {
    console.error('[admin/safety/reported-posts] failed:', error);
    return sendAdminError(
      res,
      500,
      'INTERNAL_ERROR',
      '누적 신고 글 목록을 불러오는 중 오류가 발생했습니다.'
    );
  }
});

router.post('/safety/reported-posts/:postId/resolve', async (req, res) => {
  const postId = parsePositiveInt(req.params.postId);
  const parsed = parseSafetyResolutionBody(req.body || {});

  if (!postId) {
    return sendAdminError(res, 400, 'INVALID_REQUEST', '잘못된 글 ID입니다.');
  }
  if (parsed.error) {
    return sendAdminError(res, 400, 'INVALID_REQUEST', parsed.error);
  }

  try {
    const result = await resolveSafetyReportsForPost({
      postId,
      status: parsed.status,
      action: parsed.action,
      actionDetail: parsed.actionDetail,
      handledByUserId: req.user.id,
    });

    return res.json({
      ok: true,
      message: '신고 글의 미처리 신고를 업데이트했습니다.',
      result,
    });
  } catch (error) {
    console.error('[admin/safety/reported-posts/resolve] failed:', error);
    return sendAdminError(res, 500, 'INTERNAL_ERROR', '신고 글 처리 중 오류가 발생했습니다.');
  }
});

router.post('/safety/reported-posts/:postId/delete', async (req, res) => {
  const postId = parsePositiveInt(req.params.postId);
  const actionDetail =
    typeof req.body?.action_detail === 'string'
      ? req.body.action_detail.trim().slice(0, 500)
      : '관리자 신고 글 처리 UI에서 삭제';

  if (!postId) {
    return sendAdminError(res, 400, 'INVALID_REQUEST', '잘못된 글 ID입니다.');
  }

  try {
    const result = await deleteReportedPostWithResolution({
      postId,
      handledByUserId: req.user.id,
      actionDetail,
    });

    if (!result) {
      return sendAdminError(res, 404, 'RESOURCE_NOT_FOUND', '신고 대상 글을 찾을 수 없습니다.');
    }

    return res.json({
      ok: true,
      message: '신고 대상 글을 삭제하고 관련 신고를 조치 완료로 처리했습니다.',
      result,
    });
  } catch (error) {
    console.error('[admin/safety/reported-posts/delete] failed:', error);
    return sendAdminError(res, 500, 'INTERNAL_ERROR', '신고 대상 글 삭제 중 오류가 발생했습니다.');
  }
});

router.post('/safety/reports/:id/resolve', async (req, res) => {
  const reportId = parsePositiveInt(req.params.id);
  const parsed = parseSafetyResolutionBody(req.body || {});

  if (!reportId) {
    return sendAdminError(res, 400, 'INVALID_REQUEST', '잘못된 신고 ID입니다.');
  }
  if (parsed.error) {
    return sendAdminError(res, 400, 'INVALID_REQUEST', parsed.error);
  }

  try {
    const report = await resolveSafetyReport({
      reportId,
      status: parsed.status,
      action: parsed.action,
      actionDetail: parsed.actionDetail,
      handledByUserId: req.user.id,
    });

    if (!report) {
      return sendAdminError(res, 404, 'RESOURCE_NOT_FOUND', '신고를 찾을 수 없습니다.');
    }

    return res.json({
      ok: true,
      message: '안전 신고 상태를 업데이트했습니다.',
      report,
    });
  } catch (error) {
    console.error('[admin/safety/reports/resolve] failed:', error);
    return sendAdminError(res, 500, 'INTERNAL_ERROR', '안전 신고 처리 중 오류가 발생했습니다.');
  }
});

function normalizeEntitlementKey(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > 120) return null;
  return trimmed;
}

function parseOptionalIsoDateTime(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

function parseEntitlementGrantPayload(body = {}) {
  const userId = parsePositiveInt(body.user_id);
  const entitlementKey = normalizeEntitlementKey(body.entitlement_key);
  const source =
    typeof body.source === 'string' && body.source.trim()
      ? body.source.trim().toLowerCase()
      : 'admin';
  const endsAt = parseOptionalIsoDateTime(body.ends_at);

  if (!userId) {
    return { error: 'user_id는 1 이상의 정수여야 합니다.' };
  }
  if (!entitlementKey) {
    return { error: 'entitlement_key는 문자열이어야 합니다.' };
  }
  if (!['admin', 'promo'].includes(source)) {
    return { error: "source는 'admin' 또는 'promo'만 허용됩니다." };
  }
  if (endsAt === undefined) {
    return { error: 'ends_at은 ISO datetime 형식이어야 합니다.' };
  }

  return {
    userId,
    entitlementKey,
    source,
    endsAt,
  };
}

const MONETIZATION_PLATFORMS = new Set(['apple', 'google', 'web']);

function normalizeShortString(raw, maxLength = 255) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function normalizeMonetizationPlatform(raw) {
  const normalized = normalizeShortString(raw, 20)?.toLowerCase();
  if (!normalized || !MONETIZATION_PLATFORMS.has(normalized)) {
    return null;
  }
  return normalized;
}

function parsePurchaseReconcilePayload(body = {}) {
  const purchaseId = parsePositiveInt(body.purchase_id);
  const platform = normalizeMonetizationPlatform(body.platform);
  const transactionId = normalizeShortString(body.transaction_id, 255);
  const purchaseToken = normalizeShortString(body.purchase_token, 400);
  const status = normalizePurchaseStatus(body.status);
  const hasExpiresAt = Object.prototype.hasOwnProperty.call(body, 'expires_at');
  const expiresAt = hasExpiresAt
    ? parseOptionalIsoDateTime(body.expires_at)
    : null;
  const source =
    typeof body.source === 'string' && body.source.trim()
      ? body.source.trim().toLowerCase()
      : 'admin';
  const reason = normalizeShortString(body.reason, 200);

  if (!status) {
    return {
      error:
        "status는 'active', 'expired', 'refunded', 'canceled', 'pending' 중 하나여야 합니다.",
    };
  }
  if (!['admin', 'promo', 'iap'].includes(source)) {
    return { error: "source는 'admin', 'promo', 'iap'만 허용됩니다." };
  }
  if (hasExpiresAt && expiresAt === undefined) {
    return { error: 'expires_at은 ISO datetime 형식이어야 합니다.' };
  }

  const hasLookupById = Boolean(purchaseId);
  const hasLookupByIdentifier = Boolean(platform && (transactionId || purchaseToken));
  if (!hasLookupById && !hasLookupByIdentifier) {
    return {
      error:
        'purchase_id 또는 (platform + transaction_id/purchase_token) 조합이 필요합니다.',
    };
  }
  if (hasLookupById && (platform || transactionId || purchaseToken)) {
    return {
      error:
        'purchase_id를 사용할 때는 platform/transaction_id/purchase_token을 함께 보낼 수 없습니다.',
    };
  }

  return {
    purchaseId: hasLookupById ? purchaseId : null,
    platform: hasLookupByIdentifier ? platform : null,
    transactionId: hasLookupByIdentifier ? transactionId : null,
    purchaseToken: hasLookupByIdentifier ? purchaseToken : null,
    status,
    expiresAt,
    hasExpiresAt,
    source,
    reason: reason || null,
  };
}

function parseMonetizationReconcilePayload(body = {}) {
  if (body.user_id === undefined || body.user_id === null || body.user_id === '') {
    return { userId: null };
  }
  const userId = parsePositiveInt(body.user_id);
  if (!userId) {
    return { error: 'user_id는 1 이상의 정수여야 합니다.' };
  }
  return { userId };
}

function mapAdminPurchaseRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    platform: row.platform,
    store_sku: row.store_sku,
    status: row.status,
    purchased_at: row.purchased_at,
    expires_at: row.expires_at || null,
  };
}

function mapAdminEntitlementRow(row) {
  if (!row) return null;
  return {
    user_id: row.user_id,
    entitlement_key: row.entitlement_key,
    status: row.status,
    source: row.source,
    starts_at: row.starts_at || null,
    ends_at: row.ends_at || null,
  };
}

function safeParseJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    return null;
  }
}

function parseEnum(raw, allowed = [], fallback = null) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return fallback;
  return allowed.includes(normalized) ? normalized : null;
}

function parseMonetizationAlertsQuery(query = {}) {
  const status = parseEnum(query.status, ['open', 'resolved', 'all'], 'open');
  if (!status) {
    return { error: 'status는 open, resolved, all 중 하나여야 합니다.' };
  }

  const level = parseEnum(query.level, ['info', 'warn', 'error', 'all'], 'all');
  if (!level) {
    return { error: 'level은 info, warn, error, all 중 하나여야 합니다.' };
  }

  const limit = parseBoundedInt(query.limit, 50, 1, 200);
  if (limit === null) {
    return { error: 'limit은 1~200 범위여야 합니다.' };
  }

  return { status, level, limit };
}

function parseOperationalAlertsQuery(query = {}) {
  const status = parseEnum(query.status, ['open', 'resolved', 'all'], 'open');
  if (!status) {
    return { error: 'status는 open, resolved, all 중 하나여야 합니다.' };
  }

  const level = parseEnum(query.level, ['info', 'warn', 'error', 'all'], 'all');
  if (!level) {
    return { error: 'level은 info, warn, error, all 중 하나여야 합니다.' };
  }

  const domain = parseEnum(
    query.domain,
    ['growth', 'campaign', 'notifications', 'monetization', 'system', 'all'],
    'all'
  );
  if (!domain) {
    return {
      error: 'domain은 growth, campaign, notifications, monetization, system, all 중 하나여야 합니다.',
    };
  }

  const limit = parseBoundedInt(query.limit, 50, 1, 200);
  if (limit === null) {
    return { error: 'limit은 1~200 범위여야 합니다.' };
  }

  return { status, level, domain, limit };
}

function mapGrowthHealthCheck(input) {
  return {
    code: input.code,
    level: input.level || 'info',
    status: input.status || 'pass',
    title: input.title,
    message: input.message || '',
    count: Number(input.count || 0),
    items: input.items || [],
  };
}

async function buildGrowthOperationalHealth() {
  const checks = [];
  const achievementCampaign = await getAsync(
    "SELECT id, is_active FROM quest_campaigns WHERE LOWER(campaign_type) = 'permanent' AND name = '업적' LIMIT 1"
  );

  checks.push(
    mapGrowthHealthCheck({
      code: 'GROWTH_ACHIEVEMENT_CAMPAIGN_READY',
      level: achievementCampaign?.id ? 'info' : 'error',
      status: achievementCampaign?.id ? 'pass' : 'error',
      title: '업적 상시 캠페인',
      message: achievementCampaign?.id
        ? '업적 상시 캠페인이 준비되어 있습니다.'
        : '업적 상시 캠페인이 없어 업적 템플릿을 사용자 상태와 연결할 수 없습니다.',
      count: achievementCampaign?.id ? 1 : 0,
      items: achievementCampaign?.id ? [achievementCampaign] : [],
    })
  );

  const achievementCampaignId = achievementCampaign?.id || 0;
  const unlinkedAchievements = await allAsync(
    `
    SELECT qt.id, qt.name, qt.code
    FROM quest_templates qt
    WHERE qt.template_kind = 'achievement'
      AND qt.is_active = 1
      AND NOT EXISTS (
        SELECT 1
        FROM quest_campaign_items qci
        WHERE qci.template_id = qt.id
          AND qci.campaign_id = ?
      )
    ORDER BY qt.id DESC
    LIMIT 20
    `,
    [achievementCampaignId]
  );

  checks.push(
    mapGrowthHealthCheck({
      code: 'GROWTH_ACHIEVEMENT_TEMPLATE_UNLINKED',
      level: unlinkedAchievements.length > 0 ? 'warn' : 'info',
      status: unlinkedAchievements.length > 0 ? 'warn' : 'pass',
      title: '연결되지 않은 업적 템플릿',
      message:
        unlinkedAchievements.length > 0
          ? '활성 업적 템플릿 중 업적 캠페인에 연결되지 않은 항목이 있습니다.'
          : '활성 업적 템플릿이 업적 캠페인에 연결되어 있습니다.',
      count: unlinkedAchievements.length,
      items: unlinkedAchievements,
    })
  );

  const emptyActiveCampaigns = await allAsync(
    `
    SELECT qc.id, qc.name, qc.campaign_type
    FROM quest_campaigns qc
    WHERE qc.is_active = 1
      AND NOT EXISTS (
        SELECT 1
        FROM quest_campaign_items qci
        WHERE qci.campaign_id = qc.id
      )
    ORDER BY qc.priority DESC, qc.id DESC
    LIMIT 20
    `
  );

  checks.push(
    mapGrowthHealthCheck({
      code: 'GROWTH_ACTIVE_CAMPAIGN_EMPTY',
      level: emptyActiveCampaigns.length > 0 ? 'warn' : 'info',
      status: emptyActiveCampaigns.length > 0 ? 'warn' : 'pass',
      title: '비어 있는 활성 캠페인',
      message:
        emptyActiveCampaigns.length > 0
          ? '활성 캠페인 중 연결된 템플릿이 없는 항목이 있습니다.'
          : '활성 캠페인에 하나 이상의 템플릿이 연결되어 있습니다.',
      count: emptyActiveCampaigns.length,
      items: emptyActiveCampaigns,
    })
  );

  const inactiveLinkedTemplates = await allAsync(
    `
    SELECT
      qc.id AS campaign_id,
      qc.name AS campaign_name,
      qt.id AS template_id,
      qt.name AS template_name
    FROM quest_campaigns qc
    JOIN quest_campaign_items qci ON qci.campaign_id = qc.id
    JOIN quest_templates qt ON qt.id = qci.template_id
    WHERE qc.is_active = 1
      AND COALESCE(qt.is_active, 0) = 0
    ORDER BY qc.id DESC, qt.id DESC
    LIMIT 20
    `
  );

  checks.push(
    mapGrowthHealthCheck({
      code: 'GROWTH_ACTIVE_CAMPAIGN_INACTIVE_TEMPLATE',
      level: inactiveLinkedTemplates.length > 0 ? 'warn' : 'info',
      status: inactiveLinkedTemplates.length > 0 ? 'warn' : 'pass',
      title: '비활성 템플릿이 포함된 활성 캠페인',
      message:
        inactiveLinkedTemplates.length > 0
          ? '활성 캠페인에 비활성 템플릿이 포함되어 사용자에게 보이지 않을 수 있습니다.'
          : '활성 캠페인에 비활성 템플릿이 포함되어 있지 않습니다.',
      count: inactiveLinkedTemplates.length,
      items: inactiveLinkedTemplates,
    })
  );

  const invalidDateCampaigns = await allAsync(
    `
    SELECT id, name, campaign_type, start_at, end_at
    FROM quest_campaigns
    WHERE start_at IS NOT NULL
      AND end_at IS NOT NULL
      AND datetime(end_at) < datetime(start_at)
    ORDER BY id DESC
    LIMIT 20
    `
  );

  checks.push(
    mapGrowthHealthCheck({
      code: 'GROWTH_CAMPAIGN_INVALID_DATE_RANGE',
      level: invalidDateCampaigns.length > 0 ? 'error' : 'info',
      status: invalidDateCampaigns.length > 0 ? 'error' : 'pass',
      title: '캠페인 기간 설정',
      message:
        invalidDateCampaigns.length > 0
          ? '종료일이 시작일보다 빠른 캠페인이 있습니다.'
          : '캠페인 기간 설정이 유효합니다.',
      count: invalidDateCampaigns.length,
      items: invalidDateCampaigns,
    })
  );

  const openAlertCount = await getAsync(
    `
    SELECT COUNT(*) AS cnt
    FROM admin_operational_alerts
    WHERE status = 'open'
      AND domain IN ('growth', 'campaign')
    `
  );

  return {
    ok: checks.every((check) => check.status === 'pass'),
    checks,
    open_alert_count: Number(openAlertCount?.cnt || 0),
  };
}

function parseMonetizationWebhookEventsQuery(query = {}) {
  const provider = parseEnum(query.provider, ['apple', 'google', 'all'], 'all');
  if (!provider) {
    return { error: 'provider는 apple, google, all 중 하나여야 합니다.' };
  }

  const processState = parseEnum(
    query.process_state,
    ['received', 'processed', 'ignored', 'failed', 'all'],
    'all'
  );
  if (!processState) {
    return {
      error:
        'process_state는 received, processed, ignored, failed, all 중 하나여야 합니다.',
    };
  }

  const limit = parseBoundedInt(query.limit, 50, 1, 200);
  if (limit === null) {
    return { error: 'limit은 1~200 범위여야 합니다.' };
  }

  return { provider, processState, limit };
}

function parseCosmeticGrantPayload(body = {}) {
  const userId = parsePositiveInt(body.user_id);
  const cosmeticKey =
    typeof body.cosmetic_key === 'string' ? body.cosmetic_key.trim() : '';

  if (!userId) {
    return { error: 'user_id는 1 이상의 정수여야 합니다.' };
  }
  if (!cosmeticKey) {
    return { error: 'cosmetic_key는 문자열이어야 합니다.' };
  }

  return { userId, cosmeticKey };
}

function parseShareSummaryQuery(query = {}) {
  const from = typeof query.from === 'string' ? query.from.trim() : '';
  const to = typeof query.to === 'string' ? query.to.trim() : '';
  const platformRaw = typeof query.platform === 'string' ? query.platform.trim().toLowerCase() : 'all';
  const surface = typeof query.surface === 'string' ? query.surface.trim() : '';
  const channel = typeof query.channel === 'string' ? query.channel.trim() : '';
  const topLimit = parseBoundedInt(query.top_limit, 10, 1, 50);
  const dailyLimit = parseBoundedInt(query.daily_limit, 30, 1, 120);

  if (from && !isValidIsoDate(from)) {
    return { error: 'from은 YYYY-MM-DD 형식이어야 합니다.' };
  }
  if (to && !isValidIsoDate(to)) {
    return { error: 'to는 YYYY-MM-DD 형식이어야 합니다.' };
  }
  if (from && to && from > to) {
    return { error: 'from은 to보다 이후일 수 없습니다.' };
  }

  if (!['all', 'mobile', 'web'].includes(platformRaw)) {
    return { error: 'platform은 all, mobile, web 중 하나여야 합니다.' };
  }

  if (surface && surface.length > 60) {
    return { error: 'surface는 60자 이하여야 합니다.' };
  }

  if (channel && channel.length > 60) {
    return { error: 'channel은 60자 이하여야 합니다.' };
  }

  if (topLimit === null) {
    return { error: 'top_limit은 1~50 범위여야 합니다.' };
  }

  if (dailyLimit === null) {
    return { error: 'daily_limit은 1~120 범위여야 합니다.' };
  }

  return {
    from: from || null,
    to: to || null,
    platform: platformRaw,
    surface: surface || null,
    channel: channel || null,
    topLimit,
    dailyLimit,
  };
}

function parseUxEventSummaryQuery(query = {}) {
  const from = typeof query.from === 'string' ? query.from.trim() : '';
  const to = typeof query.to === 'string' ? query.to.trim() : '';
  const eventNameRaw =
    typeof query.event_name === 'string' ? query.event_name.trim().toLowerCase() : '';
  const sourceRaw = typeof query.source === 'string' ? query.source.trim().toLowerCase() : 'all';
  const userType = parseEnum(query.user_type, ['all', 'authenticated', 'anonymous'], 'all');
  const deviceClass = parseEnum(
    query.device_class,
    ['all', 'desktop', 'mobile', 'tablet', 'unknown'],
    'all'
  );
  const platformFamily = parseEnum(
    query.platform_family,
    ['all', 'ios', 'android', 'windows', 'macos', 'linux', 'chromeos', 'unknown'],
    'all'
  );
  const topLimit = parseBoundedInt(query.top_limit, 10, 1, 100);
  const dailyLimit = parseBoundedInt(query.daily_limit, 30, 1, 120);

  if (from && !isValidIsoDate(from)) {
    return { error: 'from은 YYYY-MM-DD 형식이어야 합니다.' };
  }
  if (to && !isValidIsoDate(to)) {
    return { error: 'to는 YYYY-MM-DD 형식이어야 합니다.' };
  }
  if (from && to && from > to) {
    return { error: 'from은 to보다 이후일 수 없습니다.' };
  }

  if (eventNameRaw && !/^[a-z0-9_]{1,64}$/.test(eventNameRaw)) {
    return { error: 'event_name은 영문 소문자/숫자/언더스코어 형식(최대 64자)이어야 합니다.' };
  }

  if (sourceRaw !== 'all') {
    if (!/^[a-z0-9_:-]{1,40}$/.test(sourceRaw)) {
      return { error: 'source는 영문 소문자/숫자/언더스코어/콜론/하이픈 형식(최대 40자)이어야 합니다.' };
    }
  }

  if (!userType) {
    return { error: 'user_type은 all, authenticated, anonymous 중 하나여야 합니다.' };
  }

  if (!deviceClass) {
    return { error: 'device_class는 all, desktop, mobile, tablet, unknown 중 하나여야 합니다.' };
  }

  if (!platformFamily) {
    return {
      error:
        'platform_family는 all, ios, android, windows, macos, linux, chromeos, unknown 중 하나여야 합니다.',
    };
  }

  if (topLimit === null) {
    return { error: 'top_limit은 1~100 범위여야 합니다.' };
  }

  if (dailyLimit === null) {
    return { error: 'daily_limit은 1~120 범위여야 합니다.' };
  }

  return {
    from: from || null,
    to: to || null,
    eventName: eventNameRaw || null,
    source: sourceRaw || 'all',
    userType,
    deviceClass,
    platformFamily,
    topLimit,
    dailyLimit,
  };
}

router.post('/entitlements/grant', async (req, res) => {
  const parsed = parseEntitlementGrantPayload(req.body || {});
  if (parsed.error) {
    return sendAdminError(res, 400, 'INVALID_REQUEST', parsed.error);
  }

  try {
    const user = await getAsync('SELECT id FROM users WHERE id = ? LIMIT 1', [parsed.userId]);
    if (!user) {
      return sendAdminError(
        res,
        404,
        'RESOURCE_NOT_FOUND',
        '지급 대상 사용자를 찾을 수 없습니다.'
      );
    }

    const metaJson = JSON.stringify({
      granted_by_admin_id: req.user?.id || null,
      granted_at: new Date().toISOString(),
      route: 'admin/entitlements/grant',
    });

    await runAsync(
      `
      INSERT INTO user_entitlement_grants (
        user_id,
        entitlement_key,
        source,
        status,
        starts_at,
        ends_at,
        meta_json
      )
      VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, ?, ?)
      ON CONFLICT(user_id, entitlement_key, source) DO UPDATE SET
        status = 'active',
        starts_at = CURRENT_TIMESTAMP,
        ends_at = excluded.ends_at,
        meta_json = COALESCE(excluded.meta_json, user_entitlement_grants.meta_json),
        updated_at = CURRENT_TIMESTAMP
      `,
      [parsed.userId, parsed.entitlementKey, parsed.source, parsed.endsAt, metaJson]
    );

    const entitlement = await getEffectiveEntitlement(parsed.userId, parsed.entitlementKey);

    return res.json({
      ok: true,
      message: '권한을 지급했습니다.',
      entitlement: {
        user_id: parsed.userId,
        entitlement_key: entitlement?.entitlement_key || parsed.entitlementKey,
        status: entitlement?.status || 'active',
        source: entitlement?.source || parsed.source,
        starts_at: entitlement?.starts_at || null,
        ends_at: entitlement?.ends_at || null,
      },
    });
  } catch (error) {
    console.error('[admin/entitlements/grant] failed:', error);
    return sendAdminError(
      res,
      500,
      'INTERNAL_ERROR',
      '권한 지급 중 오류가 발생했습니다.'
    );
  }
});

router.post('/entitlements/revoke', async (req, res) => {
  const parsed = parseEntitlementGrantPayload(req.body || {});
  if (parsed.error) {
    return sendAdminError(res, 400, 'INVALID_REQUEST', parsed.error);
  }

  try {
    const result = await runAsync(
      `
      UPDATE user_entitlement_grants
      SET status = 'inactive',
          ends_at = COALESCE(ends_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
        AND entitlement_key = ?
        AND source = ?
      `,
      [parsed.userId, parsed.entitlementKey, parsed.source]
    );

    if (Number(result?.changes || 0) === 0) {
      return sendAdminError(
        res,
        404,
        'RESOURCE_NOT_FOUND',
        '회수할 관리자 권한을 찾을 수 없습니다.'
      );
    }

    const entitlement = await getEffectiveEntitlement(parsed.userId, parsed.entitlementKey);
    return res.json({
      ok: true,
      message: '관리자 권한을 회수했습니다.',
      entitlement: entitlement
        ? {
            user_id: parsed.userId,
            ...entitlement,
          }
        : null,
    });
  } catch (error) {
    console.error('[admin/entitlements/revoke] failed:', error);
    return sendAdminError(
      res,
      500,
      'INTERNAL_ERROR',
      '권한 회수 중 오류가 발생했습니다.'
    );
  }
});

router.post('/purchases/reconcile', async (req, res) => {
  const parsed = parsePurchaseReconcilePayload(req.body || {});
  if (parsed.error) {
    return sendAdminError(res, 400, 'INVALID_REQUEST', parsed.error);
  }

  const selectPurchaseBase = `
    SELECT
      p.id,
      p.user_id,
      p.platform,
      p.store_sku,
      p.transaction_id,
      p.purchase_token,
      p.original_transaction_id,
      p.environment,
      p.ownership_id,
      p.status,
      p.purchased_at,
      p.expires_at,
      p.raw_json,
      pr.product_type,
      pr.entitlement_key
    FROM purchases p
    LEFT JOIN products pr
      ON pr.platform = p.platform
     AND pr.store_sku = p.store_sku
  `;

  try {
    let purchase = null;
    if (parsed.purchaseId) {
      purchase = await getAsync(
        `
        ${selectPurchaseBase}
        WHERE p.id = ?
        LIMIT 1
        `,
        [parsed.purchaseId]
      );
    } else {
      const identifierClauses = [];
      const identifierParams = [parsed.platform];
      if (parsed.transactionId) {
        identifierClauses.push('p.transaction_id = ?');
        identifierParams.push(parsed.transactionId);
      }
      if (parsed.purchaseToken) {
        identifierClauses.push('p.purchase_token = ?');
        identifierParams.push(parsed.purchaseToken);
      }

      purchase = await getAsync(
        `
        ${selectPurchaseBase}
        WHERE p.platform = ?
          AND (${identifierClauses.join(' OR ')})
        ORDER BY p.id DESC
        LIMIT 1
        `,
        identifierParams
      );
    }

    if (!purchase) {
      return sendAdminError(
        res,
        404,
        'RESOURCE_NOT_FOUND',
        '해당 결제 레코드를 찾을 수 없습니다.'
      );
    }

    const nextExpiresAt = parsed.hasExpiresAt
      ? parsed.expiresAt
      : purchase.expires_at || null;

    const reconciledRawJson = mergeMonetizationRawJson(purchase.raw_json, {
      admin_reconcile: {
        actor_user_id: req.user?.id || null,
        source: parsed.source,
        reason: parsed.reason,
        status: parsed.status,
        expires_at: nextExpiresAt,
        reconciled_at: new Date().toISOString(),
      },
    });

    await runAsync(
      `
      UPDATE purchases
      SET
        status = ?,
        expires_at = ?,
        raw_json = ?
      WHERE id = ?
      `,
      [parsed.status, nextExpiresAt, reconciledRawJson, purchase.id]
    );

    if (purchase.ownership_id && purchase.product_type === 'subscription') {
      const ownershipRawJson = mergeMonetizationRawJson(purchase.raw_json, {
        admin_reconcile: {
          actor_user_id: req.user?.id || null,
          source: parsed.source,
          reason: parsed.reason,
          status: parsed.status,
          expires_at: nextExpiresAt,
          reconciled_at: new Date().toISOString(),
        },
      });

      await runAsync(
        `
        UPDATE subscription_ownerships
        SET
          status = ?,
          expires_at = ?,
          latest_transaction_id = COALESCE(?, latest_transaction_id),
          raw_json = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [
          parsed.status,
          nextExpiresAt,
          purchase.transaction_id || null,
          ownershipRawJson,
          purchase.ownership_id,
        ]
      );
    }

    const summary = await reconcileMonetizationState({ userId: purchase.user_id });

    const updatedPurchase = await getAsync(
      `
      ${selectPurchaseBase}
      WHERE p.id = ?
      LIMIT 1
      `,
      [purchase.id]
    );

    const effectiveEntitlement = updatedPurchase?.entitlement_key
      ? await getEffectiveEntitlement(
          updatedPurchase.user_id,
          updatedPurchase.entitlement_key
        )
      : null;
    const entitlement = effectiveEntitlement
      ? { user_id: updatedPurchase.user_id, ...effectiveEntitlement }
      : null;

    return res.json({
      ok: true,
      message: '결제 상태를 반영했습니다.',
      purchase: mapAdminPurchaseRow(updatedPurchase),
      entitlement: mapAdminEntitlementRow(entitlement),
      summary,
    });
  } catch (error) {
    console.error('[admin/purchases/reconcile] failed:', error);
    return sendAdminError(
      res,
      500,
      'INTERNAL_ERROR',
      '결제 상태 반영 중 오류가 발생했습니다.'
    );
  }
});

router.post('/monetization/reconcile', async (req, res) => {
  const parsed = parseMonetizationReconcilePayload(req.body || {});
  if (parsed.error) {
    return sendAdminError(res, 400, 'INVALID_REQUEST', parsed.error);
  }

  try {
    const summary = await reconcileMonetizationState({ userId: parsed.userId });
    return res.json({
      ok: true,
      message: '유료화 상태 동기화를 완료했습니다.',
      summary,
      scope: {
        user_id: parsed.userId,
      },
    });
  } catch (error) {
    console.error('[admin/monetization/reconcile] failed:', error);
    return sendAdminError(
      res,
      500,
      'INTERNAL_ERROR',
      '유료화 상태 동기화 중 오류가 발생했습니다.'
    );
  }
});

router.get('/monetization/alerts', async (req, res) => {
  const parsed = parseMonetizationAlertsQuery(req.query || {});
  if (parsed.error) {
    return sendAdminError(res, 400, 'INVALID_REQUEST', parsed.error);
  }

  const where = [];
  const params = [];

  if (parsed.status !== 'all') {
    where.push('status = ?');
    params.push(parsed.status);
  }
  if (parsed.level !== 'all') {
    where.push('level = ?');
    params.push(parsed.level);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const rows = await allAsync(
      `
      SELECT
        id,
        level,
        code,
        title,
        message,
        context_json,
        status,
        created_at,
        resolved_at,
        resolved_by_admin_id
      FROM monetization_alerts
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
      `,
      [...params, parsed.limit]
    );

    return res.json({
      ok: true,
      message: '유료화 알림 목록을 불러왔습니다.',
      alerts: (rows || []).map((row) => ({
        id: row.id,
        level: row.level,
        code: row.code,
        title: row.title,
        message: row.message || null,
        context: safeParseJson(row.context_json),
        status: row.status,
        created_at: row.created_at,
        resolved_at: row.resolved_at || null,
        resolved_by_admin_id: row.resolved_by_admin_id || null,
      })),
      filters: {
        status: parsed.status,
        level: parsed.level,
        limit: parsed.limit,
      },
    });
  } catch (error) {
    console.error('[admin/monetization/alerts] failed:', error);
    return sendAdminError(
      res,
      500,
      'INTERNAL_ERROR',
      '유료화 알림 목록 조회 중 오류가 발생했습니다.'
    );
  }
});

router.post('/monetization/alerts/:id/resolve', async (req, res) => {
  const alertId = parsePositiveInt(req.params.id);
  if (!alertId) {
    return sendAdminError(res, 400, 'INVALID_REQUEST', 'alert id가 올바르지 않습니다.');
  }

  try {
    const updateResult = await runAsync(
      `
      UPDATE monetization_alerts
      SET
        status = 'resolved',
        resolved_at = CURRENT_TIMESTAMP,
        resolved_by_admin_id = ?
      WHERE id = ? AND status <> 'resolved'
      `,
      [req.user?.id || null, alertId]
    );

    const alert = await getAsync(
      `
      SELECT
        id,
        level,
        code,
        title,
        message,
        context_json,
        status,
        created_at,
        resolved_at,
        resolved_by_admin_id
      FROM monetization_alerts
      WHERE id = ?
      LIMIT 1
      `,
      [alertId]
    );

    if (!alert) {
      return sendAdminError(
        res,
        404,
        'RESOURCE_NOT_FOUND',
        '해당 알림을 찾을 수 없습니다.'
      );
    }

    return res.json({
      ok: true,
      message:
        Number(updateResult?.changes || 0) > 0
          ? '알림을 해결 처리했습니다.'
          : '이미 해결된 알림입니다.',
      alert: {
        id: alert.id,
        level: alert.level,
        code: alert.code,
        title: alert.title,
        message: alert.message || null,
        context: safeParseJson(alert.context_json),
        status: alert.status,
        created_at: alert.created_at,
        resolved_at: alert.resolved_at || null,
        resolved_by_admin_id: alert.resolved_by_admin_id || null,
      },
    });
  } catch (error) {
    console.error('[admin/monetization/alerts/resolve] failed:', error);
    return sendAdminError(
      res,
      500,
      'INTERNAL_ERROR',
      '유료화 알림 해결 처리 중 오류가 발생했습니다.'
    );
  }
});

router.get('/monetization/webhook-events', async (req, res) => {
  const parsed = parseMonetizationWebhookEventsQuery(req.query || {});
  if (parsed.error) {
    return sendAdminError(res, 400, 'INVALID_REQUEST', parsed.error);
  }

  const where = [];
  const params = [];

  if (parsed.provider !== 'all') {
    where.push('provider = ?');
    params.push(parsed.provider);
  }
  if (parsed.processState !== 'all') {
    where.push('process_state = ?');
    params.push(parsed.processState);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const rows = await allAsync(
      `
      SELECT
        id,
        provider,
        event_id,
        event_type,
        transaction_id,
        purchase_token,
        purchase_status,
        expires_at,
        purchase_id,
        user_id,
        process_state,
        process_message,
        received_at,
        processed_at
      FROM monetization_webhook_events
      ${whereClause}
      ORDER BY received_at DESC, id DESC
      LIMIT ?
      `,
      [...params, parsed.limit]
    );

    return res.json({
      ok: true,
      message: '유료화 웹훅 이벤트를 불러왔습니다.',
      events: rows || [],
      filters: {
        provider: parsed.provider,
        process_state: parsed.processState,
        limit: parsed.limit,
      },
    });
  } catch (error) {
    console.error('[admin/monetization/webhook-events] failed:', error);
    return sendAdminError(
      res,
      500,
      'INTERNAL_ERROR',
      '유료화 웹훅 이벤트 조회 중 오류가 발생했습니다.'
    );
  }
});

router.post('/cosmetics/grant', async (req, res) => {
  const parsed = parseCosmeticGrantPayload(req.body || {});
  if (parsed.error) {
    return sendAdminError(res, 400, 'INVALID_REQUEST', parsed.error);
  }

  try {
    const [user, cosmeticItem, backgroundItem] = await Promise.all([
      getAsync('SELECT id FROM users WHERE id = ? LIMIT 1', [parsed.userId]),
      getAsync(
        `
        SELECT
          id,
          key,
          type,
          name,
          icon_emoji,
          COALESCE(rarity, 'common') AS rarity,
          season
        FROM cosmetic_items
        WHERE key = ?
        LIMIT 1
        `,
        [parsed.cosmeticKey]
      ),
      getAsync(
        `
        SELECT
          id,
          key,
          'background' AS type,
          name,
          icon_emoji,
          COALESCE(rarity, 'common') AS rarity,
          season
        FROM profile_background_items
        WHERE key = ?
          AND is_active = 1
        LIMIT 1
        `,
        [parsed.cosmeticKey]
      ),
    ]);
    const grantItem = cosmeticItem || backgroundItem;

    if (!user) {
      return sendAdminError(
        res,
        404,
        'RESOURCE_NOT_FOUND',
        '지급 대상 사용자를 찾을 수 없습니다.'
      );
    }
    if (!grantItem) {
      return sendAdminError(
        res,
        404,
        'RESOURCE_NOT_FOUND',
        '해당 cosmetic_key를 찾을 수 없습니다.'
      );
    }

    const result =
      grantItem.type === 'background'
        ? await runAsync(
            `
            INSERT OR IGNORE INTO user_profile_backgrounds (user_id, background_id, source)
            VALUES (?, ?, 'admin')
            `,
            [parsed.userId, grantItem.id]
          )
        : await runAsync(
            `
            INSERT OR IGNORE INTO user_cosmetics (user_id, cosmetic_id, source)
            VALUES (?, ?, 'admin')
            `,
            [parsed.userId, grantItem.id]
          );

    return res.json({
      ok: true,
      message: '코스메틱을 지급했습니다.',
      granted: {
        user_id: parsed.userId,
        source: 'admin',
        cosmetic: {
	          key: grantItem.key,
	          type: grantItem.type,
	          name: grantItem.name,
	          icon_emoji: grantItem.icon_emoji || null,
	          rarity: grantItem.rarity || 'common',
	          season: grantItem.season || null,
        },
      },
      inserted: Number(result?.changes || 0) > 0,
    });
  } catch (error) {
    console.error('[admin/cosmetics/grant] failed:', error);
    return sendAdminError(
      res,
      500,
      'INTERNAL_ERROR',
      '코스메틱 지급 중 오류가 발생했습니다.'
    );
  }
});

router.get('/share-events/summary', async (req, res) => {
  const parsed = parseShareSummaryQuery(req.query || {});
  if (parsed.error) {
    return sendAdminError(res, 400, 'INVALID_REQUEST', parsed.error);
  }

  const { from, to, platform, surface, channel, topLimit, dailyLimit } = parsed;

  const where = [];
  const params = [];

  if (from) {
    where.push("se.created_at >= datetime(?, 'start of day')");
    params.push(from);
  }
  if (to) {
    where.push("se.created_at < datetime(?, '+1 day', 'start of day')");
    params.push(to);
  }
  if (platform !== 'all') {
    where.push('se.platform = ?');
    params.push(platform);
  }
  if (surface) {
    where.push('se.surface = ?');
    params.push(surface);
  }
  if (channel) {
    where.push('se.channel = ?');
    params.push(channel);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const [summaryRow, byChannel, bySurface, byDay] = await Promise.all([
      getAsync(
        `SELECT
           COUNT(*) AS total_count,
           SUM(CASE WHEN se.result = 'shared' THEN 1 ELSE 0 END) AS shared_count,
           SUM(CASE WHEN se.result = 'dismissed' THEN 1 ELSE 0 END) AS dismissed_count,
           SUM(CASE WHEN se.result = 'failed' THEN 1 ELSE 0 END) AS failed_count,
           COUNT(DISTINCT CASE WHEN se.user_id IS NOT NULL THEN se.user_id END) AS unique_user_count,
           COUNT(DISTINCT CASE WHEN se.post_id IS NOT NULL THEN se.post_id END) AS unique_post_count
         FROM share_events se
         ${whereClause}`,
        params
      ),
      allAsync(
        `SELECT se.channel, COUNT(*) AS event_count
         FROM share_events se
         ${whereClause}
         GROUP BY se.channel
         ORDER BY event_count DESC, se.channel ASC
         LIMIT ?`,
        [...params, topLimit]
      ),
      allAsync(
        `SELECT se.surface, COUNT(*) AS event_count
         FROM share_events se
         ${whereClause}
         GROUP BY se.surface
         ORDER BY event_count DESC, se.surface ASC
         LIMIT ?`,
        [...params, topLimit]
      ),
      allAsync(
        `SELECT
           date(se.created_at) AS day,
           COUNT(*) AS total_count,
           SUM(CASE WHEN se.result = 'shared' THEN 1 ELSE 0 END) AS shared_count,
           SUM(CASE WHEN se.result = 'dismissed' THEN 1 ELSE 0 END) AS dismissed_count,
           SUM(CASE WHEN se.result = 'failed' THEN 1 ELSE 0 END) AS failed_count
         FROM share_events se
         ${whereClause}
         GROUP BY date(se.created_at)
         ORDER BY day DESC
         LIMIT ?`,
        [...params, dailyLimit]
      ),
    ]);

    return res.json({
      ok: true,
      message: '공유 이벤트 요약을 불러왔습니다.',
      filters: {
        from,
        to,
        platform,
        surface,
        channel,
      },
      summary: {
        total_count: Number(summaryRow?.total_count || 0),
        shared_count: Number(summaryRow?.shared_count || 0),
        dismissed_count: Number(summaryRow?.dismissed_count || 0),
        failed_count: Number(summaryRow?.failed_count || 0),
        unique_user_count: Number(summaryRow?.unique_user_count || 0),
        unique_post_count: Number(summaryRow?.unique_post_count || 0),
      },
      by_channel: byChannel || [],
      by_surface: bySurface || [],
      daily: byDay || [],
    });
  } catch (error) {
    console.error('[admin/share-events/summary] failed:', error);
    return sendAdminError(
      res,
      500,
      'INTERNAL_ERROR',
      '공유 이벤트 요약 조회 중 오류가 발생했습니다.'
    );
  }
});

router.get('/ux-events/summary', async (req, res) => {
  const parsed = parseUxEventSummaryQuery(req.query || {});
  if (parsed.error) {
    return sendAdminError(res, 400, 'INVALID_REQUEST', parsed.error);
  }

  const {
    from,
    to,
    eventName,
    source,
    userType,
    deviceClass,
    platformFamily,
    topLimit,
    dailyLimit,
  } = parsed;
  const where = [];
  const params = [];

  if (from) {
    where.push("ue.created_at >= datetime(?, 'start of day')");
    params.push(from);
  }
  if (to) {
    where.push("ue.created_at < datetime(?, '+1 day', 'start of day')");
    params.push(to);
  }
  if (eventName) {
    where.push('ue.event_name = ?');
    params.push(eventName);
  }
  if (source !== 'all') {
    where.push('ue.source = ?');
    params.push(source);
  }
  if (userType === 'authenticated') {
    where.push('ue.user_id IS NOT NULL');
  } else if (userType === 'anonymous') {
    where.push('ue.user_id IS NULL');
  }
  if (deviceClass !== 'all') {
    where.push('ue.device_class = ?');
    params.push(deviceClass);
  }
  if (platformFamily !== 'all') {
    where.push('ue.platform_family = ?');
    params.push(platformFamily);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  // funnel/p0 지표는 이벤트 종류 필터(event_name)를 제외한 동일 범위 조건으로 계산
  const p0Where = [];
  const p0Params = [];
  if (from) {
    p0Where.push("created_at >= datetime(?, 'start of day')");
    p0Params.push(from);
  }
  if (to) {
    p0Where.push("created_at < datetime(?, '+1 day', 'start of day')");
    p0Params.push(to);
  }
  if (source !== 'all') {
    p0Where.push('source = ?');
    p0Params.push(source);
  }
  if (userType === 'authenticated') {
    p0Where.push('user_id IS NOT NULL');
  } else if (userType === 'anonymous') {
    p0Where.push('user_id IS NULL');
  }
  if (deviceClass !== 'all') {
    p0Where.push('device_class = ?');
    p0Params.push(deviceClass);
  }
  if (platformFamily !== 'all') {
    p0Where.push('platform_family = ?');
    p0Params.push(platformFamily);
  }
  const p0WhereClause = p0Where.length > 0 ? `WHERE ${p0Where.join(' AND ')}` : '';

  try {
    const [summaryRow, byEvent, bySource, byDevice, byPlatform, byDay, p0Base] =
      await Promise.all([
        getAsync(
          `SELECT
             COUNT(*) AS total_count,
             COUNT(DISTINCT CASE WHEN ue.user_id IS NOT NULL THEN ue.user_id END) AS unique_user_count,
             COUNT(DISTINCT CASE WHEN ue.session_id IS NOT NULL THEN ue.session_id END) AS unique_session_count,
             SUM(CASE WHEN ue.user_id IS NULL THEN 1 ELSE 0 END) AS anonymous_count
           FROM ux_events ue
           ${whereClause}`,
          params
        ),
        allAsync(
          `SELECT ue.event_name, COUNT(*) AS event_count
           FROM ux_events ue
           ${whereClause}
           GROUP BY ue.event_name
           ORDER BY event_count DESC, ue.event_name ASC
           LIMIT ?`,
          [...params, topLimit]
        ),
        allAsync(
          `SELECT
             ue.source,
             COUNT(*) AS event_count,
             COUNT(DISTINCT CASE WHEN ue.session_id IS NOT NULL THEN ue.session_id END) AS unique_session_count,
             COUNT(DISTINCT CASE WHEN ue.user_id IS NOT NULL THEN ue.user_id END) AS unique_user_count
           FROM ux_events ue
           ${whereClause}
           GROUP BY ue.source
           ORDER BY event_count DESC, ue.source ASC
           LIMIT ?`,
          [...params, topLimit]
        ),
        allAsync(
          `SELECT
             ue.device_class,
             COUNT(*) AS event_count,
             COUNT(DISTINCT CASE WHEN ue.session_id IS NOT NULL THEN ue.session_id END) AS unique_session_count,
             COUNT(DISTINCT CASE WHEN ue.user_id IS NOT NULL THEN ue.user_id END) AS unique_user_count
           FROM ux_events ue
           ${whereClause}
           GROUP BY ue.device_class
           ORDER BY unique_session_count DESC, event_count DESC, ue.device_class ASC`,
          params
        ),
        allAsync(
          `SELECT
             ue.platform_family,
             COUNT(*) AS event_count,
             COUNT(DISTINCT CASE WHEN ue.session_id IS NOT NULL THEN ue.session_id END) AS unique_session_count,
             COUNT(DISTINCT CASE WHEN ue.user_id IS NOT NULL THEN ue.user_id END) AS unique_user_count
           FROM ux_events ue
           ${whereClause}
           GROUP BY ue.platform_family
           ORDER BY unique_session_count DESC, event_count DESC, ue.platform_family ASC`,
          params
        ),
        allAsync(
          `SELECT
             date(ue.created_at) AS day,
             COUNT(*) AS total_count,
             COUNT(DISTINCT CASE WHEN ue.session_id IS NOT NULL THEN ue.session_id END) AS unique_session_count,
             COUNT(DISTINCT CASE WHEN ue.user_id IS NOT NULL THEN ue.user_id END) AS unique_user_count
           FROM ux_events ue
           ${whereClause}
           GROUP BY date(ue.created_at)
           ORDER BY day DESC
           LIMIT ?`,
          [...params, dailyLimit]
        ),
        getAsync(
          `SELECT
             COUNT(DISTINCT CASE WHEN event_name = 'verify_email_success' AND user_id IS NOT NULL THEN user_id END) AS verify_success_user_count,
             COUNT(DISTINCT CASE WHEN event_name = 'first_post_created_24h' AND user_id IS NOT NULL THEN user_id END) AS first_post_24h_user_count,
             SUM(CASE WHEN event_name = 'verify_email_submit' THEN 1 ELSE 0 END) AS verify_submit_count,
             SUM(CASE WHEN event_name = 'verify_email_error' THEN 1 ELSE 0 END) AS verify_error_count,
             SUM(CASE WHEN event_name = 'post_create_submit' THEN 1 ELSE 0 END) AS post_submit_count,
             SUM(CASE WHEN event_name = 'post_create_error' THEN 1 ELSE 0 END) AS post_error_count,
             SUM(CASE WHEN event_name = 'signup_success_pending_created' THEN 1 ELSE 0 END) AS signup_pending_count,
             SUM(CASE WHEN event_name = 'login_success' THEN 1 ELSE 0 END) AS login_success_count,
             SUM(CASE WHEN event_name = 'post_create_success' THEN 1 ELSE 0 END) AS post_create_success_count
           FROM ux_events
           ${p0WhereClause}`,
          p0Params
        ),
      ]);

    const verifySuccessCount = Number(p0Base?.verify_success_user_count || 0);
    const firstPost24hCount = Number(p0Base?.first_post_24h_user_count || 0);
    const verifySubmitCount = Number(p0Base?.verify_submit_count || 0);
    const verifyErrorCount = Number(p0Base?.verify_error_count || 0);
    const postSubmitCount = Number(p0Base?.post_submit_count || 0);
    const postErrorCount = Number(p0Base?.post_error_count || 0);

    const firstPost24hRate =
      verifySuccessCount > 0 ? Number(((firstPost24hCount * 100) / verifySuccessCount).toFixed(2)) : 0;
    const verifyEmailFailureRate =
      verifySubmitCount > 0 ? Number(((verifyErrorCount * 100) / verifySubmitCount).toFixed(2)) : 0;
    const postCreateErrorRate =
      postSubmitCount > 0 ? Number(((postErrorCount * 100) / postSubmitCount).toFixed(2)) : 0;

    return res.json({
      ok: true,
      message: 'UX 이벤트 요약을 불러왔습니다.',
      filters: {
        from,
        to,
        event_name: eventName,
        source,
        user_type: userType,
        device_class: deviceClass,
        platform_family: platformFamily,
      },
      summary: {
        total_count: Number(summaryRow?.total_count || 0),
        unique_user_count: Number(summaryRow?.unique_user_count || 0),
        unique_session_count: Number(summaryRow?.unique_session_count || 0),
        anonymous_count: Number(summaryRow?.anonymous_count || 0),
      },
      key_events: {
        signup_success_pending_created_count: Number(p0Base?.signup_pending_count || 0),
        verify_email_success_count: verifySuccessCount,
        login_success_count: Number(p0Base?.login_success_count || 0),
        post_create_success_count: Number(p0Base?.post_create_success_count || 0),
        first_post_created_24h_count: firstPost24hCount,
      },
      p0_metrics: {
        first_post_24h_rate: firstPost24hRate,
        verify_email_failure_rate: verifyEmailFailureRate,
        post_create_error_rate: postCreateErrorRate,
        verified_users: verifySuccessCount,
        first_post_24h_users: firstPost24hCount,
        verify_submit_count: verifySubmitCount,
        verify_error_count: verifyErrorCount,
        post_submit_count: postSubmitCount,
        post_error_count: postErrorCount,
      },
      by_event: byEvent || [],
      by_source: bySource || [],
      by_device: byDevice || [],
      by_platform: byPlatform || [],
      daily: byDay || [],
    });
  } catch (error) {
    console.error('[admin/ux-events/summary] failed:', error);
    return sendAdminError(
      res,
      500,
      'INTERNAL_ERROR',
      'UX 이벤트 요약 조회 중 오류가 발생했습니다.'
    );
  }
});

router.get('/users', async (req, res) => {
  const {
    search = '',
    filter = 'all',
    sort = 'id_desc',
    page = 1,
    limit = 50,
    adminOnly,
  } = req.query;
  const pageNumber = parseBoundedInt(page, 1, 1, 100000) || 1;
  const pageSize = parseBoundedInt(limit, 50, 1, 200) || 50;
  const offset = (pageNumber - 1) * pageSize;
  const params = [];
  const where = [];

  if (search) {
    where.push('(u.name LIKE ? OR u.email LIKE ? OR u.nickname LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term);
  }
  if (filter === 'verified') {
    where.push('COALESCE(u.is_verified,0) = 1');
  } else if (filter === 'unverified') {
    where.push('COALESCE(u.is_verified,0) = 0');
  }
  if (adminOnly === 'true') {
    where.push('u.is_admin = 1');
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortSqlByKey = {
    id: 'u.id ASC',
    id_asc: 'u.id ASC',
    id_desc: 'u.id DESC',
    newest: 'u.id DESC',
    oldest: 'u.id ASC',
    name: 'u.name COLLATE NOCASE ASC, u.id ASC',
    email: 'u.email COLLATE NOCASE ASC, u.id ASC',
    is_verified: 'COALESCE(u.is_verified,0) DESC, u.id DESC',
    verified: 'COALESCE(u.is_verified,0) DESC, u.id DESC',
  };
  const sortSql = sortSqlByKey[sort] || sortSqlByKey.id_desc;

  try {
    const totalRow = await getAsync(`SELECT COUNT(*) AS cnt FROM users u ${whereClause}`, params);
    const rows = await allAsync(
      `SELECT u.id, u.name, u.email, u.nickname, u.is_admin, COALESCE(u.is_verified,0) AS is_verified
       FROM users u ${whereClause}
       ORDER BY ${sortSql}
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    return res.json({
      ok: true,
      message: '회원 목록을 불러왔습니다.',
      users: rows,
      total: totalRow?.cnt || 0,
      page: pageNumber,
      page_size: pageSize,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: '회원 목록 조회 중 오류가 발생했습니다.' });
  }
});

router.delete('/users/:id', (req, res) => {
  const targetUserId = parsePositiveInt(req.params.id);
  if (!targetUserId) {
    return res.status(400).json({ ok: false, message: '잘못된 회원 ID입니다.' });
  }

  purgeUserAccount(targetUserId, { deletePosts: true })
    .then((result) => {
      if (!result.deleted) {
        return res.status(404).json({ ok: false, message: '해당 회원을 찾을 수 없습니다.' });
      }
      return res.json({ ok: true, message: '삭제되었습니다.' });
    })
    .catch((error) => {
      console.error(error);
      return res.status(500).json({ ok: false, message: '회원 삭제 중 오류가 발생했습니다.' });
    });
});

router.get('/posts', async (req, res) => {
  const {
    search = '',
    category = 'all',
    sort = 'recent',
    page = 1,
    range = 'all',
    limit = 48,
  } = req.query;
  const pageSize = Math.min(Math.max(Number(limit) || 48, 1), 200);
  const offset = (Number(page) - 1) * pageSize;
  const where = [];
  const params = [];

  if (search) {
    where.push('(p.title LIKE ? OR u.name LIKE ? OR u.nickname LIKE ? OR u.email LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }
  if (category !== 'all') {
    where.push('p.category = ?');
    params.push(category);
  }
  if (range === '7') {
    where.push("p.created_at >= datetime('now', '-7 day')");
  } else if (range === '30') {
    where.push("p.created_at >= datetime('now', '-30 day')");
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortSql =
    sort === 'oldest' || sort === 'old'
      ? 'p.created_at ASC'
      : sort === 'likes'
      ? 'like_count DESC, p.created_at DESC'
      : 'p.created_at DESC';

  try {
    const totalRow = await getAsync(
      `SELECT COUNT(*) AS cnt FROM posts p JOIN users u ON u.id = p.user_id ${whereClause}`,
      params
    );
    const rows = await allAsync(
      `SELECT p.*, u.name AS author_name, u.nickname AS author_nickname, u.email AS author_email,
        (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count
       FROM posts p
       JOIN users u ON u.id = p.user_id
       ${whereClause}
       ORDER BY ${sortSql}
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    return res.json({
      ok: true,
      message: '글 목록을 불러왔습니다.',
      items: rows,
      total: totalRow?.cnt || 0,
      page: Number(page),
      page_size: pageSize,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: '글 목록 조회 중 오류가 발생했습니다.' });
  }
});

router.get('/posts/:id', async (req, res) => {
  const postId = req.params.id;
  try {
    const row = await getAsync(
      `SELECT p.*, u.name AS author_name, u.nickname AS author_nickname, u.email AS author_email,
        (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE p.id = ?
       LIMIT 1`,
      [postId]
    );

    if (!row) return res.status(404).json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });

    return res.json({ ok: true, message: '글 정보를 불러왔습니다.', post: row });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: '글 조회 중 오류가 발생했습니다.' });
  }
});

router.delete('/posts/:id', async (req, res) => {
  const postId = req.params.id;

  try {
    const verified = await verifyAdminPasswordForDangerAction(req, res);
    if (!verified) return;

    const result = await deleteAdminPost(postId);
    if (!result?.deleted) {
      return res.status(404).json({ ok: false, message: '해당 글을 찾을 수 없습니다.' });
    }

    return res.json({ ok: true, message: '삭제되었습니다.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: '글 삭제 중 오류가 발생했습니다.' });
  }
});

// Quest templates CRUD
router.get('/quest-templates', async (req, res) => {
  try {
    const rows = await allAsync('SELECT * FROM quest_templates ORDER BY id DESC');
    res.json({ ok: true, message: '템플릿 목록을 불러왔습니다.', items: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: '템플릿 조회 중 오류가 발생했습니다.' });
  }
});

router.post('/quest-templates', async (req, res) => {
  const {
    name,
    description,
    condition_type,
    category,
    target_value,
    reward_xp,
    is_active = 1,
    template_kind = 'quest',
    code = null,
    ui_json = null,
  } = req.body;
  if (!name || !condition_type || !target_value) {
    return res.status(400).json({ ok: false, message: '필수 입력이 누락되었습니다.' });
  }
  const templateValidation = validateQuestTemplatePayload({
    conditionType: condition_type,
    uiJson: ui_json,
    targetValue: target_value,
  });
  if (templateValidation.error) {
    return res.status(400).json({ ok: false, message: templateValidation.error });
  }
  const normalizedTemplateKind = String(template_kind || 'quest').toLowerCase();
  let createdTemplateId = null;
  try {
    const result = await runAsync(
      `INSERT INTO quest_templates (name, description, condition_type, category, target_value, reward_xp, is_active, template_kind, code, ui_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        description || '',
        condition_type,
        category || null,
        Number(target_value),
        Number(reward_xp) || 0,
        is_active ? 1 : 0,
        normalizedTemplateKind || 'quest',
        code,
        templateValidation.uiJson,
      ]
    );
    createdTemplateId = result?.lastID || null;
    let campaignId = null;
    let backfillResult = null;
    if (normalizedTemplateKind === 'achievement') {
      campaignId = await ensureAchievementCampaign();
      await ensureCampaignItem(campaignId, createdTemplateId);
      backfillResult = await backfillAchievementTemplate(campaignId, createdTemplateId);
      await recordOperationalAlert({
        domain: 'growth',
        level: 'info',
        code: 'ACHIEVEMENT_TEMPLATE_PUBLISHED',
        title: '업적 템플릿이 게시되었습니다.',
        message: `"${name}" 업적이 상시 업적 캠페인에 연결되었습니다.`,
        context: {
          template_id: createdTemplateId,
          campaign_id: campaignId,
          code,
          backfilled_count: Number(backfillResult?.changes || 0),
        },
        dedupeKey: `growth:achievement-template:${createdTemplateId}:published`,
        createdByAdminId: req.user?.id || null,
      });
    }
    res.json({
      ok: true,
      message: '템플릿이 생성되었습니다.',
      template_id: createdTemplateId,
      campaign_id: campaignId,
      backfilled_count: Number(backfillResult?.changes || 0),
    });
  } catch (err) {
    console.error(err);
    if (normalizedTemplateKind === 'achievement') {
      await recordOperationalAlert({
        domain: 'growth',
        level: 'error',
        code: 'ACHIEVEMENT_TEMPLATE_PUBLISH_FAILED',
        title: '업적 템플릿 게시에 실패했습니다.',
        message: `"${name}" 업적 생성 중 캠페인 연결 또는 백필 단계에서 오류가 발생했습니다.`,
        context: {
          template_id: createdTemplateId,
          code,
          error: err?.message || String(err),
        },
        dedupeKey: `growth:achievement-template:${createdTemplateId || code || name}:publish-failed`,
        createdByAdminId: req.user?.id || null,
        notifyAdmins: true,
      });
    }
    res.status(500).json({ ok: false, message: '템플릿 생성 중 오류가 발생했습니다.' });
  }
});

router.put('/quest-templates/:id', async (req, res) => {
  const {
    name,
    description,
    condition_type,
    category,
    target_value,
    reward_xp,
    is_active = 1,
    template_kind = 'quest',
    code = null,
    ui_json = null,
  } = req.body;
  const templateId = req.params.id;
  if (!name || !condition_type || !target_value) {
    return res.status(400).json({ ok: false, message: '필수 입력이 누락되었습니다.' });
  }
  const templateValidation = validateQuestTemplatePayload({
    conditionType: condition_type,
    uiJson: ui_json,
    targetValue: target_value,
  });
  if (templateValidation.error) {
    return res.status(400).json({ ok: false, message: templateValidation.error });
  }
  const normalizedTemplateKind = String(template_kind || 'quest').toLowerCase();
  try {
    const previous = await getAsync(
      'SELECT template_kind FROM quest_templates WHERE id = ?',
      [templateId]
    );
    const previousKind = String(previous?.template_kind || 'quest').toLowerCase();
    await runAsync(
      `UPDATE quest_templates
       SET name=?, description=?, condition_type=?, category=?, target_value=?, reward_xp=?, is_active=?, template_kind=?, code=?, ui_json=?
       WHERE id=?`,
      [
        name,
        description || '',
        condition_type,
        category || null,
        Number(target_value),
        Number(reward_xp) || 0,
        is_active ? 1 : 0,
        normalizedTemplateKind || 'quest',
        code,
        templateValidation.uiJson,
        templateId,
      ]
    );
    if (normalizedTemplateKind === 'achievement') {
      const campaignId = await ensureAchievementCampaign();
      await ensureCampaignItem(campaignId, templateId);
      const backfillResult = await backfillAchievementTemplate(campaignId, templateId);
      await recordOperationalAlert({
        domain: 'growth',
        level: 'info',
        code:
          previousKind === 'achievement'
            ? 'ACHIEVEMENT_TEMPLATE_UPDATED'
            : 'ACHIEVEMENT_TEMPLATE_PROMOTED',
        title:
          previousKind === 'achievement'
            ? '업적 템플릿이 수정되었습니다.'
            : '템플릿이 업적으로 전환되었습니다.',
        message: `"${name}" 템플릿이 업적 캠페인에 연결되어 있습니다.`,
        context: {
          template_id: Number(templateId),
          campaign_id: campaignId,
          code,
          previous_kind: previousKind,
          backfilled_count: Number(backfillResult?.changes || 0),
        },
        dedupeKey: `growth:achievement-template:${templateId}:updated`,
        createdByAdminId: req.user?.id || null,
      });
    } else if (previousKind === 'achievement') {
      const campaignId = await getAchievementCampaignId();
      await removeCampaignItem(campaignId, templateId);
      await recordOperationalAlert({
        domain: 'growth',
        level: 'warn',
        code: 'ACHIEVEMENT_TEMPLATE_UNLINKED_BY_KIND_CHANGE',
        title: '업적 템플릿 연결이 해제되었습니다.',
        message: `"${name}" 템플릿이 업적이 아닌 유형으로 변경되어 업적 캠페인에서 제외되었습니다.`,
        context: {
          template_id: Number(templateId),
          campaign_id: campaignId,
          code,
          next_kind: normalizedTemplateKind,
        },
        dedupeKey: `growth:achievement-template:${templateId}:kind-unlinked`,
        createdByAdminId: req.user?.id || null,
      });
    }
    res.json({ ok: true, message: '템플릿이 수정되었습니다.' });
  } catch (err) {
    console.error(err);
    if (normalizedTemplateKind === 'achievement') {
      await recordOperationalAlert({
        domain: 'growth',
        level: 'error',
        code: 'ACHIEVEMENT_TEMPLATE_UPDATE_FAILED',
        title: '업적 템플릿 수정에 실패했습니다.',
        message: `"${name}" 업적 수정 중 캠페인 연결 또는 백필 단계에서 오류가 발생했습니다.`,
        context: {
          template_id: Number(templateId),
          code,
          error: err?.message || String(err),
        },
        dedupeKey: `growth:achievement-template:${templateId}:update-failed`,
        createdByAdminId: req.user?.id || null,
        notifyAdmins: true,
      });
    }
    res.status(500).json({ ok: false, message: '템플릿 수정 중 오류가 발생했습니다.' });
  }
});

router.delete('/quest-templates/:id', async (req, res) => {
  const templateId = parsePositiveInt(req.params.id);
  if (!templateId) {
    return sendAdminError(res, 400, 'INVALID_REQUEST', 'template id가 올바르지 않습니다.');
  }

  let previous = null;
  try {
    await runAsync('BEGIN IMMEDIATE;');
    previous = await getAsync('SELECT * FROM quest_templates WHERE id = ? LIMIT 1', [templateId]);
    if (!previous) {
      await runAsync('ROLLBACK;');
      return sendAdminError(res, 404, 'RESOURCE_NOT_FOUND', '템플릿을 찾을 수 없습니다.');
    }

    await runAsync('DELETE FROM quest_post_submissions WHERE template_id = ?', [templateId]);
    await runAsync('DELETE FROM user_quest_state WHERE template_id = ?', [templateId]);
    await runAsync('DELETE FROM quest_campaign_items WHERE template_id = ?', [templateId]);
    await runAsync('DELETE FROM quest_templates WHERE id = ?', [templateId]);
    await runAsync('COMMIT;');

    if (String(previous?.template_kind || '').toLowerCase() === 'achievement') {
      await recordOperationalAlert({
        domain: 'growth',
        level: 'warn',
        code: 'ACHIEVEMENT_TEMPLATE_DELETED',
        title: '업적 템플릿이 삭제되었습니다.',
        message: `"${previous.name}" 업적 템플릿과 캠페인 연결이 삭제되었습니다.`,
        context: {
          template_id: templateId,
          code: previous.code || null,
        },
        dedupeKey: `growth:achievement-template:${templateId}:deleted`,
        createdByAdminId: req.user?.id || null,
      });
    }
    res.json({ ok: true, message: '템플릿이 삭제되었습니다.' });
  } catch (err) {
    await rollbackAdminTransactionQuietly('quest template delete');
    console.error(err);
    res.status(500).json({ ok: false, message: '템플릿 삭제 중 오류가 발생했습니다.' });
  }
});

router.post('/quests/achievements/backfill', async (req, res) => {
  try {
    const campaignId = await ensureAchievementCampaign();
    const result = await backfillAllAchievements(campaignId);
    await recordOperationalAlert({
      domain: 'growth',
      level: 'info',
      code: 'ACHIEVEMENT_BACKFILL_COMPLETED',
      title: '업적 전체 유저 부여가 완료되었습니다.',
      message: `업적 상태 ${Number(result?.changes || 0)}건을 새로 부여했습니다.`,
      context: {
        campaign_id: campaignId,
        inserted_count: Number(result?.changes || 0),
      },
      createdByAdminId: req.user?.id || null,
    });
    res.json({ ok: true, inserted: result?.changes || 0, campaign_id: campaignId });
  } catch (err) {
    console.error(err);
    await recordOperationalAlert({
      domain: 'growth',
      level: 'error',
      code: 'ACHIEVEMENT_BACKFILL_FAILED',
      title: '업적 전체 유저 부여에 실패했습니다.',
      message: '업적 백필 중 오류가 발생했습니다. 원격 서버 로그와 DB 상태를 확인하세요.',
      context: {
        error: err?.message || String(err),
      },
      dedupeKey: 'growth:achievement-backfill:failed',
      createdByAdminId: req.user?.id || null,
      notifyAdmins: true,
    });
    res.status(500).json({ ok: false, message: '업적 backfill 중 오류가 발생했습니다.' });
  }
});

router.post('/quests/auto-claim-expired-rewards', async (req, res) => {
  const rawLimit = req.body?.limit ?? req.query?.limit;
  const limit = parseBoundedInt(rawLimit, 100, 1, 500);
  if (limit === null) {
    return sendAdminError(res, 400, 'INVALID_REQUEST', 'limit은 1 이상 500 이하의 숫자여야 합니다.');
  }

  const dryRun = parseBooleanFlag(req.body?.dry_run ?? req.body?.dryRun ?? req.query?.dry_run);

  try {
    const result = await autoClaimExpiredQuestRewards({ limit, dryRun });

    if (!dryRun && result.claimed_count > 0) {
      await recordOperationalAlert({
        domain: 'growth',
        level: 'info',
        code: 'EXPIRED_QUEST_REWARDS_AUTO_CLAIMED',
        title: '종료된 시즌/이벤트 퀘스트 보상이 자동 수령되었습니다.',
        message: `미수령 완료 보상 ${result.claimed_count}건을 자동 수령 처리했습니다.`,
        context: {
          claimed_count: result.claimed_count,
          skipped_count: result.skipped_count,
          limit,
        },
        createdByAdminId: req.user?.id || null,
      });
    }

    return res.json({
      ok: true,
      message: dryRun
        ? '자동 수령 대상 퀘스트 보상을 확인했습니다.'
        : '종료된 시즌/이벤트 퀘스트 보상 자동 수령을 처리했습니다.',
      ...result,
    });
  } catch (error) {
    console.error('[admin/quests/auto-claim-expired-rewards] failed:', error);
    await recordOperationalAlert({
      domain: 'growth',
      level: 'error',
      code: 'EXPIRED_QUEST_REWARDS_AUTO_CLAIM_FAILED',
      title: '종료된 퀘스트 보상 자동 수령에 실패했습니다.',
      message: '종료된 시즌/이벤트의 미수령 완료 보상 처리 중 오류가 발생했습니다.',
      context: {
        error: error?.message || String(error),
        limit,
        dry_run: dryRun,
      },
      dedupeKey: 'growth:expired-quest-rewards:auto-claim:failed',
      createdByAdminId: req.user?.id || null,
      notifyAdmins: true,
    });
    return sendAdminError(res, 500, 'INTERNAL_ERROR', '퀘스트 보상 자동 수령 중 오류가 발생했습니다.');
  }
});

// Campaigns
router.get('/quest-campaigns', async (req, res) => {
  try {
    const campaigns = await allAsync('SELECT * FROM quest_campaigns ORDER BY priority DESC, id DESC');
    const items = await allAsync(
      `SELECT qci.*, qt.name AS template_name FROM quest_campaign_items qci
       JOIN quest_templates qt ON qt.id = qci.template_id`
    );
    res.json({
      ok: true,
      message: '캠페인 목록을 불러왔습니다.',
      items: campaigns,
      campaign_items: items,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: '캠페인 조회 중 오류가 발생했습니다.' });
  }
});

router.post('/quest-campaigns', async (req, res) => {
  const { name, description, campaign_type = 'event', start_at, end_at, is_active = 0, priority = 1 } = req.body;
  if (!name) return res.status(400).json({ ok: false, message: '캠페인 이름이 필요합니다.' });
  const normalizedCampaignType = String(campaign_type || 'event').toLowerCase();
  const allowedCampaignTypes = new Set(['permanent', 'daily', 'weekly', 'season', 'event']);
  if (!allowedCampaignTypes.has(normalizedCampaignType)) {
    return res.status(400).json({ ok: false, message: '허용되지 않는 campaign_type입니다.' });
  }
  try {
    const result = await runAsync(
      `INSERT INTO quest_campaigns (name, description, campaign_type, start_at, end_at, is_active, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, description || '', normalizedCampaignType, start_at || null, end_at || null, is_active ? 1 : 0, Number(priority) || 1]
    );
    const campaignId = result?.lastID || null;
    await recordOperationalAlert({
      domain: 'campaign',
      level: is_active ? 'warn' : 'info',
      code: 'QUEST_CAMPAIGN_CREATED',
      title: '퀘스트 캠페인이 생성되었습니다.',
      message: is_active
        ? `"${name}" 캠페인이 활성 상태로 생성되었습니다. 템플릿 연결 상태를 확인하세요.`
        : `"${name}" 캠페인이 생성되었습니다.`,
      context: {
        campaign_id: campaignId,
        campaign_type: normalizedCampaignType,
        is_active: Boolean(is_active),
      },
      dedupeKey: `growth:campaign:${campaignId}:created`,
      createdByAdminId: req.user?.id || null,
    });
    res.json({ ok: true, message: '캠페인이 생성되었습니다.', campaign_id: campaignId });
  } catch (err) {
    console.error(err);
    await recordOperationalAlert({
      domain: 'campaign',
      level: 'error',
      code: 'QUEST_CAMPAIGN_CREATE_FAILED',
      title: '퀘스트 캠페인 생성에 실패했습니다.',
      message: `"${name || '이름 없음'}" 캠페인 생성 중 오류가 발생했습니다.`,
      context: {
        campaign_type: normalizedCampaignType,
        error: err?.message || String(err),
      },
      dedupeKey: `growth:campaign:${name || 'unknown'}:create-failed`,
      createdByAdminId: req.user?.id || null,
      notifyAdmins: true,
    });
    res.status(500).json({ ok: false, message: '캠페인 생성 중 오류가 발생했습니다.' });
  }
});

router.put('/quest-campaigns/:id', async (req, res) => {
  const { name, description, campaign_type = 'event', start_at, end_at, is_active = 0, priority = 1 } = req.body;
  const campaignId = req.params.id;
  const normalizedCampaignType = String(campaign_type || 'event').toLowerCase();
  const allowedCampaignTypes = new Set(['permanent', 'daily', 'weekly', 'season', 'event']);
  if (!allowedCampaignTypes.has(normalizedCampaignType)) {
    return res.status(400).json({ ok: false, message: '허용되지 않는 campaign_type입니다.' });
  }
  try {
    await runAsync(
      `UPDATE quest_campaigns SET name=?, description=?, campaign_type=?, start_at=?, end_at=?, is_active=?, priority=? WHERE id=?`,
      [name, description || '', normalizedCampaignType, start_at || null, end_at || null, is_active ? 1 : 0, Number(priority) || 1, campaignId]
    );
    await recordOperationalAlert({
      domain: 'campaign',
      level: 'info',
      code: 'QUEST_CAMPAIGN_UPDATED',
      title: '퀘스트 캠페인이 수정되었습니다.',
      message: `"${name}" 캠페인 설정이 저장되었습니다.`,
      context: {
        campaign_id: Number(campaignId),
        campaign_type: normalizedCampaignType,
        is_active: Boolean(is_active),
      },
      dedupeKey: `growth:campaign:${campaignId}:updated`,
      createdByAdminId: req.user?.id || null,
    });
    res.json({ ok: true, message: '캠페인이 수정되었습니다.' });
  } catch (err) {
    console.error(err);
    await recordOperationalAlert({
      domain: 'campaign',
      level: 'error',
      code: 'QUEST_CAMPAIGN_UPDATE_FAILED',
      title: '퀘스트 캠페인 수정에 실패했습니다.',
      message: `"${name || campaignId}" 캠페인 수정 중 오류가 발생했습니다.`,
      context: {
        campaign_id: Number(campaignId),
        campaign_type: normalizedCampaignType,
        error: err?.message || String(err),
      },
      dedupeKey: `growth:campaign:${campaignId}:update-failed`,
      createdByAdminId: req.user?.id || null,
      notifyAdmins: true,
    });
    res.status(500).json({ ok: false, message: '캠페인 수정 중 오류가 발생했습니다.' });
  }
});

router.delete('/quest-campaigns/:id', async (req, res) => {
  const campaignId = parsePositiveInt(req.params.id);
  if (!campaignId) {
    return sendAdminError(res, 400, 'INVALID_REQUEST', 'campaign id가 올바르지 않습니다.');
  }

  let previous = null;
  try {
    await runAsync('BEGIN IMMEDIATE;');
    previous = await getAsync('SELECT * FROM quest_campaigns WHERE id = ? LIMIT 1', [campaignId]);
    if (!previous) {
      await runAsync('ROLLBACK;');
      return sendAdminError(res, 404, 'RESOURCE_NOT_FOUND', '캠페인을 찾을 수 없습니다.');
    }

    await runAsync('DELETE FROM quest_post_submissions WHERE campaign_id = ?', [campaignId]);
    await runAsync('DELETE FROM user_quest_state WHERE campaign_id = ?', [campaignId]);
    await runAsync('DELETE FROM quest_campaign_items WHERE campaign_id = ?', [campaignId]);
    await runAsync('DELETE FROM quest_campaigns WHERE id = ?', [campaignId]);
    await runAsync('COMMIT;');

    await recordOperationalAlert({
      domain: 'campaign',
      level: 'warn',
      code: 'QUEST_CAMPAIGN_DELETED',
      title: '퀘스트 캠페인이 삭제되었습니다.',
      message: `"${previous?.name || campaignId}" 캠페인과 사용자 진행 상태가 삭제되었습니다.`,
      context: {
        campaign_id: campaignId,
        campaign_type: previous?.campaign_type || null,
      },
      dedupeKey: `growth:campaign:${campaignId}:deleted`,
      createdByAdminId: req.user?.id || null,
    });
    res.json({ ok: true, message: '캠페인이 삭제되었습니다.' });
  } catch (err) {
    await rollbackAdminTransactionQuietly('quest campaign delete');
    console.error(err);
    await recordOperationalAlert({
      domain: 'campaign',
      level: 'error',
      code: 'QUEST_CAMPAIGN_DELETE_FAILED',
      title: '퀘스트 캠페인 삭제에 실패했습니다.',
      message: `${campaignId} 캠페인 삭제 중 오류가 발생했습니다.`,
      context: {
        campaign_id: campaignId,
        error: err?.message || String(err),
      },
      dedupeKey: `growth:campaign:${campaignId}:delete-failed`,
      createdByAdminId: req.user?.id || null,
      notifyAdmins: true,
    });
    res.status(500).json({ ok: false, message: '캠페인 삭제 중 오류가 발생했습니다.' });
  }
});

router.put('/quest-campaigns/:id/items', async (req, res) => {
  const { items } = req.body;
  const campaignId = req.params.id;
  if (!Array.isArray(items)) return res.status(400).json({ ok: false, message: 'items 배열이 필요합니다.' });
  try {
    await runAsync('DELETE FROM quest_campaign_items WHERE campaign_id = ?', [campaignId]);
    for (const item of items) {
      await runAsync(
        `INSERT INTO quest_campaign_items (campaign_id, template_id, sort_order) VALUES (?, ?, ?)` ,
        [campaignId, item.template_id, item.sort_order || 0]
      );
    }
    const campaign = await getAsync('SELECT name, is_active FROM quest_campaigns WHERE id = ? LIMIT 1', [
      campaignId,
    ]);
    await recordOperationalAlert({
      domain: 'campaign',
      level: campaign?.is_active && items.length === 0 ? 'warn' : 'info',
      code: items.length === 0 ? 'QUEST_CAMPAIGN_ITEMS_EMPTY' : 'QUEST_CAMPAIGN_ITEMS_SAVED',
      title: items.length === 0 ? '캠페인 템플릿 연결이 비어 있습니다.' : '캠페인 템플릿 연결이 저장되었습니다.',
      message:
        items.length === 0
          ? `"${campaign?.name || campaignId}" 캠페인에 연결된 템플릿이 없습니다.`
          : `"${campaign?.name || campaignId}" 캠페인에 템플릿 ${items.length}개를 연결했습니다.`,
      context: {
        campaign_id: Number(campaignId),
        item_count: items.length,
        template_ids: items.map((item) => Number(item.template_id)).filter(Number.isFinite),
      },
      dedupeKey: `growth:campaign:${campaignId}:items`,
      createdByAdminId: req.user?.id || null,
    });
    res.json({ ok: true, message: '캠페인 템플릿이 저장되었습니다.' });
  } catch (err) {
    console.error(err);
    await recordOperationalAlert({
      domain: 'campaign',
      level: 'error',
      code: 'QUEST_CAMPAIGN_ITEMS_SAVE_FAILED',
      title: '캠페인 템플릿 연결 저장에 실패했습니다.',
      message: `${campaignId} 캠페인의 템플릿 연결 저장 중 오류가 발생했습니다.`,
      context: {
        campaign_id: Number(campaignId),
        error: err?.message || String(err),
      },
      dedupeKey: `growth:campaign:${campaignId}:items-failed`,
      createdByAdminId: req.user?.id || null,
      notifyAdmins: true,
    });
    res.status(500).json({ ok: false, message: '캠페인 템플릿 저장 중 오류가 발생했습니다.' });
  }
});

// 네임스페이스 내부 미정의 라우트는 JSON 404로 안내
router.use((req, res) => {
  return res.status(404).json({ ok: false, message: `Unknown admin route: ${req.method} ${req.originalUrl}` });
});

module.exports = router;
