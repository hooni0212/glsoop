const express = require('express');
const { LEGAL_CONFIG } = require('../config');
const { authRequired, adminRequired } = require('../middleware/auth');
const { allAsync, getAsync, runAsync } = require('../utils/questService');
const { toPositiveInt } = require('../utils/activityEvents');
const { getIpHashFromRequest, getUserAgent } = require('../utils/authSession');

const router = express.Router();

const V1_EVENT_TYPES = new Set(['post_liked', 'comment_created', 'comment_replied', 'system']);

function sendNotificationError(res, status, code, message) {
  return res.status(status).json({ ok: false, code, message });
}

function parsePagination(query = {}) {
  const requestedLimit = Number.parseInt(query.limit, 10);
  const requestedOffset = Number.parseInt(query.offset, 10);
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 50)
      : 30;
  const offset = Number.isFinite(requestedOffset) && requestedOffset > 0 ? requestedOffset : 0;
  return { limit, offset };
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
}

function parseOptionalBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return parseBoolean(value);
}

function isBooleanLike(value) {
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return value === 0 || value === 1;
  if (typeof value !== 'string') return false;
  return ['0', '1', 'true', 'false', 'yes', 'no', 'y', 'n', 'on', 'off'].includes(
    value.trim().toLowerCase()
  );
}

function parseMeta(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeNullableText(value, maxLength = 500) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function normalizeInternalTargetPath(value) {
  const trimmed = normalizeNullableText(value, 1200);
  if (!trimmed) return '/';
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/';
  if (trimmed.startsWith('/(auth)')) return '/';
  return trimmed;
}

function getMarketingVersion() {
  return LEGAL_CONFIG?.versions?.marketing || '';
}

function stripAdLabel(value) {
  return String(value || '').replace(/^\(광고\)\s*/u, '').trim();
}

function normalizeMarketingTitle(value, options = {}) {
  const raw = normalizeNullableText(value, 80);
  if (!raw) return null;
  const title = stripAdLabel(raw);
  if (!title) return null;
  return options.includeAdLabel === false ? title : `(광고) ${title}`;
}

function serializeMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  try {
    return JSON.stringify(meta);
  } catch {
    return null;
  }
}

function normalizeOptionalJsonPayload(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return serializeMeta(parsed) || null;
    } catch {
      return trimmed.slice(0, 2000);
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return serializeMeta(value);
  }
  return null;
}

