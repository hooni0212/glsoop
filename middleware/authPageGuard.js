// middleware/authPageGuard.js
// - 로그인 상태 사용자가 로그인 페이지에 재진입하는 것을 서버단에서 차단

const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_ALGORITHM, JWT_ISSUER, JWT_AUDIENCE } = require('../config');
const { getActiveSessionBySid } = require('../utils/authSession');
const { clearAuthCookie } = require('../utils/authCookie');

function isSafeInternalPath(value) {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.startsWith('/\\')
  );
}

function shouldBlockAuthPage(pathname) {
  if (typeof pathname !== 'string') return false;
  const purePath = pathname.split('?')[0].split('#')[0];
  return (
    purePath === '/html/login.html' ||
    purePath === '/html/login' ||
    purePath === '/html/signup.html' ||
    purePath === '/html/signup' ||
    purePath === '/html/forgot-password.html' ||
    purePath === '/html/forgot-password'
  );
}

function redirectAuthenticatedFromLogin(req, res, next) {
  const token = req.cookies?.token;
  if (!token) {
    return next();
  }

  jwt.verify(
    token,
    JWT_SECRET,
    {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    },
    async (err, decoded) => {
      if (err || !decoded?.id) {
        clearAuthCookie(res);
        return next();
      }

      if (decoded?.sid) {
        try {
          const session = await getActiveSessionBySid(decoded.sid);
          if (!session || Number(session.user_id) !== Number(decoded.id)) {
            clearAuthCookie(res);
            return next();
          }
        } catch (sessionError) {
          console.error('[authPageGuard] session lookup failed:', sessionError);
          return next();
        }
      }

      const requestedNext =
        typeof req.query?.next === 'string' ? req.query.next.trim() : '';
      const hasSafeNext = isSafeInternalPath(requestedNext);
      const nextPath = hasSafeNext && !shouldBlockAuthPage(requestedNext)
        ? requestedNext
        : '/html/mypage.html';

      return res.redirect(nextPath);
    }
  );
}

module.exports = {
  redirectAuthenticatedFromLogin,
};
