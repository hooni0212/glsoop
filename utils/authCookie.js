const { AUTH_COOKIE_DOMAIN } = require('../config');

const AUTH_COOKIE_NAME = 'token';

function buildAuthCookieOptions({ maxAgeMs = null, forClear = false } = {}) {
  const options = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };

  if (AUTH_COOKIE_DOMAIN) {
    options.domain = AUTH_COOKIE_DOMAIN;
  }

  if (!forClear && Number.isFinite(maxAgeMs) && maxAgeMs > 0) {
    options.maxAge = Math.floor(maxAgeMs);
  }

  return options;
}

function setAuthCookie(res, token, maxAgeMs) {
  res.cookie(AUTH_COOKIE_NAME, token, buildAuthCookieOptions({ maxAgeMs }));
}

function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE_NAME, buildAuthCookieOptions({ forClear: true }));
}

module.exports = {
  AUTH_COOKIE_NAME,
  buildAuthCookieOptions,
  setAuthCookie,
  clearAuthCookie,
};
