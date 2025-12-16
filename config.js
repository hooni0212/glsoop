// config.js
// - 환경 변수 로드 및 공용 설정(메일 전송, JWT 비밀키) 정의
require('dotenv').config();
const nodemailer = require('nodemailer');

const isProduction = process.env.NODE_ENV === 'production';
const baseUrl = process.env.BASE_URL ? process.env.BASE_URL.trim() : '';

const rawJwtSecret = process.env.JWT_SECRET ? process.env.JWT_SECRET.trim() : '';

if (isProduction) {
  if (!rawJwtSecret) {
    throw new Error('[FATAL] Missing JWT_SECRET in production. Set JWT_SECRET in env.');
  }
  if (rawJwtSecret.length < 32) {
    throw new Error('[FATAL] JWT_SECRET is too short (<32). Use a strong random secret.');
  }
} else if (!rawJwtSecret) {
  console.warn(
    '[warn] JWT_SECRET not set. Using DEV fallback secret (development only).'
  );
}

if (isProduction && !baseUrl) {
  console.warn('[warn] BASE_URL is not set in production. Set BASE_URL to the public site URL.');
}

const gmailUser = process.env.GMAIL_USER ? process.env.GMAIL_USER.trim() : '';
const gmailPass = process.env.GMAIL_PASS ? process.env.GMAIL_PASS.trim() : '';

// 현재 설정이 잘 전달되었는지 확인용 로깅(비밀번호 원문은 노출하지 않음)
if (!isProduction) {
  console.log('GMAIL_USER =', gmailUser);
  console.log('GMAIL_PASS length =', gmailPass ? gmailPass.length : 0);
}

if (isProduction && (!gmailUser || !gmailPass)) {
  throw new Error(
    '[FATAL] Missing GMAIL_USER or GMAIL_PASS in production. Set email credentials.'
  );
} else if (!isProduction && (!gmailUser || !gmailPass)) {
  console.warn(
    '[warn] GMAIL_USER or GMAIL_PASS not set. Mail transporter may not function (development only).'
  );
}

// Gmail SMTP 트랜스포터 생성 (2단계 인증 + 앱 비밀번호 필요)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: gmailUser,
    pass: gmailPass,
  },
});

// 서버 전역에서 공유하는 JWT 비밀키
const JWT_SECRET = rawJwtSecret || 'DEV_ONLY_FALLBACK_SECRET';

module.exports = {
  transporter,
  JWT_SECRET,
};
