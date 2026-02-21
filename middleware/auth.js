// middleware/auth.js
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const {
  JWT_SECRET,
  JWT_ALGORITHM,
  JWT_ISSUER,
  JWT_AUDIENCE,
  LEGACY_TOKEN_SUNSET_AT,
  LEGACY_TOKEN_SUNSET_AT_MS,
} = require('../config');
const db = require('../db');
const { extractToken } = require('../utils/token');
const {
  getActiveSessionBySid,
  touchAuthSession,
  getIpHashFromRequest,
  getUserAgent,
} = require('../utils/authSession');

const LEGACY_DEPRECATION_DOC_LINK = `</${encodeURI(
  'docs/서버/API/인증-계정.md'
)}>; rel="deprecation"`;

function sendAuthError(res, status, code, message) {
  return res.status(status).json({ ok: false, code, message });
}

async function decodeTokenOrError(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      JWT_SECRET,
      {
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      },
      (err, decoded) => {
        if (err || !decoded) {
          reject(new Error('invalid_token'));
          return;
        }
        resolve(decoded);
      }
    );
  });
}

function hashUserAgentForLog(userAgent) {
  const normalizedUserAgent = typeof userAgent === 'string' ? userAgent.trim() : '';
  if (!normalizedUserAgent) return null;
  return crypto
    .createHash('sha256')
    .update(`${JWT_SECRET}:ua:${normalizedUserAgent}`)
    .digest('hex');
}

function getRequestId(req) {
  const requestId = req?.headers?.['x-request-id'];
  if (typeof requestId !== 'string') return null;
  const trimmed = requestId.trim();
  return trimmed || null;
}

function logLegacyTokenEvent(req, { action, status, userId = null, sidPresent = false }) {
  const payload = {
    event: 'auth_legacy_token',
    action,
    ts: new Date().toISOString(),
    user_id: userId || null,
    method: req.method,
    path: req.originalUrl || req.url || null,
    status,
    ip_hash: getIpHashFromRequest(req),
    ua_hash: hashUserAgentForLog(getUserAgent(req)),
    sid_present: Boolean(sidPresent),
    sunset_at: LEGACY_TOKEN_SUNSET_AT,
    request_id: getRequestId(req),
  };
  console.log(JSON.stringify(payload));
}

function applyLegacyDeprecationHeaders(res) {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', new Date(LEGACY_TOKEN_SUNSET_AT_MS).toUTCString());
  res.setHeader('Link', LEGACY_DEPRECATION_DOC_LINK);
}

function bindLegacyAllowLog(req, res, decoded) {
  if (res.locals?.legacyTokenAllowLogged) return;
  res.locals = res.locals || {};
  res.locals.legacyTokenAllowLogged = true;
  res.on('finish', () => {
    logLegacyTokenEvent(req, {
      action: 'allow',
      status: res.statusCode,
      userId: decoded?.id || null,
      sidPresent: false,
    });
  });
}

function isLegacyTokenBlocked(nowMs = Date.now()) {
  return nowMs >= LEGACY_TOKEN_SUNSET_AT_MS;
}

function getLegacyPolicyNowMs(req) {
  if (process.env.NODE_ENV === 'production') {
    return Date.now();
  }
  const override = req?.headers?.['x-auth-legacy-now'];
  if (typeof override !== 'string' || !override.trim()) {
    return Date.now();
  }
  const trimmed = override.trim();
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  const parsed = new Date(trimmed).getTime();
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

async function attachUserFromToken(req, res, { required }) {
  const token = extractToken(req);
  if (!token) {
    if (required) {
      throw { status: 401, code: 'AUTH_REQUIRED', message: '로그인이 필요합니다.' };
    }
    req.user = null;
    return;
  }

  let decoded;
  try {
    decoded = await decodeTokenOrError(token);
  } catch (error) {
    if (required) {
      throw {
        status: 401,
        code: 'AUTH_INVALID_TOKEN',
        message: '토큰이 만료되었거나 유효하지 않습니다.',
      };
    }
    req.user = null;
    return;
  }

  if (!decoded.id) {
    if (required) {
      throw {
        status: 401,
        code: 'AUTH_INVALID_SESSION',
        message: '세션 정보가 올바르지 않습니다.',
      };
    }
    req.user = null;
    return;
  }

  // sid 없는 레거시 토큰은 유예 기간 내에서만 허용
  if (decoded.sid) {
    const session = await getActiveSessionBySid(decoded.sid);
    if (!session || Number(session.user_id) !== Number(decoded.id)) {
      if (required) {
        throw {
          status: 401,
          code: 'AUTH_INVALID_SESSION',
          message: '세션이 만료되었거나 유효하지 않습니다. 다시 로그인해주세요.',
        };
      }
      req.user = null;
      return;
    }
    req.authSession = session;
    // 요청 성공 여부와 무관하게 최근 활동 시간을 갱신
    touchAuthSession(decoded.sid).catch((err) => {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[auth] failed to touch session:', err);
      }
    });
  } else {
    applyLegacyDeprecationHeaders(res);
    if (isLegacyTokenBlocked(getLegacyPolicyNowMs(req))) {
      logLegacyTokenEvent(req, {
        action: 'block',
        status: 401,
        userId: decoded.id,
        sidPresent: false,
      });
      throw {
        status: 401,
        code: 'AUTH_LEGACY_TOKEN_DEPRECATED',
        message: '기존 토큰 형식 지원이 종료되었습니다. 다시 로그인해주세요.',
      };
    }
    bindLegacyAllowLog(req, res, decoded);
    req.authSession = null;
  }

  req.user = decoded;
}

// 로그인 필수 라우트용 미들웨어
function authRequired(req, res, next) {
  attachUserFromToken(req, res, { required: true })
    .then(() => next())
    .catch((error) => {
      if (error && error.code && error.status) {
        return sendAuthError(res, error.status, error.code, error.message);
      }
      console.error('[authRequired] unexpected error:', error);
      return sendAuthError(res, 500, 'INTERNAL_ERROR', '서버 오류');
    });
}

// 선택 인증 라우트용 미들웨어
function authOptional(req, res, next) {
  attachUserFromToken(req, res, { required: false })
    .then(() => next())
    .catch((error) => {
      if (error && error.code && error.status) {
        return sendAuthError(res, error.status, error.code, error.message);
      }
      console.error('[authOptional] unexpected error:', error);
      req.user = null;
      req.authSession = null;
      next();
    });
}

// 관리자 전용 라우트용 미들웨어 (DB에서 is_admin을 매 요청 재확인)
function adminRequired(req, res, next) {
  if (!req.user?.id) {
    return sendAuthError(res, 401, 'AUTH_REQUIRED', '로그인이 필요합니다.');
  }

  db.get('SELECT is_admin FROM users WHERE id = ?', [req.user.id], (err, row) => {
    if (err) {
      console.error('[adminRequired] DB error:', err);
      return sendAuthError(res, 500, 'INTERNAL_ERROR', '서버 오류');
    }

    const isAdmin = row && Number(row.is_admin) === 1;
    if (!isAdmin) {
      return sendAuthError(res, 403, 'AUTH_FORBIDDEN', '관리자만 접근할 수 있습니다.');
    }

    req.user.isAdmin = true;
    next();
  });
}

module.exports = {
  authRequired,
  authOptional,
  adminRequired,
};
