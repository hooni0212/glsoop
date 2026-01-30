// middleware/adminPageGuard.js
// - 관리자 페이지(HTML) 접근을 "서버단"에서 차단/허용
// - 비로그인: 로그인 페이지로 리다이렉트(+ next)
// - 비관리자: 404로 숨김(완전 차단)
// - 관리자: 통과

const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET, JWT_ALGORITHM, JWT_ISSUER, JWT_AUDIENCE } = require('../config');

function adminPageRequired(req, res, next) {
  const token = req.cookies?.token;
  const nextUrl = encodeURIComponent(req.originalUrl || '/admin');

  // 1) 로그인 안 됨 -> 로그인으로
  if (!token) {
    return res.redirect(`/html/login.html?next=${nextUrl}`);
  }

  // 2) 토큰 검증
  jwt.verify(
    token,
    JWT_SECRET,
    {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    },
    (err, decoded) => {
      if (err || !decoded?.id) {
        // 토큰이 깨졌거나 만료됐으면 쿠키 지우고 로그인으로
        res.clearCookie('token', {
          path: '/',
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
        });
        return res.redirect(`/html/login.html?next=${nextUrl}`);
      }

      // 3) "진짜 관리자"인지 DB로 재확인 (권한 변경 즉시 반영)
      db.get('SELECT is_admin FROM users WHERE id = ?', [decoded.id], (dbErr, row) => {
        if (dbErr) {
          console.error('[adminPageRequired] DB error:', dbErr);
          return res.status(500).send('Server Error');
        }

        const isAdmin = row && Number(row.is_admin) === 1;

        // 비관리자면 존재 숨김(완전 차단)
        if (!isAdmin) {
          return res.status(404).send('Not Found');
        }

        req.user = decoded;
        req.user.isAdmin = true;
        next();
      });
    }
  );
}

module.exports = { adminPageRequired };
