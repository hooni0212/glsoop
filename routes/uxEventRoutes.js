const express = require('express');
const { authOptional } = require('../middleware/auth');
const {
  logUxEvent,
  normalizeEventName,
  normalizeText,
  normalizePropertiesJson,
} = require('../utils/uxEvents');
const { resolveUxEventClient } = require('../utils/deviceAnalytics');

const router = express.Router();

const MAX_SESSION_ID_LENGTH = 120;
const MAX_ANONYMOUS_ID_LENGTH = 120;
const MAX_PAGE_PATH_LENGTH = 255;
const MAX_REFERRER_LENGTH = 500;

function sendUxEventError(res, status, code, message) {
  return res.status(status).json({ ok: false, code, message });
}

router.post('/ux-events', authOptional, async (req, res) => {
  const body = req.body || {};

  const eventName = normalizeEventName(body.event_name || body.eventName);
  if (!eventName) {
    return sendUxEventError(
      res,
      400,
      'INVALID_REQUEST',
      'event_name은 영문 소문자/숫자/언더스코어 형식이어야 합니다.'
    );
  }

  const sessionId =
    body.session_id === undefined
      ? null
      : normalizeText(body.session_id, MAX_SESSION_ID_LENGTH);
  if (body.session_id !== undefined && body.session_id !== null && sessionId === null) {
    return sendUxEventError(
      res,
      400,
      'INVALID_REQUEST',
      `session_id는 1~${MAX_SESSION_ID_LENGTH}자여야 합니다.`
    );
  }

  const anonymousId =
    body.anonymous_id === undefined
      ? null
      : normalizeText(body.anonymous_id, MAX_ANONYMOUS_ID_LENGTH);
  if (body.anonymous_id !== undefined && body.anonymous_id !== null && anonymousId === null) {
    return sendUxEventError(
      res,
      400,
      'INVALID_REQUEST',
      `anonymous_id는 1~${MAX_ANONYMOUS_ID_LENGTH}자여야 합니다.`
    );
  }

  const pagePath =
    body.page_path === undefined
      ? null
      : normalizeText(body.page_path, MAX_PAGE_PATH_LENGTH);
  if (body.page_path !== undefined && body.page_path !== null && pagePath === null) {
    return sendUxEventError(
      res,
      400,
      'INVALID_REQUEST',
      `page_path는 1~${MAX_PAGE_PATH_LENGTH}자여야 합니다.`
    );
  }

  const referrer =
    body.referrer === undefined ? null : normalizeText(body.referrer, MAX_REFERRER_LENGTH);
  if (body.referrer !== undefined && body.referrer !== null && referrer === null) {
    return sendUxEventError(
      res,
      400,
      'INVALID_REQUEST',
      `referrer는 1~${MAX_REFERRER_LENGTH}자여야 합니다.`
    );
  }

  const propertiesJson = normalizePropertiesJson(body.properties);
  if (body.properties !== undefined && body.properties !== null && propertiesJson === null) {
    return sendUxEventError(
      res,
      400,
      'INVALID_REQUEST',
      'properties는 JSON 문자열 기준 4000자 이하여야 합니다.'
    );
  }

  const client = resolveUxEventClient({
    clientType: req.get('x-glsoop-client'),
    deviceClass: req.get('x-glsoop-device-class'),
    platformFamily: req.get('x-glsoop-platform'),
    userAgent: req.get('user-agent'),
  });

  try {
    await logUxEvent({
      user_id: req.user?.id || null,
      event_name: eventName,
      source: client.source,
      session_id: sessionId,
      anonymous_id: anonymousId,
      page_path: pagePath,
      referrer,
      properties_json: propertiesJson,
      device_class: client.deviceClass,
      platform_family: client.platformFamily,
    });

    return res.status(202).json({
      ok: true,
      message: '이벤트가 기록되었습니다.',
    });
  } catch (error) {
    console.error('[ux-events] failed:', error);
    return sendUxEventError(
      res,
      500,
      'INTERNAL_ERROR',
      '이벤트 기록 중 오류가 발생했습니다.'
    );
  }
});

module.exports = router;