function toTimestamp(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

async function fetchMarketingPushRecipientRows() {
  return allAsync(
    `
    SELECT
      u.id AS user_id,
      pt.id AS push_token_id
    FROM users u
    JOIN push_tokens pt ON pt.user_id = u.id
    WHERE COALESCE(u.marketing_push_opt_in, 0) = 1
      AND COALESCE(u.account_status, 'active') = 'active'
      AND pt.enabled = 1
    ORDER BY u.id ASC, pt.last_seen_at DESC, pt.id DESC
    `
  );
}

function buildMarketingPushAudienceSummary(recipientRows) {
  const rows = Array.isArray(recipientRows) ? recipientRows : [];
  const uniqueUsers = new Set(rows.map((row) => row.user_id));
  return {
    eligible_user_count: uniqueUsers.size,
    eligible_token_count: rows.length,
  };
}

function parseAdminListLimit(value, fallback = 30, max = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function normalizePushDeliveryStatus(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ['queued', 'sent', 'failed', 'skipped'].includes(normalized) ? normalized : null;
}

function buildPushDeliverySummary(rows) {
  const summary = {
    total_count: 0,
    queued_count: 0,
    sent_count: 0,
    failed_count: 0,
    skipped_count: 0,
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    const count = Number(row.cnt || 0);
    summary.total_count += count;
    if (row.status === 'queued') summary.queued_count = count;
    if (row.status === 'sent') summary.sent_count = count;
    if (row.status === 'failed') summary.failed_count = count;
    if (row.status === 'skipped') summary.skipped_count = count;
  }

  return summary;
}

function isV1NotificationRow(row) {
  if (!row || !V1_EVENT_TYPES.has(row.event_type)) return false;
  if (row.event_type === 'system') {
    const notificationType = parseMeta(row.meta_json).notification_type;
    return (
      notificationType === 'following_new_post' ||
      notificationType === 'new_follower' ||
      notificationType === 'admin_operational_alert'
    );
  }
  return row.event_type === 'post_liked' || row.event_type === 'comment_created' || row.event_type === 'comment_replied';
}

function buildPostReactionNotification(rows) {
  const sorted = [...rows].sort((a, b) => toTimestamp(b.created_at) - toTimestamp(a.created_at) || Number(b.id) - Number(a.id));
  const latest = sorted[0];
  const actorCount = sorted.length;
  const postTitle = latest.post_title || null;
  const hasUnread = sorted.some((row) => !row.read_at);

  return {
    id: `post_reaction:${latest.post_id}`,
    type: 'post_reaction',
    title: `${actorCount}명이 내 글에 공감했어요.`,
    body: postTitle ? `"${postTitle}"` : '내 글에 새 공감이 있어요.',
    created_at: latest.created_at,
    read_at: hasUnread ? null : latest.read_at || latest.created_at,
    target_path: `/posts/${latest.post_id}`,
    post_id: latest.post_id,
    comment_id: null,
    user_id: latest.actor_user_id || null,
    actor_count: actorCount,
  };
}

function buildSingleNotification(row) {
  const meta = parseMeta(row.meta_json);
  if (row.event_type === 'comment_created') {
    return {
      id: String(row.id),
      type: 'post_comment',
      title: row.title || '새 댓글이 도착했어요',
      body: row.body || '내 글에 새 댓글이 달렸어요.',
      created_at: row.created_at,
      read_at: row.read_at || null,
      target_path: `/posts/${row.post_id}`,
      post_id: row.post_id || null,
      comment_id: row.comment_id || null,
      user_id: row.actor_user_id || null,
      actor_count: 1,
    };
  }

  if (row.event_type === 'comment_replied') {
    return {
      id: String(row.id),
      type: 'comment_reply',
      title: row.title || '새 답글이 도착했어요',
      body: row.body || '내 댓글에 새 답글이 달렸어요.',
      created_at: row.created_at,
      read_at: row.read_at || null,
      target_path: `/posts/${row.post_id}`,
      post_id: row.post_id || null,
      comment_id: row.comment_id || null,
      user_id: row.actor_user_id || null,
      actor_count: 1,
    };
  }

  if (row.event_type === 'system' && meta.notification_type === 'following_new_post') {
    return {
      id: String(row.id),
      type: 'following_new_post',
      title: row.title || '팔로잉한 작가의 새 글이 올라왔어요',
      body: row.body || '새 글을 읽어보세요.',
      created_at: row.created_at,
      read_at: row.read_at || null,
      target_path: meta.target_path || `/posts/${row.post_id}`,
      post_id: row.post_id || null,
      comment_id: null,
      user_id: row.actor_user_id || null,
      actor_count: 1,
    };
  }

  if (row.event_type === 'system' && meta.notification_type === 'new_follower') {
    return {
      id: String(row.id),
      type: 'new_follower',
      title: row.title || '새 독자가 생겼어요',
      body: row.body || '새로운 독자가 나를 팔로우했어요.',
      created_at: row.created_at,
      read_at: row.read_at || null,
      target_path: `/users/${row.actor_user_id}`,
      post_id: null,
      comment_id: null,
      user_id: row.actor_user_id || null,
      actor_count: 1,
    };
  }

  if (row.event_type === 'system' && meta.notification_type === 'admin_operational_alert') {
    return {
      id: String(row.id),
      type: 'admin_operational_alert',
      title: row.title || '운영 알림',
      body: row.body || '확인할 운영 알림이 있습니다.',
      created_at: row.created_at,
      read_at: row.read_at || null,
      target_path: meta.target_path || '/notifications',
      post_id: null,
      comment_id: null,
      user_id: null,
      actor_count: 1,
    };
  }

  return null;
}

function buildNotifications(rows) {
  const groups = new Map();
  const items = [];

  for (const row of rows || []) {
    if (!isV1NotificationRow(row)) continue;
    if (row.event_type === 'post_liked' && row.post_id) {
      const key = String(row.post_id);
      const current = groups.get(key) || [];
      current.push(row);
      groups.set(key, current);
      continue;
    }

    const item = buildSingleNotification(row);
    if (item) items.push(item);
  }

  for (const groupRows of groups.values()) {
    items.push(buildPostReactionNotification(groupRows));
  }

  return items.sort(
    (a, b) => toTimestamp(b.created_at) - toTimestamp(a.created_at) || String(b.id).localeCompare(String(a.id))
  );
}

async function fetchNotificationRows(userId) {
  return allAsync(
    `
    SELECT
      ae.*,
      p.title AS post_title
    FROM activity_events ae
    LEFT JOIN posts p ON p.id = ae.post_id
    WHERE ae.recipient_user_id = ?
      AND ae.event_type IN ('post_liked', 'comment_created', 'comment_replied', 'system')
      AND NOT EXISTS (
        SELECT 1
        FROM user_blocks ub
        WHERE ae.actor_user_id IS NOT NULL
          AND (
            (ub.blocker_id = ae.recipient_user_id AND ub.blocked_user_id = ae.actor_user_id)
            OR (ub.blocker_id = ae.actor_user_id AND ub.blocked_user_id = ae.recipient_user_id)
          )
      )
    ORDER BY ae.created_at DESC, ae.id DESC
    `,
    [userId]
  );
}

router.get('/notifications', authRequired, async (req, res) => {
  const userId = toPositiveInt(req.user.id);
  const { limit, offset } = parsePagination(req.query || {});

  try {
    const rows = await fetchNotificationRows(userId);
    const allNotifications = buildNotifications(rows);
    const notifications = allNotifications.slice(offset, offset + limit);
    const unreadCount = allNotifications.filter((item) => !item.read_at).length;

    return res.json({
      ok: true,
      message: '알림을 불러왔습니다.',
      notifications,
      unread_count: unreadCount,
      has_more: offset + notifications.length < allNotifications.length,
      pagination: {
        limit,
        offset,
        total: allNotifications.length,
        has_more: offset + notifications.length < allNotifications.length,
      },
    });
  } catch (error) {
    console.error('[notifications/list] failed:', error);
    return sendNotificationError(res, 500, 'INTERNAL_ERROR', '알림 조회 중 오류가 발생했습니다.');
  }
});

router.patch('/notifications/:notificationId/read', authRequired, async (req, res) => {
  const userId = toPositiveInt(req.user.id);
  const notificationId = String(req.params.notificationId || '').trim();

  if (!notificationId) {
    return sendNotificationError(res, 400, 'INVALID_REQUEST', '잘못된 알림 ID입니다.');
  }

  try {
    let result;
    const reactionMatch = /^post_reaction:(\d+)$/.exec(notificationId);
    if (reactionMatch) {
      result = await runAsync(
        `
        UPDATE activity_events
        SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
        WHERE recipient_user_id = ?
          AND event_type = 'post_liked'
          AND post_id = ?
        `,
        [userId, Number(reactionMatch[1])]
      );
    } else {
      const activityId = toPositiveInt(notificationId);
      if (!activityId) {
        return sendNotificationError(res, 400, 'INVALID_REQUEST', '잘못된 알림 ID입니다.');
      }

      result = await runAsync(
        `
        UPDATE activity_events
        SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
        WHERE id = ?
          AND recipient_user_id = ?
        `,
        [activityId, userId]
      );
    }

    if (result.changes <= 0) {
      return sendNotificationError(res, 404, 'RESOURCE_NOT_FOUND', '알림을 찾을 수 없습니다.');
    }

    return res.json({
      ok: true,
      message: '알림을 읽음 처리했습니다.',
    });
  } catch (error) {
    console.error('[notifications/read] failed:', error);
    return sendNotificationError(res, 500, 'INTERNAL_ERROR', '알림 읽음 처리 중 오류가 발생했습니다.');
  }
});

router.get('/marketing-push-consent', authRequired, async (req, res) => {
  const userId = toPositiveInt(req.user.id);

  try {
    const row = await getAsync(
      `
      SELECT
        COALESCE(marketing_push_opt_in, 0) AS marketing_push_opt_in,
        marketing_push_opt_in_updated_at
      FROM users
      WHERE id = ?
      LIMIT 1
      `,
      [userId]
    );

    if (!row) {
      return sendNotificationError(res, 404, 'RESOURCE_NOT_FOUND', '사용자를 찾을 수 없습니다.');
    }

    return res.json({
      ok: true,
      consent: {
        marketing_push_opt_in: Number(row.marketing_push_opt_in) === 1,
        marketing_version: getMarketingVersion(),
        updated_at: row.marketing_push_opt_in_updated_at || null,
      },
    });
  } catch (error) {
    console.error('[marketing-push-consent/get] failed:', error);
    return sendNotificationError(
      res,
      500,
      'INTERNAL_ERROR',
      '마케팅 알림 수신 동의 조회 중 오류가 발생했습니다.'
    );
  }
});

router.patch('/marketing-push-consent', authRequired, async (req, res) => {
  const userId = toPositiveInt(req.user.id);
  if (!isBooleanLike(req.body?.marketing_push_opt_in)) {
    return sendNotificationError(
      res,
      400,
      'INVALID_REQUEST',
      'marketing_push_opt_in 값이 올바르지 않습니다.'
    );
  }

  const nextOptIn = parseBoolean(req.body?.marketing_push_opt_in);
  const requestedVersion = normalizeNullableText(req.body?.marketing_version, 120) || getMarketingVersion();
  const currentVersion = getMarketingVersion();

  if (requestedVersion !== currentVersion) {
    return sendNotificationError(
      res,
      409,
      'LEGAL_VERSION_MISMATCH',
      '마케팅 동의 문서 버전이 변경되었습니다. 다시 시도해주세요.'
    );
  }

  try {
    await runAsync('BEGIN IMMEDIATE');
    try {
      const nowSql = new Date().toISOString();
      await runAsync(
        `
        UPDATE users
        SET marketing_push_opt_in = ?,
            marketing_push_opt_in_updated_at = ?
        WHERE id = ?
        `,
        [nextOptIn ? 1 : 0, nowSql, userId]
      );

      await runAsync(
        `
        INSERT INTO marketing_push_consent_events (
          user_id,
          marketing_version,
          is_granted,
          source,
          ip_hash,
          user_agent,
          created_at
        )
        VALUES (?, ?, ?, 'settings', ?, ?, ?)
        `,
        [
          userId,
          currentVersion,
          nextOptIn ? 1 : 0,
          getIpHashFromRequest(req),
          getUserAgent(req),
          nowSql,
        ]
      );

      await runAsync('COMMIT');
      return res.json({
        ok: true,
        message: nextOptIn
          ? '마케팅 알림 수신에 동의했습니다.'
          : '마케팅 알림 수신 동의를 철회했습니다.',
        consent: {
          marketing_push_opt_in: nextOptIn,
          marketing_version: currentVersion,
          updated_at: nowSql,
        },
      });
    } catch (transactionError) {
      try {
        await runAsync('ROLLBACK');
      } catch (rollbackError) {
        console.error('[marketing-push-consent/patch] rollback failed:', rollbackError);
      }
      throw transactionError;
    }
  } catch (error) {
    console.error('[marketing-push-consent/patch] failed:', error);
    return sendNotificationError(
      res,
      500,
      'INTERNAL_ERROR',
      '마케팅 알림 수신 동의 저장 중 오류가 발생했습니다.'
    );
  }
});

router.get('/admin/marketing-push-campaigns', authRequired, adminRequired, async (req, res) => {
  const requestedLimit = Number.parseInt(req.query?.limit, 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, 50))
    : 12;

  try {
    const [campaignRows, recipientRows] = await Promise.all([
      allAsync(
        `
        SELECT
          id,
          title,
          body,
          target_path,
          queued_count,
          dry_run,
          campaign_key,
          campaign_kind,
          scheduled_for_date,
          created_at
        FROM marketing_push_campaigns
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT ?
        `,
        [limit]
      ),
      fetchMarketingPushRecipientRows(),
    ]);

    return res.json({
      ok: true,
      campaigns: campaignRows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        target_path: row.target_path || '/',
        queued_count: Number(row.queued_count || 0),
        dry_run: Number(row.dry_run || 0) === 1,
        campaign_key: row.campaign_key || null,
        campaign_kind: row.campaign_kind || null,
        scheduled_for_date: row.scheduled_for_date || null,
        created_at: row.created_at || null,
      })),
      audience: buildMarketingPushAudienceSummary(recipientRows),
    });
  } catch (error) {
    console.error('[admin/marketing-push-campaigns/list] failed:', error);
    return sendNotificationError(
      res,
      500,
      'INTERNAL_ERROR',
      '마케팅 푸시 캠페인 목록 조회 중 오류가 발생했습니다.'
    );
  }
});

