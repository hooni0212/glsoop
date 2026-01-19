const rateLimit = require('express-rate-limit');

function createLimiter({ windowMs, max }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        ok: false,
        message: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
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
