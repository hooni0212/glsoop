const rateLimit = require('express-rate-limit');

function createLimiter({ windowMs, max }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      const retryAfter = Number(req?.rateLimit?.resetTime)
        ? Math.max(1, Math.ceil((new Date(req.rateLimit.resetTime).getTime() - Date.now()) / 1000))
        : Math.ceil(windowMs / 1000);
      res.status(429).json({
        ok: false,
        code: 'AUTH_RATE_LIMITED',
        message: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
        retry_after: retryAfter,
      });
    },
  });
}

const loginLimiter = createLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
const signupLimiter = createLimiter({ windowMs: 60 * 60 * 1000, max: 20 });
const passwordLimiter = createLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
const otpResendLimiter = createLimiter({ windowMs: 15 * 60 * 1000, max: 5 });

module.exports = {
  loginLimiter,
  signupLimiter,
  passwordLimiter,
  otpResendLimiter,
};