router.get('/admin/push-deliveries', authRequired, adminRequired, async (req, res) => {
  const limit = parseAdminListLimit(req.query?.limit, 30, 100);
  const status = normalizePushDeliveryStatus(req.query?.status);
  const where = status ? 'WHERE q.status = ?' : '';
  const params = status ? [status, limit] : [limit];

  try {
    const [summaryRows, deliveryRows] = await Promise.all([
      allAsync(
        `
        SELECT status, COUNT(*) AS cnt
        FROM push_delivery_queue
        GROUP BY status
        `
      ),
      allAsync(
        `
        SELECT
          q.id,
          q.activity_event_id,
          q.recipient_user_id,
          q.push_token_id,
          q.status,
          q.provider,
          q.title,
          q.body,
          q.payload_json,
          q.attempt_count,
          q.last_error,
          q.provider_message_id,
          q.created_at,
          q.updated_at,
          q.sent_at,
          q.last_attempt_at,
          q.next_attempt_at,
          ae.event_type,
          ae.post_id,
          ae.comment_id,
          ae.actor_user_id,
          u.name AS recipient_name,
          u.nickname AS recipient_nickname,
          u.email AS recipient_email,
          COALESCE(u.account_status, 'active') AS recipient_account_status,
          pt.platform,
          pt.device_id,
          pt.app_version,
          pt.enabled AS push_token_enabled,
          pt.last_seen_at AS push_token_last_seen_at
        FROM push_delivery_queue q
        LEFT JOIN activity_events ae ON ae.id = q.activity_event_id
        LEFT JOIN users u ON u.id = q.recipient_user_id
        LEFT JOIN push_tokens pt ON pt.id = q.push_token_id
        ${where}
        ORDER BY datetime(q.created_at) DESC, q.id DESC
        LIMIT ?
        `,
        params
      ),
    ]);

    return res.json({
      ok: true,
      summary: buildPushDeliverySummary(summaryRows),
      deliveries: deliveryRows.map((row) => {
        const payload = parseMeta(row.payload_json);
        return {
          id: row.id,
          activity_event_id: row.activity_event_id || null,
          recipient_user_id: row.recipient_user_id || null,
          push_token_id: row.push_token_id || null,
          status: row.status,
          provider: row.provider,
          title: row.title,
          body: row.body,
          type: payload.type || null,
          event_type: payload.event_type || row.event_type || null,
          target_path: payload.target_path || null,
          campaign_id: payload.campaign_id || null,
          post_id: payload.post_id || row.post_id || null,
          comment_id: payload.comment_id || row.comment_id || null,
          actor_user_id: row.actor_user_id || null,
          attempt_count: Number(row.attempt_count || 0),
          last_error: row.last_error || null,
          provider_message_id: row.provider_message_id || null,
          created_at: row.created_at || null,
          updated_at: row.updated_at || null,
          sent_at: row.sent_at || null,
          last_attempt_at: row.last_attempt_at || null,
          next_attempt_at: row.next_attempt_at || null,
          recipient: {
            id: row.recipient_user_id || null,
            name: row.recipient_name || null,
            nickname: row.recipient_nickname || null,
            email: row.recipient_email || null,
            account_status: row.recipient_account_status || null,
          },
          push_token: {
            id: row.push_token_id || null,
            platform: row.platform || null,
            device_id: row.device_id || null,
            app_version: row.app_version || null,
            enabled: Number(row.push_token_enabled || 0) === 1,
            last_seen_at: row.push_token_last_seen_at || null,
          },
        };
      }),
    });
  } catch (error) {
    console.error('[admin/push-deliveries/list] failed:', error);
    return sendNotificationError(
      res,
      500,
      'INTERNAL_ERROR',
      '푸시 알림 발송 목록 조회 중 오류가 발생했습니다.'
    );
  }
});

