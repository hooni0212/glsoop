const db = require('../db');

const EVENT_NAME_PATTERN = /^[a-z0-9_]+$/;
const MAX_EVENT_NAME_LENGTH = 64;
const MAX_SOURCE_LENGTH = 40;
const MAX_SESSION_ID_LENGTH = 120;
const MAX_ANONYMOUS_ID_LENGTH = 120;
const MAX_PAGE_PATH_LENGTH = 255;
const MAX_REFERRER_LENGTH = 500;
const MAX_PROPERTIES_JSON_LENGTH = 4000;

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

function normalizeText(value, maxLength) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function normalizeEventName(value) {
  const normalized = normalizeText(value, MAX_EVENT_NAME_LENGTH)?.toLowerCase();
  if (!normalized) return null;
  if (!EVENT_NAME_PATTERN.test(normalized)) return null;
  return normalized;
}

function normalizeSource(value) {
  const source = normalizeText(value, MAX_SOURCE_LENGTH)?.toLowerCase();
  return source || 'web';
}

function normalizePropertiesJson(value) {
  if (value === undefined || value === null) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_PROPERTIES_JSON_LENGTH) return null;
    return trimmed;
  }

  if (typeof value !== 'object') return null;

  try {
    const serialized = JSON.stringify(value);
    if (!serialized || serialized.length > MAX_PROPERTIES_JSON_LENGTH) return null;
    return serialized;
  } catch (error) {
    return null;
  }
}

function normalizeUserId(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

async function logUxEvent(payload = {}) {
  const eventName = normalizeEventName(payload.eventName || payload.event_name);
  if (!eventName) {
    throw new Error('INVALID_EVENT_NAME');
  }

  const source = normalizeSource(payload.source);
  const sessionId = normalizeText(
    payload.sessionId || payload.session_id,
    MAX_SESSION_ID_LENGTH
  );
  const anonymousId = normalizeText(
    payload.anonymousId || payload.anonymous_id,
    MAX_ANONYMOUS_ID_LENGTH
  );
  const pagePath = normalizeText(payload.pagePath || payload.page_path, MAX_PAGE_PATH_LENGTH);
  const referrer = normalizeText(payload.referrer, MAX_REFERRER_LENGTH);
  const propertiesJson = normalizePropertiesJson(
    payload.propertiesJson || payload.properties_json || payload.properties
  );

  const userIdRaw = payload.userId ?? payload.user_id ?? null;
  const userId = normalizeUserId(userIdRaw);

  const result = await dbRun(
    `INSERT INTO ux_events
      (user_id, event_name, source, session_id, anonymous_id, page_path, referrer, properties_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, eventName, source, sessionId, anonymousId, pagePath, referrer, propertiesJson]
  );

  return {
    id: result?.lastID || null,
    event_name: eventName,
  };
}

module.exports = {
  logUxEvent,
  normalizeEventName,
  normalizeText,
  normalizePropertiesJson,
};
