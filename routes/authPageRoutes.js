// routes/authPageRoutes.js
// - 인증 페이지 접근 가드

const express = require('express');
const { redirectAuthenticatedFromLogin } = require('../middleware/authPageGuard');

const router = express.Router();

router.get(
  [
    '/html/login.html',
    '/html/login',
    '/html/signup.html',
    '/html/signup',
    '/html/forgot-password.html',
    '/html/forgot-password',
  ],
  redirectAuthenticatedFromLogin,
  (req, res, next) => next()
);

module.exports = router;
