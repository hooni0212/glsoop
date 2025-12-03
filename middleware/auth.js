// middleware/auth.js
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');

// 로그인 필수 라우트용 미들웨어
function authRequired(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    return res
      .status(401)
      .json({ ok: false, message: '로그인이 필요합니다.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({
        ok: false,
        message: '토큰이 만료되었거나 유효하지 않습니다.',
      });
    }
    req.user = decoded; // { id, name, nickname, email, isAdmin, isVerified }
    next();
  });
}

// 관리자 전용 라우트용 미들웨어
function adminRequired(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res
      .status(403)
      .json({ ok: false, message: '관리자만 접근할 수 있습니다.' });
  }
  next();
}

module.exports = {
  authRequired,
  adminRequired,
};
