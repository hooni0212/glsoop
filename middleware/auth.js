// middleware/auth.js
const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_ALGORITHM, JWT_ISSUER, JWT_AUDIENCE } = require('../config');
const db = require('../db');
const { extractToken } = require('../utils/token');

function sendAuthError(res, status, code, message) {
  return res.status(status).json({ ok: false, code, message });
}

// 로그인 필수 라우트용 미들웨어
// - Bearer 또는 쿠키 JWT를 검증해 req.user에 디코딩 정보 세팅
function authRequired(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return sendAuthError(res, 401, 'AUTH_REQUIRED', '로그인이 필요합니다.');
  }

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
        return sendAuthError(
          res,
          401,
          'AUTH_INVALID_TOKEN',
          '토큰이 만료되었거나 유효하지 않습니다.'
        );
      }

      // { id, name, nickname, email, isAdmin, isVerified }
      if (!decoded.id) {
        return sendAuthError(res, 401, 'AUTH_INVALID_SESSION', '세션 정보가 올바르지 않습니다.');
      }

      req.user = decoded;
      next();
    }
  );
}

// ✅ 관리자 전용 라우트용 미들웨어 (DB에서 is_admin을 매 요청 재확인)
// - authRequired 이후에 배치하여 req.user.id 존재한다고 가정
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

    // downstream에서 req.user.isAdmin을 기대할 수 있으니 맞춰줌
    req.user.isAdmin = true;
    next();
  });
}

module.exports = {
  authRequired,
  adminRequired,
};
