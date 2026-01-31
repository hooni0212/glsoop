// middleware/auth.js
const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_ALGORITHM, JWT_ISSUER, JWT_AUDIENCE } = require('../config');
const db = require('../db');

// 로그인 필수 라우트용 미들웨어
// - 쿠키에 담긴 JWT를 검증해 req.user에 디코딩 정보 세팅
function authRequired(req, res, next) {
  // 1) Bearer 토큰 (모바일/앱 권장)
  const authHeader = req.headers?.authorization;
  const bearerToken =
    typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : null;

  // 2) 쿠키 토큰 (웹)
  const cookieToken = req.cookies?.token;

  const token = bearerToken || cookieToken;
  if (!token) {
    return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
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
        return res.status(401).json({
          ok: false,
          message: '토큰이 만료되었거나 유효하지 않습니다.',
        });
      }

      // { id, name, nickname, email, isAdmin, isVerified }
      if (!decoded.id) {
        return res.status(401).json({
          ok: false,
          message: '세션 정보가 올바르지 않습니다.',
        });
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
    return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
  }

  db.get('SELECT is_admin FROM users WHERE id = ?', [req.user.id], (err, row) => {
    if (err) {
      console.error('[adminRequired] DB error:', err);
      return res.status(500).json({ ok: false, message: '서버 오류' });
    }

    const isAdmin = row && Number(row.is_admin) === 1;
    if (!isAdmin) {
      return res
        .status(403)
        .json({ ok: false, message: '관리자만 접근할 수 있습니다.' });
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
