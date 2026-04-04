// config.js
// - 환경 변수 로드 및 공용 설정(메일 전송, JWT 비밀키) 정의
require('dotenv').config();
const nodemailer = require('nodemailer');

const isProduction = process.env.NODE_ENV === 'production';
const baseUrl = process.env.BASE_URL ? process.env.BASE_URL.trim() : '';
const getTrimmedEnv = (key, fallback = '') => {
  const raw = process.env[key];
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  return trimmed || fallback;
};
const rawJwtAlgorithm = process.env.JWT_ALGORITHM
  ? process.env.JWT_ALGORITHM.trim()
  : '';
const rawJwtIssuer = process.env.JWT_ISSUER ? process.env.JWT_ISSUER.trim() : '';
const rawJwtAudience = process.env.JWT_AUDIENCE ? process.env.JWT_AUDIENCE.trim() : '';
const rawResetTokenHmacSecret = process.env.RESET_TOKEN_HMAC_SECRET
  ? process.env.RESET_TOKEN_HMAC_SECRET.trim()
  : '';
const rawAuthCookieDomain = process.env.AUTH_COOKIE_DOMAIN
  ? process.env.AUTH_COOKIE_DOMAIN.trim()
  : '';
const rawLegacyTokenSunsetAt = process.env.LEGACY_TOKEN_SUNSET_AT
  ? process.env.LEGACY_TOKEN_SUNSET_AT.trim()
  : '2026-03-07T00:00:00+09:00';

const rawJwtSecret = process.env.JWT_SECRET ? process.env.JWT_SECRET.trim() : '';

if (isProduction) {
  if (!rawJwtSecret) {
    throw new Error('[FATAL] 운영 환경에 JWT_SECRET이 없습니다. 환경변수에 안전한 값을 설정하세요.');
  }
  if (rawJwtSecret.length < 32) {
    throw new Error('[FATAL] JWT_SECRET 길이가 32자 미만입니다. 충분히 긴 랜덤 문자열을 사용하세요.');
  }
} else if (!rawJwtSecret) {
  console.warn(
    '[warn] JWT_SECRET이 비어 있습니다. 개발 환경에서만 임시 비밀키를 사용합니다.'
  );
}

if (isProduction && !baseUrl) {
  console.warn('[warn] 운영 환경에 BASE_URL이 설정되지 않았습니다. 서비스 공개 URL을 입력하세요.');
}

const gmailUser = process.env.GMAIL_USER ? process.env.GMAIL_USER.trim() : '';
const gmailPass = process.env.GMAIL_PASS ? process.env.GMAIL_PASS.trim() : '';

// 현재 설정이 잘 전달되었는지 확인용 로깅(비밀번호 원문은 노출하지 않음)
if (!isProduction) {
  console.log('[dev] GMAIL_USER =', gmailUser);
  console.log('[dev] GMAIL_PASS length =', gmailPass ? gmailPass.length : 0);
}

if (isProduction && (!gmailUser || !gmailPass)) {
  throw new Error(
    '[FATAL] 운영 환경에 GMAIL_USER 또는 GMAIL_PASS가 없습니다. 메일 계정 정보를 설정하세요.'
  );
} else if (!isProduction && (!gmailUser || !gmailPass)) {
  console.warn(
    '[warn] GMAIL_USER 또는 GMAIL_PASS가 없습니다. 개발 환경에서는 메일 전송이 동작하지 않을 수 있습니다.'
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
const JWT_ALGORITHM = rawJwtAlgorithm || 'HS256';
const RESET_TOKEN_HMAC_SECRET = rawResetTokenHmacSecret || JWT_SECRET;
const AUTH_COOKIE_DOMAIN = rawAuthCookieDomain || '';

const parseJwtAudience = (value) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.includes(',')) return trimmed;
  const list = trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return list.length > 0 ? list : null;
};

let JWT_ISSUER = rawJwtIssuer;
if (!JWT_ISSUER && baseUrl) {
  try {
    JWT_ISSUER = new URL(baseUrl).origin;
  } catch (error) {
    JWT_ISSUER = '';
  }
}

if (!JWT_ISSUER) {
  JWT_ISSUER = 'glsoop';
}

const JWT_AUDIENCE = parseJwtAudience(rawJwtAudience) || 'glsoop-client';
const LEGACY_TOKEN_SUNSET_AT = rawLegacyTokenSunsetAt;
const LEGACY_TOKEN_SUNSET_AT_MS = new Date(LEGACY_TOKEN_SUNSET_AT).getTime();
const LEGAL_CONFIG = {
  versions: {
    terms: getTrimmedEnv('LEGAL_TERMS_VERSION', '2026-02-27.terms.v1'),
    privacy: getTrimmedEnv('LEGAL_PRIVACY_VERSION', '2026-02-27.privacy.v1'),
    marketing: getTrimmedEnv('LEGAL_MARKETING_VERSION', '2026-02-27.marketing.v1'),
    guidelines: getTrimmedEnv('LEGAL_GUIDELINES_VERSION', '2026-02-27.guidelines.v1'),
  },
  effective_dates: {
    terms: getTrimmedEnv('LEGAL_TERMS_EFFECTIVE_DATE', '2026-02-27'),
    privacy: getTrimmedEnv('LEGAL_PRIVACY_EFFECTIVE_DATE', '2026-02-27'),
    guidelines: getTrimmedEnv('LEGAL_GUIDELINES_EFFECTIVE_DATE', '2026-02-27'),
  },
  contacts: {
    department: getTrimmedEnv('PRIVACY_CONTACT_DEPARTMENT', '글숲 개인정보보호팀'),
    email: getTrimmedEnv('PRIVACY_CONTACT_EMAIL', 'privacy@glsoop.com'),
    phone: getTrimmedEnv('PRIVACY_CONTACT_PHONE', '0000-0000'),
    dpo_name: getTrimmedEnv('PRIVACY_DPO_NAME', '개인정보 보호책임자 미지정'),
  },
};

if (Number.isNaN(LEGACY_TOKEN_SUNSET_AT_MS)) {
  throw new Error('[FATAL] LEGACY_TOKEN_SUNSET_AT 형식이 올바르지 않습니다. ISO datetime을 사용하세요.');
}

if (isProduction) {
  if (!rawJwtIssuer) {
    console.warn('[warn] 운영 환경에 JWT_ISSUER가 설정되지 않았습니다. 기본값으로 동작합니다.');
  }
  if (!rawJwtAudience) {
    console.warn('[warn] 운영 환경에 JWT_AUDIENCE가 설정되지 않았습니다. 기본값으로 동작합니다.');
  }
  if (!rawResetTokenHmacSecret) {
    throw new Error(
      '[FATAL] 운영 환경에 RESET_TOKEN_HMAC_SECRET이 없습니다. 안전한 랜덤 문자열을 설정하세요.'
    );
  }
}

module.exports = {
  BASE_URL: baseUrl,
  transporter,
  JWT_SECRET,
  JWT_ALGORITHM,
  JWT_ISSUER,
  JWT_AUDIENCE,
  RESET_TOKEN_HMAC_SECRET,
  LEGACY_TOKEN_SUNSET_AT,
  LEGACY_TOKEN_SUNSET_AT_MS,
  AUTH_COOKIE_DOMAIN,
  LEGAL_CONFIG,
};
