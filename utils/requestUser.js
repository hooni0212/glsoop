const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_ALGORITHM, JWT_ISSUER, JWT_AUDIENCE } = require('../config');
const { extractToken } = require('./token');

/**
 * 요청 객체에서 JWT(Bearer 우선, 쿠키 fallback)를 해석해 사용자 페이로드를 반환합니다.
 * 유효한 토큰이 없으면 null을 반환하고, 검증 실패도 조용히 무시합니다.
 */
function getViewerFromRequest(req) {
  const token = extractToken(req);
  if (!token) return null;

  try {
    return jwt.verify(token, JWT_SECRET, {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
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
  extractToken,
};
