const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');

/**
 * 요청 객체에서 JWT 쿠키를 해석해 사용자 페이로드를 반환합니다.
 * 유효한 토큰이 없으면 null을 반환하고, 검증 실패도 조용히 무시합니다.
 */
function getViewerFromRequest(req) {
  const token = req?.cookies?.token;
  if (!token) return null;

  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

function getViewerId(req) {
  const payload = getViewerFromRequest(req);
  return payload?.id || null;
}

module.exports = {
  getViewerFromRequest,
  getViewerId,
};
