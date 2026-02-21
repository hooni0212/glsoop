// middleware/auth.js
const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_ALGORITHM, JWT_ISSUER, JWT_AUDIENCE } = require('../config');
const db = require('../db');
const { extractToken } = require('../utils/token');
const { getActiveSessionBySid, touchAuthSession } = require('../utils/authSession');

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

async function attachUserFromToken(req, { required }) {
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

  // sid 없는 기존 토큰은 1차 릴리스에서 호환 허용
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
    req.authSession = null;
  }

  req.user = decoded;
}

// 로그인 필수 라우트용 미들웨어
function authRequired(req, res, next) {
  attachUserFromToken(req, { required: true })
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
  attachUserFromToken(req, { required: false })
    .then(() => next())
    .catch((error) => {
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
