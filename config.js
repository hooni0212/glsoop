// config.js
// - 환경 변수 로드 및 공용 설정(메일 전송, JWT 비밀키) 정의
require('dotenv').config();
const nodemailer = require('nodemailer');

// 현재 설정이 잘 전달되었는지 확인용 로깅(비밀번호 원문은 노출하지 않음)
console.log('GMAIL_USER =', process.env.GMAIL_USER);
console.log(
  'GMAIL_PASS length =',
  process.env.GMAIL_PASS ? process.env.GMAIL_PASS.length : 0
);

// Gmail SMTP 트랜스포터 생성 (2단계 인증 + 앱 비밀번호 필요)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

// 서버 전역에서 공유하는 JWT 비밀키
const JWT_SECRET = process.env.JWT_SECRET || 'DEV_ONLY_FALLBACK_SECRET';

module.exports = {
  transporter,
  JWT_SECRET,
};
