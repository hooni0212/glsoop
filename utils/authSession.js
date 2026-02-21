const crypto = require('crypto');
const db = require('../db');
const { JWT_SECRET } = require('../config');

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const REMEMBER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REVOKED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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
    db.run(sql, params, function runCallback(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

function toIso(ms) {
  return new Date(ms).toISOString();
}

function parseIsoToMs(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function createSessionId() {
  return crypto.randomBytes(24).toString('hex');
}

function normalizeIp(rawIp) {
  if (!rawIp || typeof rawIp !== 'string') return '';
  const trimmed = rawIp.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice(7);
  }
  return trimmed;
}

function getClientIp(req) {
  const forwardedFor = req?.headers?.['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    const first = forwardedFor.split(',')[0].trim();
    if (first) return normalizeIp(first);
  }
  return normalizeIp(req?.ip || req?.socket?.remoteAddress || '');
}

function hashClientIp(ip) {
  if (!ip) return null;
  return crypto
    .createHash('sha256')
    .update(`${JWT_SECRET}:ip:${ip}`)
    .digest('hex');
}

function getIpHashFromRequest(req) {
  return hashClientIp(getClientIp(req));
}

function normalizeUserAgent(userAgent) {
  if (!userAgent || typeof userAgent !== 'string') return '';
  return userAgent.trim().slice(0, 255);
}

function getUserAgent(req) {
  const raw = req?.headers?.['user-agent'];
  return normalizeUserAgent(typeof raw === 'string' ? raw : '');
}

function getSessionTtlMs(rememberMe) {
  return rememberMe ? REMEMBER_SESSION_TTL_MS : SESSION_TTL_MS;
}

function buildSessionMeta(req) {
  return {
    ipHash: getIpHashFromRequest(req),
    userAgent: getUserAgent(req),
  };
}

function isSessionExpired(row, nowMs = Date.now()) {
  const expiresAtMs = parseIsoToMs(row?.expires_at);
  if (!expiresAtMs) return true;
  return expiresAtMs <= nowMs;
}

async function createAuthSession({ userId, rememberMe = false, req, nowMs = Date.now() }) {
  const sid = createSessionId();
  const createdAt = toIso(nowMs);
  const expiresAt = toIso(nowMs + getSessionTtlMs(rememberMe));
  const { ipHash, userAgent } = buildSessionMeta(req);

  await dbRun(
    `
    INSERT INTO auth_sessions (
      sid,
      user_id,
      remember_me,
      ip_hash,
      user_agent,
      created_at,
      last_seen_at,
      expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [sid, userId, rememberMe ? 1 : 0, ipHash, userAgent, createdAt, createdAt, expiresAt]
  );

  return {
    sid,
    userId,
    rememberMe: !!rememberMe,
    createdAt,
    expiresAt,
    ipHash,
    userAgent,
  };
}

async function getActiveSessionBySid(sid, nowMs = Date.now()) {
  if (!sid || typeof sid !== 'string') return null;
  const row = await dbGet(
    `
    SELECT
      sid,
      user_id,
      remember_me,
      ip_hash,
      user_agent,
      created_at,
      last_seen_at,
      expires_at,
      revoked_at
    FROM auth_sessions
    WHERE sid = ?
    `,
    [sid]
  );

  if (!row) return null;
  if (row.revoked_at) return null;
  if (isSessionExpired(row, nowMs)) return null;
  return row;
}

async function touchAuthSession(sid, nowMs = Date.now()) {
  if (!sid || typeof sid !== 'string') return;
  await dbRun(
    `
    UPDATE auth_sessions
    SET last_seen_at = ?
    WHERE sid = ?
      AND revoked_at IS NULL
      AND expires_at > ?
    `,
    [toIso(nowMs), sid, toIso(nowMs)]
  );
}

async function revokeAuthSession(sid, reason = 'logout', nowMs = Date.now()) {
  if (!sid || typeof sid !== 'string') {
    return { changed: 0 };
  }
  const result = await dbRun(
    `
    UPDATE auth_sessions
    SET revoked_at = ?, revoked_reason = ?
    WHERE sid = ?
      AND revoked_at IS NULL
    `,
    [toIso(nowMs), reason, sid]
  );
  return { changed: result?.changes || 0 };
}

async function revokeAllAuthSessionsForUser(userId, reason = 'logout_all', nowMs = Date.now()) {
  if (!userId) return { changed: 0 };
  const result = await dbRun(
    `
    UPDATE auth_sessions
    SET revoked_at = ?, revoked_reason = ?
    WHERE user_id = ?
      AND revoked_at IS NULL
      AND expires_at > ?
    `,
    [toIso(nowMs), reason, userId, toIso(nowMs)]
  );
  return { changed: result?.changes || 0 };
}

function summarizeUserAgent(userAgent) {
  if (!userAgent) return '알 수 없는 기기';
  return userAgent.length <= 120 ? userAgent : `${userAgent.slice(0, 117)}...`;
}

function buildIpHint(ipHash) {
  if (!ipHash || typeof ipHash !== 'string') return null;
  return `ip#${ipHash.slice(0, 10)}`;
}

async function listActiveSessionsForUser(userId, currentSid, nowMs = Date.now()) {
  if (!userId) return [];
  const rows = await dbAll(
    `
    SELECT
      sid,
      remember_me,
      ip_hash,
      user_agent,
      created_at,
      last_seen_at,
      expires_at
    FROM auth_sessions
    WHERE user_id = ?
      AND revoked_at IS NULL
      AND expires_at > ?
    ORDER BY
      CASE WHEN sid = ? THEN 0 ELSE 1 END,
      datetime(last_seen_at) DESC,
      datetime(created_at) DESC
    `,
    [userId, toIso(nowMs), currentSid || '']
  );

  return rows.map((row) => ({
    sid: row.sid,
    current: row.sid === currentSid,
    remember_me: Number(row.remember_me) === 1,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
    expires_at: row.expires_at,
    user_agent: summarizeUserAgent(row.user_agent),
    ip_hint: buildIpHint(row.ip_hash),
  }));
}

async function cleanupExpiredSessions(nowMs = Date.now()) {
  const nowIso = toIso(nowMs);
  const revokedCutoffIso = toIso(nowMs - REVOKED_RETENTION_MS);

  const expiredResult = await dbRun(
    `
    DELETE FROM auth_sessions
    WHERE expires_at <= ?
    `,
    [nowIso]
  );

  const revokedResult = await dbRun(
    `
    DELETE FROM auth_sessions
    WHERE revoked_at IS NOT NULL
      AND revoked_at <= ?
    `,
    [revokedCutoffIso]
  );

  return {
    expired_deleted: expiredResult?.changes || 0,
    revoked_deleted: revokedResult?.changes || 0,
  };
}

module.exports = {
  SESSION_TTL_MS,
  REMEMBER_SESSION_TTL_MS,
  getSessionTtlMs,
  getClientIp,
  getIpHashFromRequest,
  getUserAgent,
  createAuthSession,
  getActiveSessionBySid,
  touchAuthSession,
  revokeAuthSession,
  revokeAllAuthSessionsForUser,
  listActiveSessionsForUser,
  cleanupExpiredSessions,
};
