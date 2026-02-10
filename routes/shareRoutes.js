const express = require('express');
const db = require('../db');
const { authOptional } = require('../middleware/auth');

const router = express.Router();

const ALLOWED_PLATFORMS = new Set(['mobile', 'web']);
const ALLOWED_RESULTS = new Set(['shared', 'dismissed', 'failed']);

const MAX_SURFACE_LENGTH = 60;
const MAX_CHANNEL_LENGTH = 60;
const MAX_REQUEST_ID_LENGTH = 120;
const MAX_META_JSON_LENGTH = 4000;

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });

function sendShareError(res, status, code, message) {
  return res.status(status).json({ ok: false, code, message });
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) return null;
  return trimmed;
}

function normalizeMetaJson(value) {
  if (value === undefined || value === null) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.length > MAX_META_JSON_LENGTH) return null;
    return trimmed;
  }

  if (typeof value === 'object') {
    const serialized = JSON.stringify(value);
    if (!serialized) return null;
    if (serialized.length > MAX_META_JSON_LENGTH) return null;
    return serialized;
  }

  return null;
}

function parseSharePayload(body = {}) {
  const postId = parsePositiveInteger(body.post_id);
  if (!postId || postId < 1) {
    return { error: '유효한 post_id가 필요합니다.' };
  }

  const platform = normalizeText(body.platform, 20)?.toLowerCase();
  if (!platform || !ALLOWED_PLATFORMS.has(platform)) {
    return { error: 'platform은 mobile 또는 web 이어야 합니다.' };
  }

  const surface = normalizeText(body.surface, MAX_SURFACE_LENGTH);
  if (!surface) {
    return { error: `surface는 1~${MAX_SURFACE_LENGTH}자여야 합니다.` };
  }

  const channel = normalizeText(body.channel, MAX_CHANNEL_LENGTH);
  if (!channel) {
    return { error: `channel은 1~${MAX_CHANNEL_LENGTH}자여야 합니다.` };
  }

  const result = normalizeText(body.result, 20)?.toLowerCase();
  if (!result || !ALLOWED_RESULTS.has(result)) {
    return { error: 'result는 shared, dismissed, failed 중 하나여야 합니다.' };
  }

  const requestId = body.request_id === undefined ? null : normalizeText(body.request_id, MAX_REQUEST_ID_LENGTH);
  if (body.request_id !== undefined && requestId === null) {
    return { error: `request_id는 1~${MAX_REQUEST_ID_LENGTH}자여야 합니다.` };
  }

  const metaJson = normalizeMetaJson(body.meta);
  if (body.meta !== undefined && body.meta !== null && metaJson === null) {
    return { error: `meta는 JSON 문자열 기준 ${MAX_META_JSON_LENGTH}자 이하여야 합니다.` };
  }

  return {
    postId,
    platform,
    surface,
    channel,
    result,
    requestId,
    metaJson,
  };
}

router.post('/share-events', authOptional, async (req, res) => {
  const parsed = parseSharePayload(req.body || {});
  if (parsed.error) {
    return sendShareError(res, 400, 'INVALID_REQUEST', parsed.error);
  }

  const { postId, platform, surface, channel, result, requestId, metaJson } = parsed;

  try {
    const post = await dbGet('SELECT id FROM posts WHERE id = ? LIMIT 1', [postId]);
    if (!post) {
      return sendShareError(res, 404, 'RESOURCE_NOT_FOUND', '해당 글을 찾을 수 없습니다.');
    }

    const insertResult = await dbRun(
      `INSERT INTO share_events
        (post_id, user_id, platform, surface, channel, result, request_id, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        postId,
        req.user?.id || null,
        platform,
        surface,
        channel,
        result,
        requestId,
        metaJson,
      ]
    );

    const event = await dbGet(
      'SELECT id, created_at FROM share_events WHERE id = ? LIMIT 1',
      [insertResult.lastID]
    );

    return res.status(201).json({
      ok: true,
      message: '공유 이벤트가 기록되었습니다.',
      event: event || { id: insertResult.lastID, created_at: null },
    });
  } catch (error) {
    console.error('[share-events] failed:', error);
    return sendShareError(
      res,
      500,
      'INTERNAL_ERROR',
      '공유 이벤트 기록 중 오류가 발생했습니다.'
    );
  }
});

module.exports = router;
