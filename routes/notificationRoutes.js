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
  const trimmed = normalizeNullableText(value, 300);
  if (!trimmed) return '/';
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/';
  if (trimmed.startsWith('/(auth)')) return '/';
  return trimmed;
}

function getMarketingVersion() {
  return LEGAL_CONFIG?.versions?.marketing || '';
}

function normalizeMarketingTitle(value) {
  const raw = normalizeNullableText(value, 80);
  if (!raw) return null;
  return raw.startsWith('(광고)') ? raw : `(광고) ${raw}`;
}

function serializeMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  try {
    return JSON.stringify(meta);
  } catch {
    return null;
  }
}

function toTimestamp(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function isV1NotificationRow(row) {
  if (!row || !V1_EVENT_TYPES.has(row.event_type)) return false;
  if (row.event_type === 'system') {
    const notificationType = parseMeta(row.meta_json).notification_type;
    return notificationType === 'new_follower' || notificationType === 'admin_operational_alert';
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
      title: row.title || '새 댓글',
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
      title: row.title || '새 답글',
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

  if (row.event_type === 'system' && meta.notification_type === 'new_follower') {
    return {
      id: String(row.id),
      type: 'new_follower',
      title: row.title || '새 팔로워',
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

router.post('/admin/marketing-push-campaigns', authRequired, adminRequired, async (req, res) => {
  const title = normalizeMarketingTitle(req.body?.title);
  const body = normalizeNullableText(req.body?.body, 180);
  const targetPath = normalizeInternalTargetPath(req.body?.target_path ?? req.body?.targetPath);
  const dryRun = parseBoolean(req.body?.dry_run);

  if (!title || !body) {
    return sendNotificationError(
      res,
      400,
      'INVALID_REQUEST',
      '마케팅 푸시 제목과 본문이 필요합니다.'
    );
  }

  try {
    const recipientRows = await allAsync(
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

    if (dryRun) {
      const uniqueUsers = new Set(recipientRows.map((row) => row.user_id));
      return res.json({
        ok: true,
        dry_run: true,
        eligible_user_count: uniqueUsers.size,
        eligible_token_count: recipientRows.length,
      });
    }

    await runAsync('BEGIN IMMEDIATE');
    try {
      const campaign = await runAsync(
        `
        INSERT INTO marketing_push_campaigns (
          title,
          body,
          target_path,
          created_by_user_id,
          queued_count,
          dry_run
        )
        VALUES (?, ?, ?, ?, 0, 0)
        `,
        [title, body, targetPath, req.user?.id || null]
      );
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
