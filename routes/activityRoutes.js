const express = require('express');
const { authRequired } = require('../middleware/auth');
const { allAsync, getAsync, runAsync } = require('../utils/questService');
const { mapActivityRow, toPositiveInt } = require('../utils/activityEvents');

const router = express.Router();

function sendActivityError(res, status, code, message) {
  return res.status(status).json({ ok: false, code, message });
}

function parsePagination(query = {}) {
  const requestedLimit = Number.parseInt(query.limit, 10);
  const requestedOffset = Number.parseInt(query.offset, 10);
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 50)
      : 20;
  const offset = Number.isFinite(requestedOffset) && requestedOffset > 0 ? requestedOffset : 0;
  return { limit, offset };
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'y'].includes(value.trim().toLowerCase());
}

function normalizePlatform(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ['ios', 'android', 'web'].includes(normalized) ? normalized : 'unknown';
}

function normalizeToken(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 500);
}

router.get('/activity', authRequired, async (req, res) => {
  const userId = toPositiveInt(req.user.id);
  const { limit, offset } = parsePagination(req.query || {});
  const unreadOnly = parseBoolean(req.query?.unread_only);

  try {
    const where = ['ae.recipient_user_id = ?'];
    const params = [userId];
    if (unreadOnly) {
      where.push('ae.read_at IS NULL');
    }

    const rows = await allAsync(
      `
      SELECT
        ae.*,
        actor.nickname AS actor_nickname,
        COALESCE(actor.account_status, 'active') AS actor_account_status,
        p.title AS post_title
      FROM activity_events ae
      LEFT JOIN users actor ON actor.id = ae.actor_user_id
      LEFT JOIN posts p ON p.id = ae.post_id
      WHERE ${where.join(' AND ')}
      ORDER BY ae.created_at DESC, ae.id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    const totalRow = await getAsync(
      `
      SELECT COUNT(*) AS cnt
      FROM activity_events ae
      WHERE ${where.join(' AND ')}
      `,
      params
    );
    const unreadRow = await getAsync(
      `
      SELECT COUNT(*) AS cnt
      FROM activity_events
      WHERE recipient_user_id = ?
        AND read_at IS NULL
      `,
      [userId]
    );

    return res.json({
      ok: true,
      message: '활동함을 불러왔습니다.',
      activities: rows.map(mapActivityRow),
      unread_count: Number(unreadRow?.cnt || 0),
      pagination: {
        limit,
        offset,
        total: Number(totalRow?.cnt || 0),
        has_more: offset + rows.length < Number(totalRow?.cnt || 0),
      },
    });
  } catch (error) {
    console.error('[activity/list] failed:', error);
    return sendActivityError(
      res,
      500,
      'INTERNAL_ERROR',
      '활동함 조회 중 오류가 발생했습니다.'
    );
  }
});

router.get('/activity/unread-count', authRequired, async (req, res) => {
  const userId = toPositiveInt(req.user.id);

  try {
    const row = await getAsync(
      `
      SELECT COUNT(*) AS cnt
      FROM activity_events
      WHERE recipient_user_id = ?
        AND read_at IS NULL
      `,
      [userId]
    );

    return res.json({
      ok: true,
      unread_count: Number(row?.cnt || 0),
    });
  } catch (error) {
    console.error('[activity/unread-count] failed:', error);
    return sendActivityError(
      res,
      500,
      'INTERNAL_ERROR',
      '미읽음 활동 수 조회 중 오류가 발생했습니다.'
    );
  }
});

router.patch('/activity/:activityId/read', authRequired, async (req, res) => {
  const userId = toPositiveInt(req.user.id);
  const activityId = toPositiveInt(req.params.activityId);

  if (!activityId) {
    return sendActivityError(res, 400, 'INVALID_REQUEST', '잘못된 활동 ID입니다.');
  }

  try {
    const result = await runAsync(
      `
      UPDATE activity_events
      SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
      WHERE id = ?
        AND recipient_user_id = ?
      `,
      [activityId, userId]
    );

    if (result.changes <= 0) {
      return sendActivityError(res, 404, 'RESOURCE_NOT_FOUND', '활동을 찾을 수 없습니다.');
    }

    return res.json({
      ok: true,
      message: '활동을 읽음 처리했습니다.',
    });
  } catch (error) {
    console.error('[activity/read] failed:', error);
    return sendActivityError(
      res,
      500,
      'INTERNAL_ERROR',
      '활동 읽음 처리 중 오류가 발생했습니다.'
    );
  }
});

router.post('/activity/read-all', authRequired, async (req, res) => {
  const userId = toPositiveInt(req.user.id);

  try {
    const result = await runAsync(
      `
      UPDATE activity_events
      SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
      WHERE recipient_user_id = ?
        AND read_at IS NULL
      `,
      [userId]
    );

    return res.json({
      ok: true,
      message: '모든 활동을 읽음 처리했습니다.',
      updated_count: Number(result?.changes || 0),
    });
  } catch (error) {
    console.error('[activity/read-all] failed:', error);
    return sendActivityError(
      res,
      500,
      'INTERNAL_ERROR',
      '전체 읽음 처리 중 오류가 발생했습니다.'
    );
  }
});

router.post('/push-tokens', authRequired, async (req, res) => {
  const userId = toPositiveInt(req.user.id);
  const token = normalizeToken(req.body?.token);
  const platform = normalizePlatform(req.body?.platform);
  const deviceId = typeof req.body?.device_id === 'string' ? req.body.device_id.trim().slice(0, 200) : null;
  const appVersion =
    typeof req.body?.app_version === 'string' ? req.body.app_version.trim().slice(0, 80) : null;

  if (!token) {
    return sendActivityError(res, 400, 'INVALID_REQUEST', '푸시 토큰이 필요합니다.');
  }

  try {
    await runAsync(
      `
      INSERT INTO push_tokens (
        user_id,
        token,
        platform,
        device_id,
        app_version,
        enabled,
        last_seen_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(token) DO UPDATE SET
        user_id = excluded.user_id,
        platform = excluded.platform,
        device_id = excluded.device_id,
        app_version = excluded.app_version,
        enabled = 1,
        last_seen_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      `,
      [userId, token, platform, deviceId || null, appVersion || null]
    );

    const row = await getAsync(
      `
      SELECT id, user_id, token, platform, device_id, app_version, enabled, last_seen_at
      FROM push_tokens
      WHERE token = ?
      LIMIT 1
      `,
      [token]
    );

    return res.status(201).json({
      ok: true,
      message: '푸시 토큰이 등록되었습니다.',
      push_token: row,
    });
  } catch (error) {
    console.error('[push-tokens/register] failed:', error);
    return sendActivityError(
      res,
      500,
      'INTERNAL_ERROR',
      '푸시 토큰 등록 중 오류가 발생했습니다.'
    );
  }
});

router.delete('/push-tokens', authRequired, async (req, res) => {
  const userId = toPositiveInt(req.user.id);
  const token = normalizeToken(req.body?.token || req.query?.token);

  if (!token) {
    return sendActivityError(res, 400, 'INVALID_REQUEST', '푸시 토큰이 필요합니다.');
  }

  try {
    const result = await runAsync(
      `
      UPDATE push_tokens
      SET enabled = 0,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
        AND token = ?
      `,
      [userId, token]
    );

    return res.json({
      ok: true,
      message: '푸시 토큰이 비활성화되었습니다.',
      updated_count: Number(result?.changes || 0),
    });
  } catch (error) {
    console.error('[push-tokens/delete] failed:', error);
    return sendActivityError(
      res,
      500,
      'INTERNAL_ERROR',
      '푸시 토큰 해제 중 오류가 발생했습니다.'
    );
  }
});

module.exports = router;