router.get('/admin/push-recipients', authRequired, adminRequired, async (req, res) => {
  const limit = parseAdminListLimit(req.query?.limit, 50, 100);

  try {
    const [recipientRows, optInCountRow, activeTokenRows] = await Promise.all([
      allAsync(
        `
        SELECT
          u.id,
          u.name,
          u.nickname,
          u.email,
          COALESCE(u.account_status, 'active') AS account_status,
          COALESCE(u.marketing_push_opt_in, 0) AS marketing_push_opt_in,
          u.marketing_push_opt_in_updated_at,
          COUNT(DISTINCT pt.id) AS total_push_token_count,
          COUNT(DISTINCT CASE WHEN pt.enabled = 1 THEN pt.id END) AS active_push_token_count,
          GROUP_CONCAT(DISTINCT CASE WHEN pt.enabled = 1 THEN pt.platform END) AS platforms,
          MAX(pt.last_seen_at) AS last_push_token_seen_at
        FROM users u
        LEFT JOIN push_tokens pt ON pt.user_id = u.id
        WHERE COALESCE(u.marketing_push_opt_in, 0) = 1
          AND COALESCE(u.account_status, 'active') = 'active'
        GROUP BY u.id
        ORDER BY datetime(COALESCE(u.marketing_push_opt_in_updated_at, '1970-01-01')) DESC,
                 u.id DESC
        LIMIT ?
        `,
        [limit]
      ),
      getAsync(
        `
        SELECT COUNT(*) AS cnt
        FROM users
        WHERE COALESCE(marketing_push_opt_in, 0) = 1
          AND COALESCE(account_status, 'active') = 'active'
        `
      ),
      fetchMarketingPushRecipientRows(),
    ]);

    return res.json({
      ok: true,
      summary: {
        opted_in_user_count: Number(optInCountRow?.cnt || 0),
        active_token_count: Array.isArray(activeTokenRows) ? activeTokenRows.length : 0,
        listed_count: recipientRows.length,
      },
      recipients: recipientRows.map((row) => ({
        id: row.id,
        name: row.name || null,
        nickname: row.nickname || null,
        email: row.email || null,
        account_status: row.account_status || null,
        marketing_push_opt_in: Number(row.marketing_push_opt_in || 0) === 1,
        marketing_push_opt_in_updated_at: row.marketing_push_opt_in_updated_at || null,
        total_push_token_count: Number(row.total_push_token_count || 0),
        active_push_token_count: Number(row.active_push_token_count || 0),
        platforms: String(row.platforms || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        last_push_token_seen_at: row.last_push_token_seen_at || null,
      })),
    });
  } catch (error) {
    console.error('[admin/push-recipients/list] failed:', error);
    return sendNotificationError(
      res,
      500,
      'INTERNAL_ERROR',
      '푸시 알림 수신 동의자 목록 조회 중 오류가 발생했습니다.'
    );
  }
});

router.post('/admin/marketing-push-campaigns', authRequired, adminRequired, async (req, res) => {
  const includeAdLabel = parseOptionalBoolean(req.body?.include_ad_label ?? req.body?.includeAdLabel, true);
  const title = normalizeMarketingTitle(req.body?.title, { includeAdLabel });
  const body = normalizeNullableText(req.body?.body, 180);
  const targetPath = normalizeInternalTargetPath(req.body?.target_path ?? req.body?.targetPath);
  const dryRun = parseBoolean(req.body?.dry_run);
  const campaignKey = normalizeNullableText(req.body?.campaign_key ?? req.body?.campaignKey, 160);
  const campaignKind = normalizeNullableText(req.body?.campaign_kind ?? req.body?.campaignKind, 80);
  const scheduledForDate = normalizeNullableText(
    req.body?.scheduled_for_date ?? req.body?.scheduledForDate,
    20
  );
  const targetRuleJson = normalizeOptionalJsonPayload(
    req.body?.target_rule_json ?? req.body?.targetRuleJson
  );

  if (!title || !body) {
    return sendNotificationError(
      res,
      400,
      'INVALID_REQUEST',
      '마케팅 푸시 제목과 본문이 필요합니다.'
    );
  }

  try {
    const recipientRows = await fetchMarketingPushRecipientRows();

    if (dryRun) {
      return res.json({
        ok: true,
        dry_run: true,
        ...buildMarketingPushAudienceSummary(recipientRows),
      });
    }

    await runAsync('BEGIN IMMEDIATE');
    try {
      const campaign = await runAsync(
        `
        INSERT OR IGNORE INTO marketing_push_campaigns (
          title,
          body,
          target_path,
          created_by_user_id,
          queued_count,
          dry_run,
          campaign_key,
          campaign_kind,
          scheduled_for_date,
          target_rule_json
        )
        VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
        `,
        [
          title,
          body,
          targetPath,
          req.user?.id || null,
          campaignKey,
          campaignKind,
          scheduledForDate,
          targetRuleJson,
        ]
      );
      if (campaignKey && Number(campaign?.changes || 0) === 0) {
        const existing = await getAsync(
          `
          SELECT id, queued_count
          FROM marketing_push_campaigns
          WHERE campaign_key = ?
          LIMIT 1
          `,
          [campaignKey]
        );
        await runAsync('COMMIT');
        return res.json({
          ok: true,
          skipped: true,
          reason: 'already_queued',
          campaign_id: existing?.id || null,
          queued_count: Number(existing?.queued_count || 0),
          ...buildMarketingPushAudienceSummary(recipientRows),
        });
      }
      const campaignId = campaign.lastID;
      let queuedCount = 0;
      const tokenRowsByUser = new Map();

      for (const row of recipientRows) {
        const list = tokenRowsByUser.get(row.user_id) || [];
        list.push(row.push_token_id);
        tokenRowsByUser.set(row.user_id, list);
      }

      for (const [userId, pushTokenIds] of tokenRowsByUser.entries()) {
        const activity = await runAsync(
          `
          INSERT INTO activity_events (
            recipient_user_id,
            actor_user_id,
            event_type,
            title,
            body,
            meta_json
          )
          VALUES (?, NULL, 'system', ?, ?, ?)
          `,
          [
            userId,
            title,
            body,
            serializeMeta({
              notification_type: 'marketing_campaign',
              campaign_id: campaignId,
              campaign_kind: campaignKind,
              campaign_key: campaignKey,
              target_path: targetPath,
            }),
          ]
        );

        for (const pushTokenId of pushTokenIds) {
          await runAsync(
            `
            INSERT INTO push_delivery_queue (
              activity_event_id,
              recipient_user_id,
              push_token_id,
              title,
              body,
              payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?)
            `,
            [
              activity.lastID,
              userId,
              pushTokenId,
              title,
              body,
              serializeMeta({
                notification_id: String(activity.lastID),
                activity_event_id: activity.lastID,
                type: 'marketing_campaign',
                event_type: 'system',
                campaign_id: campaignId,
                campaign_kind: campaignKind,
                campaign_key: campaignKey,
                target_path: targetPath,
              }),
            ]
          );
          queuedCount += 1;
        }
      }

      await runAsync('UPDATE marketing_push_campaigns SET queued_count = ? WHERE id = ?', [
        queuedCount,
        campaignId,
      ]);
      await runAsync('COMMIT');

      return res.status(201).json({
        ok: true,
        campaign_id: campaignId,
        queued_count: queuedCount,
        eligible_user_count: tokenRowsByUser.size,
        eligible_token_count: recipientRows.length,
      });
    } catch (transactionError) {
      try {
        await runAsync('ROLLBACK');
      } catch (rollbackError) {
        console.error('[admin/marketing-push-campaigns] rollback failed:', rollbackError);
      }
      throw transactionError;
    }
  } catch (error) {
    console.error('[admin/marketing-push-campaigns] failed:', error);
    return sendNotificationError(
      res,
      500,
      'INTERNAL_ERROR',
      '마케팅 푸시 캠페인 생성 중 오류가 발생했습니다.'
    );
  }
});

module.exports = router;
