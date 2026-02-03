const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_ALGORITHM, JWT_ISSUER, JWT_AUDIENCE } = require('../config');

/**
 * 요청 객체에서 JWT 토큰을 해석해 사용자 페이로드를 반환합니다.
 * - Bearer 토큰(모바일/앱) 우선
 * - 쿠키 토큰(웹) fallback
 * 유효한 토큰이 없으면 null을 반환하고, 검증 실패도 조용히 무시합니다.
 */
function getViewerFromRequest(req) {
  // 1) Bearer 토큰
  const authHeader = req?.headers?.authorization;
  const bearerToken =
    typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : null;

  // 2) 쿠키 토큰
  const cookieToken = req?.cookies?.token;

  // Bearer 우선, 없으면 쿠키
  const token = bearerToken || cookieToken;
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
};
