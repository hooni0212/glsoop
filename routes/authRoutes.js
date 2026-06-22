// routes/authRoutes.js
// - 회원가입, 인증, 로그인/로그아웃, 프로필 수정 등 인증 관련 API를 담당
const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const db = require('../db');
const {
  transporter,
  JWT_SECRET,
  JWT_ALGORITHM,
  JWT_ISSUER,
  JWT_AUDIENCE,
  RESET_TOKEN_HMAC_SECRET,
  LEGAL_CONFIG,
} = require('../config');
const { sendPasswordResetEmail, sendSignupOtpEmail } = require('../services/mailer');
const { authRequired } = require('../middleware/auth');
const { getBaseUrl } = require('../utils/baseUrl');
const { cleanupExpiredPending } = require('../utils/pendingSignup');
const { logUxEvent } = require('../utils/uxEvents');
const {
  ACCOUNT_STATUS_ACTIVE,
  ACCOUNT_CLOSURE_CONFIRM_TEXT,
  buildPublicDisplayName,
  isDeactivatedAccount,
  isWithinDeactivationGracePeriod,
  purgeUserAccount,
  deactivateUserAccount,
  restoreDeactivatedUserAccount,
} = require('../utils/accountLifecycle');
const {
  loginLimiter,
  signupLimiter,
  passwordLimiter,
  otpResendLimiter,
} = require('../middleware/rateLimiters');
const {
  createAuthSession,
  getSessionTtlMs,
  getIpHashFromRequest,
  getUserAgent,
  revokeAuthSession,
  revokeAllAuthSessionsForUser,
  listActiveSessionsForUser,
} = require('../utils/authSession');
const { extractToken } = require('../utils/token');
const { setAuthCookie, clearAuthCookie } = require('../utils/authCookie');
const { appendViewerBlockedAuthorCondition } = require('../utils/safety');

const router = express.Router();

const OTP_TTL_MINUTES = 10;
const OTP_COOLDOWN_MS = 1000 * 60;
const PENDING_TTL_HOURS = 24;
const MAX_OTP_ATTEMPTS = 5;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

const LOGIN_FAIL_LIMIT = 5;
const LOGIN_LOCK_WINDOW_MS = 15 * 60 * 1000;

const EMAIL_SEND_FAILURE_STATUS = 503;
const ACCOUNT_CLOSURE_MODES = new Set(['deactivate', 'delete']);
const PROFILE_PHOTO_PREMIUM_ENTITLEMENT_KEY =
  process.env.PROFILE_PHOTO_PREMIUM_ENTITLEMENT_KEY ||
  process.env.PHOTO_SAVE_PREMIUM_ENTITLEMENT_KEY ||
  'premium:glsoop';

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

function getMailErrorDetails(error) {
  if (!error || typeof error !== 'object') {
    return { message: String(error || 'unknown error') };
  }
  return {
    message: error.message || 'unknown error',
    code: error.code || null,
    responseCode: error.responseCode || null,
    command: error.command || null,
  };
}

function sendAuthError(res, status, code, message, extras = {}) {
  return res.status(status).json({ ok: false, code, message, ...extras });
}

async function issueLoginSuccess(res, req, user, normalizedEmail, rememberMe) {
  await clearLoginState(user.id);

  const tokenTtlMs = getSessionTtlMs(rememberMe);
  const session = await createAuthSession({
    userId: user.id,
    rememberMe,
    req,
  });

  const token = jwt.sign(
    {
      id: user.id,
      sid: session.sid,
      name: user.name,
      nickname: user.nickname,
      email: user.email,
      isAdmin: !!user.is_admin,
      isVerified: !!user.is_verified,
    },
    JWT_SECRET,
    {
      expiresIn: Math.floor(tokenTtlMs / 1000),
      algorithm: JWT_ALGORITHM,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }
  );

  setAuthCookie(res, token, tokenTtlMs);

  await logLoginEvent({
    userId: user.id,
    email: normalizedEmail,
    req,
    outcome: 'success',
    failureCode: null,
    rememberMe,
  });

  logUxEvent({
    user_id: user.id,
    event_name: 'login_success',
    source: 'server_auth',
  }).catch((eventErr) => {
    console.error('login ux event 기록 실패:', eventErr);
  });

  return res.json({
    ok: true,
    message: `환영합니다, ${user.name}님!`,
    token,
    name: user.name,
    nickname: user.nickname || null,
    remember_me: rememberMe,
    session_expires_at: session.expiresAt,
    remember_notice_required: rememberMe,
  });
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
  }
  if (typeof value === 'number') return value === 1;
  return false;
}

function normalizeVersion(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function isBooleanLike(value) {
  return (
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    typeof value === 'number'
  );
}

function getLegalVersions() {
  return {
    terms: LEGAL_CONFIG?.versions?.terms || '',
    privacy: LEGAL_CONFIG?.versions?.privacy || '',
    marketing: LEGAL_CONFIG?.versions?.marketing || '',
  };
}

const SIGNUP_EMAIL_DRY_RUN = normalizeBoolean(
  process.env.AUTH_SIGNUP_EMAIL_DRY_RUN
);

async function insertUserConsentEvent({
  userId,
  consentType,
  consentVersion,
  isGranted,
  source,
  ipHash = null,
  userAgent = null,
  createdAt = null,
}) {
  const createdAtValue = createdAt ? String(createdAt) : toIso(Date.now());
  await dbRun(
    `
    INSERT INTO user_consent_events (
      user_id,
      consent_type,
      consent_version,
      is_granted,
      source,
      ip_hash,
      user_agent,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      consentType,
      consentVersion,
      isGranted ? 1 : 0,
      source,
      ipHash,
      userAgent,
      createdAtValue,
    ]
  );
}

function isStrongPassword(password) {
  if (typeof password !== 'string') {
    return {
      ok: false,
      fieldErrors: { pw: '비밀번호를 입력해주세요.' },
      message: '비밀번호를 입력해주세요.',
      code: 'AUTH_PASSWORD_REQUIRED',
    };
  }

  const raw = password.trim();
  if (raw.length < 8) {
    return {
      ok: false,
      fieldErrors: { pw: '비밀번호는 8자 이상이어야 합니다.' },
      message: '비밀번호는 8자 이상이어야 합니다.',
      code: 'AUTH_PASSWORD_TOO_SHORT',
    };
  }

  const hasLetter = /[a-zA-Z]/.test(raw);
  const hasNumber = /\d/.test(raw);
  if (!hasLetter || !hasNumber) {
    return {
      ok: false,
      fieldErrors: { pw: '비밀번호는 영문과 숫자를 모두 포함해야 합니다.' },
      message: '비밀번호는 영문과 숫자를 모두 포함해야 합니다.',
      code: 'AUTH_PASSWORD_WEAK',
    };
  }

  return {
    ok: true,
    normalized: raw,
  };
}

function maskEmail(address) {
  if (!address || typeof address !== 'string') return '';
  const trimmed = address.trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex === -1) return trimmed;
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  const visibleLocal = local.length <= 3 ? local : local.slice(0, 3);
  const maskedLocal = local.length > 3 ? `${visibleLocal}****` : visibleLocal;
  return `${maskedLocal}@${domain}`;
}

function calculateRetryAfterSeconds(createdAt) {
  if (!createdAt) return 0;
  const createdAtMs = new Date(createdAt).getTime();
  if (Number.isNaN(createdAtMs)) return 0;
  const elapsedMs = Date.now() - createdAtMs;
  if (elapsedMs >= OTP_COOLDOWN_MS) return 0;
  return Math.ceil((OTP_COOLDOWN_MS - elapsedMs) / 1000);
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

function toMs(value) {
  if (!value) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  // SQLite datetime('now') 문자열(예: 2026-02-27 01:23:45)은 UTC로 취급한다.
  const sqliteUtcMatch = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/
  );
  const hasTzSuffix = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(raw);
  if (sqliteUtcMatch && !hasTzSuffix) {
    const year = Number(sqliteUtcMatch[1]);
    const month = Number(sqliteUtcMatch[2]) - 1;
    const day = Number(sqliteUtcMatch[3]);
    const hour = Number(sqliteUtcMatch[4]);
    const minute = Number(sqliteUtcMatch[5]);
    const second = sqliteUtcMatch[6] ? Number(sqliteUtcMatch[6]) : 0;
    const milli = sqliteUtcMatch[7]
      ? Number(sqliteUtcMatch[7].padEnd(3, '0').slice(0, 3))
      : 0;
    return Date.UTC(year, month, day, hour, minute, second, milli);
  }

  const parsed = new Date(raw).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function calculateLockRetrySeconds(lockedUntil, nowMs = Date.now()) {
  const lockedMs = toMs(lockedUntil);
  if (!lockedMs) return 0;
  const diff = lockedMs - nowMs;
  if (diff <= 0) return 0;
  return Math.ceil(diff / 1000);
}

function hashPasswordResetToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  return crypto
    .createHmac('sha256', RESET_TOKEN_HMAC_SECRET)
    .update(rawToken)
    .digest('hex');
}

function timingSafeEqualHex(leftHex, rightHex) {
  if (
    typeof leftHex !== 'string' ||
    typeof rightHex !== 'string' ||
    leftHex.length !== rightHex.length
  ) {
    return false;
  }
  try {
    const left = Buffer.from(leftHex, 'hex');
    const right = Buffer.from(rightHex, 'hex');
    if (left.length !== right.length || left.length === 0) {
      return false;
    }
    return crypto.timingSafeEqual(left, right);
  } catch (error) {
    return false;
  }
}

async function findPasswordResetTokenRow(rawToken) {
  const tokenHash = hashPasswordResetToken(rawToken);
  if (!tokenHash) return null;

  const row = await dbGet(
    `
    SELECT
      id,
      user_id,
      token_hash,
      expires_at,
      used_at,
      revoked_at
    FROM password_reset_tokens
    WHERE token_hash = ?
    ORDER BY id DESC
    LIMIT 1
    `,
    [tokenHash]
  );

  if (!row) return null;
  if (!timingSafeEqualHex(tokenHash, row.token_hash)) {
    return null;
  }
  return row;
}

function classifyPasswordResetToken(row, nowMs = Date.now()) {
  if (!row) return 'invalid';
  if (row.revoked_at) return 'invalid';
  if (row.used_at) return 'used';
  const expiresMs = toMs(row.expires_at);
  if (!expiresMs || expiresMs <= nowMs) return 'expired';
  return 'valid';
}

async function getLoginState(userId) {
  if (!userId) return null;
  return dbGet(
    `
    SELECT user_id, failed_count, window_started_at, locked_until
    FROM auth_login_state
    WHERE user_id = ?
    `,
    [userId]
  );
}

async function clearLoginState(userId) {
  if (!userId) return;
  await dbRun(
    `
    INSERT INTO auth_login_state (user_id, failed_count, window_started_at, locked_until, updated_at)
    VALUES (?, 0, NULL, NULL, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      failed_count = 0,
      window_started_at = NULL,
      locked_until = NULL,
      updated_at = excluded.updated_at
    `,
    [userId, toIso(Date.now())]
  );
}

async function registerLoginFailure(userId) {
  const nowMs = Date.now();
  const nowIso = toIso(nowMs);
  const existing = await getLoginState(userId);

  let failedCount = 1;
  let windowStartedAt = nowIso;
  let lockedUntil = null;

  if (existing) {
    const existingWindowMs = toMs(existing.window_started_at);
    const existingLockedMs = toMs(existing.locked_until);

    if (existingLockedMs && existingLockedMs > nowMs) {
      return {
        locked: true,
        failed_count: Number(existing.failed_count) || LOGIN_FAIL_LIMIT,
        retry_after: calculateLockRetrySeconds(existing.locked_until, nowMs),
      };
    }

    if (existingWindowMs && nowMs - existingWindowMs <= LOGIN_LOCK_WINDOW_MS) {
      failedCount = (Number(existing.failed_count) || 0) + 1;
      windowStartedAt = existing.window_started_at || nowIso;
    }
  }

  if (failedCount >= LOGIN_FAIL_LIMIT) {
    lockedUntil = toIso(nowMs + LOGIN_LOCK_WINDOW_MS);
  }

  await dbRun(
    `
    INSERT INTO auth_login_state (user_id, failed_count, window_started_at, locked_until, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      failed_count = excluded.failed_count,
      window_started_at = excluded.window_started_at,
      locked_until = excluded.locked_until,
      updated_at = excluded.updated_at
    `,
    [userId, failedCount, windowStartedAt, lockedUntil, nowIso]
  );

  return {
    locked: Boolean(lockedUntil),
    failed_count: failedCount,
    retry_after: lockedUntil ? calculateLockRetrySeconds(lockedUntil, nowMs) : 0,
  };
}

async function logLoginEvent({ userId = null, email = '', req, outcome, failureCode = null, rememberMe = false }) {
  const normalizedEmail = normalizeEmail(email) || null;
  try {
    await dbRun(
      `
      INSERT INTO auth_login_events (
        user_id,
        email,
        ip_hash,
        user_agent,
        outcome,
        failure_code,
        remember_me
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        userId || null,
        normalizedEmail,
        getIpHashFromRequest(req),
        getUserAgent(req),
        outcome,
        failureCode,
        rememberMe ? 1 : 0,
      ]
    );
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[auth/login-event] failed to record:', error);
    }
  }
}

function seedDefaultCosmeticsForSignup(userId, done) {
  db.run(
    `
    INSERT OR IGNORE INTO user_cosmetics (user_id, cosmetic_id, source)
    SELECT ?, id, 'default'
    FROM cosmetic_items
    WHERE key = 'badge_default_seedling'
    `,
    [userId],
    (grantErr) => {
      if (grantErr) {
        return done(grantErr);
      }

      db.run(
        `
        INSERT OR IGNORE INTO user_profile_backgrounds (user_id, background_id, source)
        SELECT ?, id, 'default'
        FROM profile_background_items
        WHERE key = 'background_default_paper'
        `,
        [userId],
        (backgroundErr) => {
          if (backgroundErr) {
            return done(backgroundErr);
          }

          db.run(
            `
            INSERT OR IGNORE INTO user_profile_cosmetics (
              user_id,
              primary_badge_key,
              profile_background_key,
              showcase_badge_keys_json,
              header_stickers_json
            )
            VALUES (?, 'badge_default_seedling', 'background_default_paper', '[]', '[]')
            `,
            [userId],
            (profileErr) => {
              if (profileErr) {
                return done(profileErr);
              }
              return done(null);
            }
          );
        }
      );
    }
  );
}

async function backfillUserAchievementStates(userId) {
  const campaign = await dbGet(
    "SELECT id FROM quest_campaigns WHERE campaign_type = 'permanent' AND name = '업적' LIMIT 1"
  );
  if (!campaign?.id) return;
  await dbRun(
    `INSERT OR IGNORE INTO user_quest_state
      (user_id, campaign_id, template_id, progress, reset_key)
     SELECT ?, qci.campaign_id, qci.template_id, 0, 'permanent'
     FROM quest_campaign_items qci
     JOIN quest_templates qt ON qt.id = qci.template_id
     WHERE qci.campaign_id = ? AND qt.template_kind = 'achievement' AND qt.is_active = 1`,
    [userId, campaign.id]
  );
}

async function commitPendingSignup(pending) {
  const legalVersions = getLegalVersions();
  const marketingOptIn = normalizeBoolean(pending?.marketing_email_opt_in);
  const consentAt = pending?.consent_recorded_at || toIso(Date.now());
  const consentIpHash = pending?.consent_ip_hash || null;
  const consentUserAgent = pending?.consent_user_agent || null;
  const termsVersion = normalizeVersion(pending?.terms_version) || legalVersions.terms;
  const privacyVersion = normalizeVersion(pending?.privacy_version) || legalVersions.privacy;
  const marketingVersion =
    normalizeVersion(pending?.marketing_version) || legalVersions.marketing;

  await dbRun('BEGIN IMMEDIATE');
  try {
    const userInsert = await dbRun(
      `
      INSERT INTO users (
        name,
        nickname,
        email,
        pw,
        is_admin,
        is_verified,
        verification_token,
        verification_expires,
        marketing_email_opt_in,
        marketing_opt_in_updated_at
      )
      VALUES (?, ?, ?, ?, 0, 1, NULL, NULL, ?, ?)
      `,
      [
        pending.name,
        pending.nickname,
        pending.email,
        pending.pw_hash,
        marketingOptIn ? 1 : 0,
        consentAt,
      ]
    );

    const newUserId = userInsert.lastID;

    await new Promise((resolve, reject) => {
      seedDefaultCosmeticsForSignup(newUserId, (cosmeticErr) => {
        if (cosmeticErr) {
          reject(cosmeticErr);
          return;
        }
        resolve();
      });
    });

    await insertUserConsentEvent({
      userId: newUserId,
      consentType: 'terms',
      consentVersion: termsVersion,
      isGranted: true,
      source: 'signup',
      ipHash: consentIpHash,
      userAgent: consentUserAgent,
      createdAt: consentAt,
    });
    await insertUserConsentEvent({
      userId: newUserId,
      consentType: 'privacy',
      consentVersion: privacyVersion,
      isGranted: true,
      source: 'signup',
      ipHash: consentIpHash,
      userAgent: consentUserAgent,
      createdAt: consentAt,
    });
    await insertUserConsentEvent({
      userId: newUserId,
      consentType: 'marketing',
      consentVersion: marketingVersion,
      isGranted: marketingOptIn,
      source: 'signup',
      ipHash: consentIpHash,
      userAgent: consentUserAgent,
      createdAt: consentAt,
    });

    await dbRun('DELETE FROM pending_signups WHERE id = ?', [pending.id]);
    await dbRun('COMMIT');
    return newUserId;
  } catch (error) {
    try {
      await dbRun('ROLLBACK');
    } catch (rollbackError) {
      console.error('[commitPendingSignup] rollback failed:', rollbackError);
    }
    throw error;
  }
}

async function verifyJwtOrNull(token) {
  if (!token) return null;
  return new Promise((resolve) => {
    jwt.verify(
      token,
      JWT_SECRET,
      {
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      },
      (err, decoded) => {
        if (err || !decoded) {
          resolve(null);
          return;
        }
        resolve(decoded);
      }
    );
  });
}

// 6-1) 회원가입 + 이메일 OTP 발송
router.post('/signup', signupLimiter, async (req, res) => {
  const {
    name,
    nickname,
    email,
    pw,
    age_confirmed: ageConfirmedRaw,
    terms_agreed: termsAgreedRaw,
    privacy_agreed: privacyAgreedRaw,
    marketing_email_opt_in: marketingEmailOptInRaw,
    terms_version: termsVersionRaw,
    privacy_version: privacyVersionRaw,
    marketing_version: marketingVersionRaw,
  } = req.body || {};

  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const trimmedNickname = typeof nickname === 'string' ? nickname.trim() : '';
  const normalizedEmail = normalizeEmail(email);
  const ageConfirmed = normalizeBoolean(ageConfirmedRaw);
  const termsAgreed = normalizeBoolean(termsAgreedRaw);
  const privacyAgreed = normalizeBoolean(privacyAgreedRaw);
  const marketingEmailOptIn = normalizeBoolean(marketingEmailOptInRaw);
  const termsVersion = normalizeVersion(termsVersionRaw);
  const privacyVersion = normalizeVersion(privacyVersionRaw);
  const marketingVersion = normalizeVersion(marketingVersionRaw);
  const legalVersions = getLegalVersions();

  if (!trimmedName || !trimmedNickname || !normalizedEmail || !pw) {
    return sendAuthError(
      res,
      400,
      'AUTH_SIGNUP_REQUIRED_FIELDS',
      '이름, 닉네임, 이메일, 비밀번호를 모두 입력하세요.',
      {
        field_errors: {
          ...(trimmedName ? {} : { name: '이름을 입력해주세요.' }),
          ...(trimmedNickname ? {} : { nickname: '닉네임을 입력해주세요.' }),
          ...(normalizedEmail ? {} : { email: '이메일을 입력해주세요.' }),
          ...(pw ? {} : { pw: '비밀번호를 입력해주세요.' }),
        },
      }
    );
  }

  if (!ageConfirmed) {
    return sendAuthError(
      res,
      400,
      'AUTH_SIGNUP_AGE_REQUIRED',
      '만 14세 이상만 가입할 수 있습니다.',
      {
        field_errors: {
          age_confirmed: '만 14세 이상 여부를 확인해주세요.',
        },
      }
    );
  }

  const consentFieldErrors = {};
  if (!termsAgreed) {
    consentFieldErrors.terms_agreed = '서비스 이용약관 동의가 필요합니다.';
  }
  if (!privacyAgreed) {
    consentFieldErrors.privacy_agreed = '개인정보 수집 및 이용 동의가 필요합니다.';
  }

  if (Object.keys(consentFieldErrors).length > 0) {
    return sendAuthError(
      res,
      400,
      'AUTH_SIGNUP_REQUIRED_CONSENTS',
      '필수 약관 동의를 완료해주세요.',
      { field_errors: consentFieldErrors }
    );
  }

  const legalFieldErrors = {};
  if (termsVersion !== legalVersions.terms) {
    legalFieldErrors.terms_version = '이용약관 버전이 변경되었습니다. 페이지를 새로고침 해주세요.';
  }
  if (privacyVersion !== legalVersions.privacy) {
    legalFieldErrors.privacy_version =
      '개인정보 처리방침 버전이 변경되었습니다. 페이지를 새로고침 해주세요.';
  }
  if (marketingVersion && marketingVersion !== legalVersions.marketing) {
    legalFieldErrors.marketing_version =
      '마케팅 동의 문서 버전이 변경되었습니다. 페이지를 새로고침 해주세요.';
  }

  if (Object.keys(legalFieldErrors).length > 0) {
    return sendAuthError(
      res,
      409,
      'AUTH_SIGNUP_LEGAL_VERSION_MISMATCH',
      '약관 버전이 변경되었습니다. 페이지를 새로고침 후 다시 시도해주세요.',
      { field_errors: legalFieldErrors }
    );
  }

  const resolvedMarketingVersion = marketingVersion || legalVersions.marketing;

  const passwordValidation = isStrongPassword(pw);
  if (!passwordValidation.ok) {
    return sendAuthError(
      res,
      400,
      passwordValidation.code,
      passwordValidation.message,
      { field_errors: passwordValidation.fieldErrors }
    );
  }

  try {
    await cleanupExpiredPending();

    const hashed = await bcrypt.hash(passwordValidation.normalized, 10);

    const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (existingUser) {
      return sendAuthError(res, 409, 'AUTH_EMAIL_ALREADY_REGISTERED', '이미 가입된 이메일입니다.', {
        field_errors: { email: '이미 가입된 이메일입니다.' },
      });
    }

    const pendingExisting = await dbGet(
      'SELECT id, email FROM pending_signups WHERE email = ?',
      [normalizedEmail]
    );

    if (pendingExisting) {
      const lastOtp = await dbGet(
        `
        SELECT created_at
        FROM pending_otp_verifications
        WHERE pending_id = ?
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [pendingExisting.id]
      );
      const retryAfter = calculateRetryAfterSeconds(lastOtp?.created_at);
      return res.json({
        ok: true,
        message: '이미 가입 진행 중입니다. 이메일 인증을 완료해주세요.',
        pending_id: pendingExisting.id,
        email_masked: maskEmail(pendingExisting.email),
        otp_ttl: OTP_TTL_MINUTES * 60,
        resend_after: retryAfter,
      });
    }

    const otpCode = String(crypto.randomInt(100000, 1000000));
    const otpHash = await bcrypt.hash(otpCode, 10);
    const otpExpiresAt = toIso(Date.now() + 1000 * 60 * OTP_TTL_MINUTES);
    const pendingExpiresAt = toIso(Date.now() + 1000 * 60 * 60 * PENDING_TTL_HOURS);
    const consentRecordedAt = toIso(Date.now());
    const consentIpHash = getIpHashFromRequest(req);
    const consentUserAgent = getUserAgent(req);

    const pendingResult = await dbRun(
      `
      INSERT INTO pending_signups (
        name,
        nickname,
        email,
        pw_hash,
        expires_at,
        age_confirmed,
        terms_version,
        privacy_version,
        marketing_version,
        marketing_email_opt_in,
        consent_ip_hash,
        consent_user_agent,
        consent_recorded_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        trimmedName,
        trimmedNickname,
        normalizedEmail,
        hashed,
        pendingExpiresAt,
        1,
        legalVersions.terms,
        legalVersions.privacy,
        resolvedMarketingVersion,
        marketingEmailOptIn ? 1 : 0,
        consentIpHash,
        consentUserAgent,
        consentRecordedAt,
      ]
    );

    const pendingId = pendingResult.lastID;

    await dbRun(
      `
      INSERT INTO pending_otp_verifications (pending_id, code_hash, expires_at, attempts)
      VALUES (?, ?, ?, 0)
      `,
      [pendingId, otpHash, otpExpiresAt]
    );

    try {
      if (!SIGNUP_EMAIL_DRY_RUN) {
        await sendSignupOtpEmail({
          to: normalizedEmail,
          name: trimmedNickname || trimmedName,
          otpCode,
          resend: false,
        });
      }
    } catch (mailErr) {
      console.error('인증 메일 발송 오류:', getMailErrorDetails(mailErr));
      try {
        await dbRun('DELETE FROM pending_signups WHERE id = ?', [pendingId]);
      } catch (cleanupErr) {
        console.error('회원가입 pending 정리 실패:', cleanupErr);
      }
      return sendAuthError(
        res,
        EMAIL_SEND_FAILURE_STATUS,
        'AUTH_SIGNUP_EMAIL_SEND_FAILED',
        '인증 메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.'
      );
    }

    res.json({
      ok: true,
      message: '인증 번호를 이메일로 발송했습니다.',
      pending_id: pendingId,
      email_masked: maskEmail(normalizedEmail),
      otp_ttl: OTP_TTL_MINUTES * 60,
      resend_after: Math.ceil(OTP_COOLDOWN_MS / 1000),
    });

    logUxEvent({
      event_name: 'signup_success_pending_created',
      source: 'server_auth',
      properties: { pending_id: pendingId },
    }).catch((eventErr) => {
      console.error('signup ux event 기록 실패:', eventErr);
    });
  } catch (error) {
    if (error && error.code === 'SQLITE_CONSTRAINT') {
      return sendAuthError(
        res,
        409,
        'AUTH_PENDING_EMAIL_EXISTS',
        '이미 가입 진행 중인 이메일입니다.',
        { field_errors: { email: '이미 가입 진행 중인 이메일입니다.' } }
      );
    }
    console.error(error);
    return sendAuthError(res, 500, 'AUTH_SIGNUP_INTERNAL_ERROR', '서버 오류가 발생했습니다.');
  }
});

// 6-2) 이메일 OTP 인증 처리
router.post('/verify-email', async (req, res) => {
  const { pending_id: pendingId, verification_code: verificationCode } = req.body || {};

  if (!pendingId || !verificationCode) {
    return sendAuthError(
      res,
      400,
      'AUTH_VERIFY_REQUIRED_FIELDS',
      '인증에 필요한 정보가 누락되었습니다.'
    );
  }

  try {
    await cleanupExpiredPending();

    const pending = await dbGet(
      `
      SELECT
        id,
        name,
        nickname,
        email,
        pw_hash,
        age_confirmed,
        terms_version,
        privacy_version,
        marketing_version,
        marketing_email_opt_in,
        consent_ip_hash,
        consent_user_agent,
        consent_recorded_at
      FROM pending_signups
      WHERE id = ?
      `,
      [pendingId]
    );

    if (!pending) {
      return sendAuthError(
        res,
        404,
        'AUTH_VERIFY_PENDING_NOT_FOUND',
        '가입 정보를 찾을 수 없습니다. 회원가입을 다시 진행해 주세요.'
      );
    }

    if (
      Number(pending.age_confirmed) !== 1 ||
      !normalizeVersion(pending.terms_version) ||
      !normalizeVersion(pending.privacy_version)
    ) {
      await dbRun('DELETE FROM pending_signups WHERE id = ?', [pendingId]);
      return sendAuthError(
        res,
        400,
        'AUTH_VERIFY_PENDING_CONSENT_REQUIRED',
        '약관 동의 정보가 만료되었습니다. 회원가입을 다시 진행해 주세요.'
      );
    }

    const otpRow = await dbGet(
      `
      SELECT id, code_hash, expires_at, attempts
      FROM pending_otp_verifications
      WHERE pending_id = ?
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [pendingId]
    );

    if (!otpRow) {
      return sendAuthError(
        res,
        400,
        'AUTH_VERIFY_CODE_NOT_FOUND',
        '인증 번호가 존재하지 않습니다. 회원가입을 다시 진행해 주세요.'
      );
    }

    const now = Date.now();
    const expiresTime = toMs(otpRow.expires_at);

    if (!expiresTime || expiresTime < now) {
      return sendAuthError(
        res,
        400,
        'AUTH_VERIFY_CODE_EXPIRED',
        '인증 번호가 만료되었습니다. 회원가입을 다시 진행해 주세요.'
      );
    }

    if (Number(otpRow.attempts) >= MAX_OTP_ATTEMPTS) {
      await dbRun('DELETE FROM pending_signups WHERE id = ?', [pendingId]);
      return sendAuthError(
        res,
        400,
        'AUTH_VERIFY_ATTEMPTS_EXCEEDED',
        '인증 시도 횟수를 초과했습니다. 회원가입을 다시 진행해 주세요.'
      );
    }

    const matches = await bcrypt.compare(String(verificationCode), otpRow.code_hash);

    if (!matches) {
      const nextAttempts = Number(otpRow.attempts) + 1;
      await dbRun(
        `
        UPDATE pending_otp_verifications
        SET attempts = ?
        WHERE id = ?
        `,
        [nextAttempts, otpRow.id]
      );

      if (nextAttempts >= MAX_OTP_ATTEMPTS) {
        await dbRun('DELETE FROM pending_signups WHERE id = ?', [pendingId]);
        return sendAuthError(
          res,
          400,
          'AUTH_VERIFY_ATTEMPTS_EXCEEDED',
          '인증 시도 횟수를 초과했습니다. 회원가입을 다시 진행해 주세요.'
        );
      }

      return sendAuthError(res, 400, 'AUTH_VERIFY_CODE_MISMATCH', '인증 번호가 올바르지 않습니다.');
    }

    const userId = await commitPendingSignup(pending);

    try {
      await backfillUserAchievementStates(userId);
    } catch (backfillError) {
      console.error('신규 유저 업적 backfill 실패:', backfillError);
    }

    logUxEvent({
      user_id: userId,
      event_name: 'verify_email_success',
      source: 'server_auth',
      properties: { pending_id: Number(pendingId) || null },
    }).catch((eventErr) => {
      console.error('verify-email ux event 기록 실패:', eventErr);
    });

    return res.json({
      ok: true,
      message: '이메일 인증이 완료되었습니다.',
      user_id: userId,
      redirect_url: `${getBaseUrl(req)}/html/login.html`,
    });
  } catch (error) {
    if (error && error.code === 'SQLITE_CONSTRAINT') {
      return sendAuthError(
        res,
        409,
        'AUTH_VERIFY_EMAIL_ALREADY_REGISTERED',
        '이미 가입된 이메일입니다. 로그인 페이지로 이동해 주세요.'
      );
    }
    console.error('OTP 처리 오류:', error);
    return sendAuthError(res, 500, 'AUTH_VERIFY_INTERNAL_ERROR', '서버 오류가 발생했습니다.');
  }
});

// 6-2-1) 이메일 OTP 재발송
router.post('/verify-email/resend', otpResendLimiter, async (req, res) => {
  const { pending_id: pendingId, email } = req.body || {};

  if (!pendingId && !email) {
    return sendAuthError(
      res,
      400,
      'AUTH_VERIFY_RESEND_REQUIRED_FIELDS',
      '재발송에 필요한 정보가 누락되었습니다.'
    );
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    await cleanupExpiredPending();

    const pending = normalizedEmail
      ? await dbGet(
          'SELECT id, name, nickname, email FROM pending_signups WHERE email = ?',
          [normalizedEmail]
        )
      : await dbGet(
          'SELECT id, name, nickname, email FROM pending_signups WHERE id = ?',
          [pendingId]
        );

    if (!pending) {
      return sendAuthError(res, 404, 'AUTH_VERIFY_PENDING_NOT_FOUND', '가입 진행 정보를 찾을 수 없습니다.');
    }

    const otpRow = await dbGet(
      `
      SELECT id, created_at
      FROM pending_otp_verifications
      WHERE pending_id = ?
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [pending.id]
    );

    const retryAfter = calculateRetryAfterSeconds(otpRow?.created_at);
    if (retryAfter > 0) {
      return sendAuthError(
        res,
        429,
        'AUTH_VERIFY_RESEND_COOLDOWN',
        `재발송은 ${retryAfter}초 후에 가능합니다.`,
        { retry_after: retryAfter }
      );
    }

    const otpCode = String(crypto.randomInt(100000, 1000000));
    const otpHash = await bcrypt.hash(otpCode, 10);
    const expiresAt = toIso(Date.now() + 1000 * 60 * OTP_TTL_MINUTES);

    await dbRun(
      `
      DELETE FROM pending_otp_verifications
      WHERE pending_id = ?
      `,
      [pending.id]
    );

    const otpInsertResult = await dbRun(
      `
      INSERT INTO pending_otp_verifications (pending_id, code_hash, expires_at, attempts)
      VALUES (?, ?, ?, 0)
      `,
      [pending.id, otpHash, expiresAt]
    );

    try {
      if (!SIGNUP_EMAIL_DRY_RUN) {
        await sendSignupOtpEmail({
          to: pending.email,
          name: pending.nickname || pending.name,
          otpCode,
          resend: true,
        });
      }
    } catch (mailErr) {
      console.error('인증 메일 재발송 오류:', getMailErrorDetails(mailErr));
      try {
        await dbRun('DELETE FROM pending_otp_verifications WHERE id = ?', [otpInsertResult.lastID]);
      } catch (cleanupErr) {
        console.error('OTP 재발송 실패 후 정리 오류:', cleanupErr);
      }
      return sendAuthError(
        res,
        EMAIL_SEND_FAILURE_STATUS,
        'AUTH_VERIFY_RESEND_EMAIL_SEND_FAILED',
        '인증 메일 재발송에 실패했습니다. 잠시 후 다시 시도해주세요.'
      );
    }

    res.json({
      ok: true,
      message: '인증 번호를 다시 발송했습니다.',
      retry_after: Math.ceil(OTP_COOLDOWN_MS / 1000),
    });
  } catch (error) {
    console.error('OTP 재발송 오류:', error);
    return sendAuthError(res, 500, 'AUTH_VERIFY_RESEND_INTERNAL_ERROR', 'OTP 재발송 중 오류가 발생했습니다.');
  }
});

// 6-3) 비밀번호 재설정 메일 요청
router.post('/password-reset-request', passwordLimiter, async (req, res) => {
  const { email } = req.body || {};
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return sendAuthError(res, 400, 'AUTH_RESET_EMAIL_REQUIRED', '이메일을 입력해주세요.', {
      field_errors: { email: '이메일을 입력해주세요.' },
    });
  }

  const responseMessage =
    '입력하신 이메일이 등록되어 있다면, 비밀번호 재설정 메일이 발송됩니다.';

  try {
    const user = await dbGet(
      'SELECT id, name FROM users WHERE email = ? AND is_verified = 1',
      [normalizedEmail]
    );

    if (!user) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[password-reset-request] user not found or unverified');
      }
      return res.json({ ok: true, message: responseMessage });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashPasswordResetToken(token);
    const nowIso = toIso(Date.now());
    const expiresAtIso = toIso(Date.now() + RESET_TOKEN_TTL_MS);

    await dbRun(
      `
      UPDATE password_reset_tokens
      SET revoked_at = ?
      WHERE user_id = ?
        AND used_at IS NULL
        AND revoked_at IS NULL
        AND expires_at > ?
      `,
      [nowIso, user.id, nowIso]
    );

    const insertResult = await dbRun(
      `
      INSERT INTO password_reset_tokens (
        user_id,
        token_hash,
        expires_at
      )
      VALUES (?, ?, ?)
      `,
      [user.id, tokenHash, expiresAtIso]
    );

    const resetUrl = `${getBaseUrl(req)}/html/reset-password.html?token=${token}`;
    const mobileResetUrl = `${process.env.MOBILE_APP_SCHEME || 'glsoopmobile'}://reset-password?token=${encodeURIComponent(token)}`;

    try {
      const info = await sendPasswordResetEmail({
        to: normalizedEmail,
        name: user.name,
        resetUrl,
        mobileResetUrl,
      });
      if (info?.messageId) {
        console.log('reset mail sent:', info.messageId);
      }
      return res.json({ ok: true, message: responseMessage });
    } catch (mailErr) {
      console.error('비밀번호 재설정 메일 전송 오류:', mailErr);
      await dbRun(
        `
        UPDATE password_reset_tokens
        SET revoked_at = ?
        WHERE id = ?
        `,
        [toIso(Date.now()), insertResult.lastID]
      );
      return res.json({ ok: true, message: responseMessage });
    }
  } catch (error) {
    console.error('[password-reset-request] error:', error);
    return sendAuthError(res, 500, 'AUTH_RESET_REQUEST_INTERNAL_ERROR', '서버 오류가 발생했습니다.');
  }
});

router.post('/password-reset/validate', passwordLimiter, async (req, res) => {
  const { token } = req.body || {};
  const trimmedToken = typeof token === 'string' ? token.trim() : '';

  if (!trimmedToken) {
    return sendAuthError(res, 400, 'AUTH_RESET_TOKEN_REQUIRED', '유효한 토큰이 필요합니다.');
  }

  try {
    const tokenRow = await findPasswordResetTokenRow(trimmedToken);
    const state = classifyPasswordResetToken(tokenRow);

    if (state === 'invalid') {
      return sendAuthError(res, 400, 'AUTH_RESET_TOKEN_INVALID', '유효하지 않은 링크입니다.');
    }
    if (state === 'used') {
      return sendAuthError(
        res,
        400,
        'AUTH_RESET_TOKEN_USED',
        '이미 사용된 링크입니다. 다시 요청해주세요.'
      );
    }
    if (state === 'expired') {
      return sendAuthError(
        res,
        400,
        'AUTH_RESET_TOKEN_EXPIRED',
        '비밀번호 재설정 링크가 만료되었습니다. 다시 요청해주세요.'
      );
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error('[password-reset/validate] error:', error);
    return sendAuthError(res, 500, 'AUTH_RESET_VALIDATE_INTERNAL_ERROR', '서버 오류가 발생했습니다.');
  }
});

// 6-4) 비밀번호 실제 변경 처리
router.post('/password-reset', passwordLimiter, async (req, res) => {
  const { token, newPw } = req.body || {};
  const trimmedToken = typeof token === 'string' ? token.trim() : '';

  if (!trimmedToken || !newPw) {
    return sendAuthError(
      res,
      400,
      'AUTH_RESET_REQUIRED_FIELDS',
      '토큰과 새 비밀번호를 모두 입력해주세요.',
      {
        field_errors: {
          ...(trimmedToken ? {} : { token: '재설정 토큰이 필요합니다.' }),
          ...(newPw ? {} : { newPw: '새 비밀번호를 입력해주세요.' }),
        },
      }
    );
  }

  const passwordValidation = isStrongPassword(newPw);
  if (!passwordValidation.ok) {
    return sendAuthError(
      res,
      400,
      passwordValidation.code,
      passwordValidation.message,
      { field_errors: passwordValidation.fieldErrors }
    );
  }

  try {
    const tokenRow = await findPasswordResetTokenRow(trimmedToken);
    const state = classifyPasswordResetToken(tokenRow);

    if (state === 'invalid') {
      return sendAuthError(res, 400, 'AUTH_RESET_TOKEN_INVALID', '유효하지 않은 링크입니다.');
    }
    if (state === 'used') {
      return sendAuthError(
        res,
        400,
        'AUTH_RESET_TOKEN_USED',
        '이미 사용된 링크입니다. 다시 요청해주세요.'
      );
    }
    if (state === 'expired') {
      return sendAuthError(
        res,
        400,
        'AUTH_RESET_TOKEN_EXPIRED',
        '비밀번호 재설정 링크가 만료되었습니다. 다시 요청해주세요.'
      );
    }

    const nowIso = toIso(Date.now());
    const hashedPw = await bcrypt.hash(passwordValidation.normalized, 10);

    try {
      await dbRun('BEGIN IMMEDIATE');
      const consumeResult = await dbRun(
        `
        UPDATE password_reset_tokens
        SET used_at = ?
        WHERE id = ?
          AND used_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > ?
        `,
        [nowIso, tokenRow.id, nowIso]
      );

      if (!consumeResult?.changes) {
        await dbRun('ROLLBACK');
        return sendAuthError(
          res,
          400,
          'AUTH_RESET_TOKEN_USED',
          '이미 사용된 링크입니다. 다시 요청해주세요.'
        );
      }

      await dbRun(
        `
        UPDATE users
        SET pw = ?, reset_token = NULL, reset_expires = NULL
        WHERE id = ?
        `,
        [hashedPw, tokenRow.user_id]
      );

      await dbRun(
        `
        UPDATE password_reset_tokens
        SET revoked_at = ?
        WHERE user_id = ?
          AND id != ?
          AND used_at IS NULL
          AND revoked_at IS NULL
        `,
        [nowIso, tokenRow.user_id, tokenRow.id]
      );

      await dbRun('COMMIT');
    } catch (txError) {
      try {
        await dbRun('ROLLBACK');
      } catch (rollbackError) {
        console.error('[password-reset] rollback failed:', rollbackError);
      }
      throw txError;
    }

    try {
      await revokeAllAuthSessionsForUser(tokenRow.user_id, 'password_reset');
    } catch (revokeErr) {
      console.error('[password-reset] revoke sessions failed:', revokeErr);
    }

    return res.json({
      ok: true,
      message: '비밀번호가 변경되었습니다. 다시 로그인해주세요.',
    });
  } catch (error) {
    console.error('[password-reset] error:', error);
    return sendAuthError(res, 500, 'AUTH_RESET_INTERNAL_ERROR', '서버 오류가 발생했습니다.');
  }
});

// 6-5) 로그인
router.post('/login', loginLimiter, async (req, res) => {
  const { email, pw } = req.body || {};
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !pw) {
    return sendAuthError(
      res,
      400,
      'AUTH_LOGIN_REQUIRED_FIELDS',
      '이메일과 비밀번호를 입력하세요.',
      {
        field_errors: {
          ...(normalizedEmail ? {} : { email: '이메일을 입력해주세요.' }),
          ...(pw ? {} : { pw: '비밀번호를 입력해주세요.' }),
        },
      }
    );
  }

  try {
    const user = await dbGet('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
    const rememberMe = Boolean(user && Number(user.remember_login_enabled) === 1);

    if (user) {
      const loginState = await getLoginState(user.id);
      const retryAfter = calculateLockRetrySeconds(loginState?.locked_until);
      if (retryAfter > 0) {
        await logLoginEvent({
          userId: user.id,
          email: normalizedEmail,
          req,
          outcome: 'locked',
          failureCode: 'AUTH_ACCOUNT_LOCKED',
          rememberMe,
        });
        return sendAuthError(
          res,
          423,
          'AUTH_ACCOUNT_LOCKED',
          '요청이 많습니다. 잠시 후 다시 시도해주세요.',
          { retry_after: retryAfter }
        );
      }
    }

    const invalidCredentials = async (withLockStateUser) => {
      if (withLockStateUser?.id) {
        const result = await registerLoginFailure(withLockStateUser.id);
        if (result.locked) {
          await logLoginEvent({
            userId: withLockStateUser.id,
            email: normalizedEmail,
            req,
            outcome: 'locked',
            failureCode: 'AUTH_ACCOUNT_LOCKED',
            rememberMe,
          });
          return sendAuthError(
            res,
            423,
            'AUTH_ACCOUNT_LOCKED',
            '요청이 많습니다. 잠시 후 다시 시도해주세요.',
            { retry_after: result.retry_after }
          );
        }
      }

      await logLoginEvent({
        userId: withLockStateUser?.id || null,
        email: normalizedEmail,
        req,
        outcome: 'failure',
        failureCode: 'AUTH_INVALID_CREDENTIALS',
        rememberMe,
      });

      return sendAuthError(
        res,
        401,
        'AUTH_INVALID_CREDENTIALS',
        '이메일 또는 비밀번호가 올바르지 않습니다.',
        { field_errors: { email: '이메일 또는 비밀번호를 확인해주세요.' } }
      );
    };

    if (!user) {
      return invalidCredentials(null);
    }

    const match = await bcrypt.compare(String(pw), user.pw);
    if (!match) {
      return invalidCredentials(user);
    }

    if (isDeactivatedAccount(user.account_status)) {
      if (isWithinDeactivationGracePeriod(user)) {
        return res.json({
          ok: true,
          reactivation_required: true,
          message: '비활성화된 계정입니다. 다시 활성화할지 한 번 더 확인해주세요.',
          name: user.name,
          nickname: user.nickname || null,
          remember_me: rememberMe,
          scheduled_purge_at: user.scheduled_purge_at || null,
        });
      }

      await purgeUserAccount(user.id, { deletePosts: true });
      return invalidCredentials(null);
    }

    return issueLoginSuccess(res, req, user, normalizedEmail, rememberMe);
  } catch (error) {
    console.error('[login] error:', error);
    return sendAuthError(res, 500, 'AUTH_LOGIN_INTERNAL_ERROR', '로그인 처리 중 오류가 발생했습니다.');
  }
});

router.post('/login/reactivate', loginLimiter, async (req, res) => {
  const { email, pw } = req.body || {};
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !pw) {
    return sendAuthError(
      res,
      400,
      'AUTH_LOGIN_REQUIRED_FIELDS',
      '이메일과 비밀번호를 입력하세요.',
      {
        field_errors: {
          ...(normalizedEmail ? {} : { email: '이메일을 입력해주세요.' }),
          ...(pw ? {} : { pw: '비밀번호를 입력해주세요.' }),
        },
      }
    );
  }

  try {
    const user = await dbGet('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
    const rememberMe = Boolean(user && Number(user.remember_login_enabled) === 1);

    if (!user) {
      return sendAuthError(
        res,
        401,
        'AUTH_INVALID_CREDENTIALS',
        '이메일 또는 비밀번호가 올바르지 않습니다.',
        { field_errors: { email: '이메일 또는 비밀번호를 확인해주세요.' } }
      );
    }

    const match = await bcrypt.compare(String(pw), user.pw);
    if (!match) {
      return sendAuthError(
        res,
        401,
        'AUTH_INVALID_CREDENTIALS',
        '이메일 또는 비밀번호가 올바르지 않습니다.',
        { field_errors: { email: '이메일 또는 비밀번호를 확인해주세요.' } }
      );
    }

    if (!isDeactivatedAccount(user.account_status)) {
      return sendAuthError(
        res,
        409,
        'AUTH_REACTIVATION_NOT_REQUIRED',
        '이미 활성 상태인 계정입니다. 바로 로그인해주세요.'
      );
    }

    if (!isWithinDeactivationGracePeriod(user)) {
      await purgeUserAccount(user.id, { deletePosts: true });
      return sendAuthError(
        res,
        401,
        'AUTH_INVALID_CREDENTIALS',
        '이메일 또는 비밀번호가 올바르지 않습니다.',
        { field_errors: { email: '이메일 또는 비밀번호를 확인해주세요.' } }
      );
    }

    await restoreDeactivatedUserAccount(user.id);
    user.account_status = ACCOUNT_STATUS_ACTIVE;
    user.deactivated_at = null;
    user.scheduled_purge_at = null;

    return issueLoginSuccess(res, req, user, normalizedEmail, rememberMe);
  } catch (error) {
    console.error('[login/reactivate] error:', error);
    return sendAuthError(res, 500, 'AUTH_REACTIVATION_INTERNAL_ERROR', '계정 재활성화 중 오류가 발생했습니다.');
  }
});

// 6-6) 로그아웃
router.post('/logout', async (req, res) => {
  try {
    const token = extractToken(req);
    const decoded = await verifyJwtOrNull(token);
    if (decoded?.sid) {
      await revokeAuthSession(decoded.sid, 'logout');
    }
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[logout] failed to revoke current session:', error);
    }
  }

  clearAuthCookie(res);
  return res.json({ ok: true, message: '로그아웃되었습니다.' });
});

router.post('/logout-all', authRequired, async (req, res) => {
  try {
    await revokeAllAuthSessionsForUser(req.user.id, 'logout_all');
  } catch (error) {
    console.error('[logout-all] failed to revoke sessions:', error);
    return sendAuthError(res, 500, 'AUTH_LOGOUT_ALL_FAILED', '전체 로그아웃 처리 중 오류가 발생했습니다.');
  }

  clearAuthCookie(res);

  return res.json({ ok: true, message: '모든 기기에서 로그아웃되었습니다.' });
});

router.get('/me/sessions', authRequired, async (req, res) => {
  try {
    const currentSid = typeof req.user?.sid === 'string' ? req.user.sid : null;
    const sessions = await listActiveSessionsForUser(req.user.id, currentSid);
    return res.json({ ok: true, sessions });
  } catch (error) {
    console.error('[me/sessions] error:', error);
    return sendAuthError(res, 500, 'AUTH_SESSIONS_FETCH_FAILED', '세션 정보를 불러오지 못했습니다.');
  }
});

// 7-1) 내 정보 조회
router.get('/me', authRequired, (req, res) => {
  const userId = req.user.id;

  db.get(
    `
    SELECT
      id,
      name,
      nickname,
      bio,
      about,
      profile_photo_url,
      profile_photo_thumbnail_url,
      profile_photo_updated_at,
      email,
      COALESCE(account_status, 'active') AS account_status,
      is_admin,
      is_verified,
      COALESCE(remember_login_enabled, 0) AS remember_login_enabled,
      COALESCE(marketing_email_opt_in, 0) AS marketing_email_opt_in,
      COALESCE(marketing_push_opt_in, 0) AS marketing_push_opt_in,
      COALESCE(level, 1) AS level,
      COALESCE(xp, 0) AS xp,
      COALESCE(streak_days, 0) AS streak_days,
      COALESCE(max_streak_days, 0) AS max_streak_days,
      (SELECT COUNT(*) FROM follows f1 WHERE f1.followee_id = users.id) AS follower_count,
      (SELECT COUNT(*) FROM follows f2 WHERE f2.follower_id = users.id) AS following_count,
      EXISTS (
        SELECT 1
        FROM user_entitlements ue
        WHERE ue.user_id = users.id
          AND ue.entitlement_key = ?
          AND ue.source = 'iap'
          AND ue.status = 'active'
          AND (ue.starts_at IS NULL OR datetime(ue.starts_at) <= datetime('now'))
          AND (ue.ends_at IS NULL OR datetime(ue.ends_at) > datetime('now'))
        LIMIT 1
      ) OR EXISTS (
        SELECT 1
        FROM user_entitlement_grants ueg
        WHERE ueg.user_id = users.id
          AND ueg.entitlement_key = ?
          AND ueg.status = 'active'
          AND (ueg.starts_at IS NULL OR datetime(ueg.starts_at) <= datetime('now'))
          AND (ueg.ends_at IS NULL OR datetime(ueg.ends_at) > datetime('now'))
        LIMIT 1
      ) AS profile_photo_upload_allowed
    FROM users
    WHERE id = ?
    `,
    [
      PROFILE_PHOTO_PREMIUM_ENTITLEMENT_KEY,
      PROFILE_PHOTO_PREMIUM_ENTITLEMENT_KEY,
      userId,
    ],
    (err, row) => {
      if (err) {
        console.error(err);
        return sendAuthError(res, 500, 'AUTH_ME_FETCH_FAILED', 'DB 오류가 발생했습니다.');
      }

      if (!row) {
        return sendAuthError(res, 404, 'AUTH_USER_NOT_FOUND', '사용자를 찾을 수 없습니다.');
      }

      return res.json({
        ok: true,
        message: '내 정보를 불러왔습니다.',
        id: row.id,
        name: row.name,
        nickname: row.nickname,
        bio: row.bio || null,
        about: row.about || null,
        profile_photo_url: row.profile_photo_url || null,
        profile_photo_thumbnail_url: row.profile_photo_thumbnail_url || null,
        profile_photo_updated_at: row.profile_photo_updated_at || null,
        profile_photo_upload_allowed: Number(row.profile_photo_upload_allowed || 0) === 1,
        profile_photo_entitlement_key: PROFILE_PHOTO_PREMIUM_ENTITLEMENT_KEY,
        email: row.email,
        account_status: row.account_status || ACCOUNT_STATUS_ACTIVE,
        is_admin: !!row.is_admin,
        is_verified: !!row.is_verified,
        remember_login_enabled: Number(row.remember_login_enabled) === 1,
        marketing_email_opt_in: Number(row.marketing_email_opt_in) === 1,
        marketing_push_opt_in: Number(row.marketing_push_opt_in) === 1,
        level: row.level || 1,
        xp: row.xp || 0,
        streak_days: row.streak_days || 0,
        max_streak_days: row.max_streak_days || 0,
        follower_count: row.follower_count || 0,
        following_count: row.following_count || 0,
      });
    }
  );
});

router.post('/me/account-closure', authRequired, async (req, res) => {
  const userId = req.user.id;
  const mode = typeof req.body?.mode === 'string' ? req.body.mode.trim().toLowerCase() : '';
  const currentPw = typeof req.body?.currentPw === 'string' ? req.body.currentPw : '';
  const confirmText = typeof req.body?.confirmText === 'string' ? req.body.confirmText.trim() : '';

  if (!ACCOUNT_CLOSURE_MODES.has(mode)) {
    return sendAuthError(
      res,
      400,
      'AUTH_ACCOUNT_CLOSURE_INVALID_MODE',
      '계정 정리 방식이 올바르지 않습니다.'
    );
  }

  if (!currentPw) {
    return sendAuthError(
      res,
      400,
      'AUTH_ACCOUNT_CLOSURE_PASSWORD_REQUIRED',
      '현재 비밀번호를 입력해주세요.'
    );
  }

  if (confirmText.toUpperCase() !== ACCOUNT_CLOSURE_CONFIRM_TEXT) {
    return sendAuthError(
      res,
      400,
      'AUTH_ACCOUNT_CLOSURE_CONFIRM_MISMATCH',
      `${ACCOUNT_CLOSURE_CONFIRM_TEXT} 확인 문구를 정확히 입력해주세요.`
    );
  }

  try {
    const user = await dbGet(
      `
      SELECT id, pw
      FROM users
      WHERE id = ?
      LIMIT 1
      `,
      [userId]
    );
    if (!user) {
      return sendAuthError(res, 404, 'AUTH_USER_NOT_FOUND', '사용자를 찾을 수 없습니다.');
    }

    const passwordMatched = await bcrypt.compare(String(currentPw), user.pw);
    if (!passwordMatched) {
      return sendAuthError(
        res,
        401,
        'AUTH_ACCOUNT_CLOSURE_PASSWORD_MISMATCH',
        '현재 비밀번호가 올바르지 않습니다.'
      );
    }

    if (mode === 'deactivate') {
      const result = await deactivateUserAccount(userId);
      await revokeAllAuthSessionsForUser(userId, 'account_deactivated');
      clearAuthCookie(res);
      return res.json({
        ok: true,
        mode,
        scheduled_purge_at: result.scheduledPurgeAt,
        message: '계정이 비활성화되었습니다. 30일 안에 다시 로그인하면 복구됩니다.',
      });
    }

    await purgeUserAccount(userId, { deletePosts: true });
    clearAuthCookie(res);
    return res.json({
      ok: true,
      mode,
      message: '회원 탈퇴가 완료되었습니다.',
    });
  } catch (error) {
    console.error('[me/account-closure] error:', error);
    return sendAuthError(
      res,
      500,
      'AUTH_ACCOUNT_CLOSURE_FAILED',
      '계정 정리 처리 중 오류가 발생했습니다.'
    );
  }
});

// 7-1-1) 내가 팔로잉 중인 사용자 목록 조회
router.get('/me/followings', authRequired, (req, res) => {
  const userId = req.user.id;
  const conditions = [
    'f.follower_id = ?',
    "COALESCE(u.account_status, 'active') = 'active'",
  ];
  const params = [userId];
  appendViewerBlockedAuthorCondition(conditions, params, userId, 'u.id');

  db.all(
    `
    SELECT
      u.id,
      u.nickname,
      u.bio,
      u.about,
      u.profile_photo_url,
      u.profile_photo_thumbnail_url,
      u.profile_photo_updated_at,
      COALESCE(u.account_status, 'active') AS account_status,
      (SELECT COUNT(*) FROM follows f2 WHERE f2.followee_id = u.id) AS follower_count
    FROM follows f
    INNER JOIN users u ON u.id = f.followee_id
    WHERE ${conditions.join('\n      AND ')}
    ORDER BY (u.nickname IS NULL OR u.nickname = ''), u.nickname, u.name
    `,
    params,
    (err, rows) => {
      if (err) {
        console.error(err);
        return sendAuthError(
          res,
          500,
          'AUTH_FOLLOWINGS_FETCH_FAILED',
          '팔로잉 목록을 불러오는 중 오류가 발생했습니다.'
        );
      }

      const followings = (rows || []).map((row) => {
        const nickname =
          typeof row?.nickname === 'string' && row.nickname.trim()
            ? row.nickname.trim()
            : null;
        const displayName = buildPublicDisplayName(nickname, row?.account_status);

        return {
          id: row.id,
          display_name: displayName,
          name: displayName,
          nickname,
          bio: row.bio || null,
          about: row.about || null,
          profile_photo_url: row.profile_photo_url || null,
          profile_photo_thumbnail_url: row.profile_photo_thumbnail_url || null,
          profile_photo_updated_at: row.profile_photo_updated_at || null,
          email: null,
          follower_count: row.follower_count || 0,
        };
      });

      return res.json({
        ok: true,
        message: '팔로잉 목록을 불러왔습니다.',
        followings,
      });
    }
  );
});

// 7-1-2) 나를 팔로우 중인 사용자 목록 조회
router.get('/me/followers', authRequired, (req, res) => {
  const userId = req.user.id;
  const conditions = [
    'f.followee_id = ?',
    "COALESCE(u.account_status, 'active') = 'active'",
  ];
  const params = [userId];
  appendViewerBlockedAuthorCondition(conditions, params, userId, 'u.id');

  db.all(
    `
    SELECT
      u.id,
      u.nickname,
      u.bio,
      u.about,
      COALESCE(u.account_status, 'active') AS account_status,
      f.created_at AS followed_at,
      (SELECT COUNT(*) FROM follows f2 WHERE f2.followee_id = u.id) AS follower_count,
      EXISTS (
        SELECT 1
        FROM follows f3
        WHERE f3.follower_id = ?
          AND f3.followee_id = u.id
      ) AS is_following
    FROM follows f
    INNER JOIN users u ON u.id = f.follower_id
    WHERE ${conditions.join('\n      AND ')}
    ORDER BY datetime(f.created_at) DESC, u.id DESC
    `,
    [userId, ...params],
    (err, rows) => {
      if (err) {
        console.error(err);
        return sendAuthError(
          res,
          500,
          'AUTH_FOLLOWERS_FETCH_FAILED',
          '팔로워 목록을 불러오는 중 오류가 발생했습니다.'
        );
      }

      const followers = (rows || []).map((row) => {
        const nickname =
          typeof row?.nickname === 'string' && row.nickname.trim()
            ? row.nickname.trim()
            : null;
        const displayName = buildPublicDisplayName(nickname, row?.account_status);

        return {
          id: row.id,
          display_name: displayName,
          name: displayName,
          nickname,
          bio: row.bio || null,
          about: row.about || null,
          email: null,
          follower_count: row.follower_count || 0,
          is_following: Number(row.is_following || 0) === 1,
          followed_at: row.followed_at || null,
        };
      });

      return res.json({
        ok: true,
        message: '팔로워 목록을 불러왔습니다.',
        followers,
      });
    }
  );
});

// 7-2) 내 정보 수정
router.put('/me', authRequired, async (req, res) => {
  const userId = req.user.id;
  const {
    nickname,
    currentPw,
    newPw,
    bio,
    about,
    remember_login_enabled,
    marketing_email_opt_in,
    marketing_version,
  } = req.body || {};

  const fields = [];
  const params = [];
  const legalVersions = getLegalVersions();
  const requestedMarketingVersion =
    normalizeVersion(marketing_version) || legalVersions.marketing;
  const wantsPwChange = !!newPw;
  const hasMarketingInput = marketing_email_opt_in !== undefined;
  let marketingChanged = false;
  let nextMarketingOptIn = false;
  let userRow = null;

  if (nickname !== undefined && nickname !== null) {
    fields.push('nickname = ?');
    params.push(nickname);
  }

  if (bio !== undefined) {
    fields.push('bio = ?');
    params.push(bio);
  }

  if (about !== undefined) {
    fields.push('about = ?');
    params.push(about);
  }

  if (remember_login_enabled !== undefined) {
    if (!isBooleanLike(remember_login_enabled)) {
      return sendAuthError(
        res,
        400,
        'AUTH_PROFILE_INVALID_REMEMBER_POLICY',
        'remember_login_enabled 값이 올바르지 않습니다.'
      );
    }
    fields.push('remember_login_enabled = ?');
    params.push(normalizeBoolean(remember_login_enabled) ? 1 : 0);
  }

  if (hasMarketingInput && !isBooleanLike(marketing_email_opt_in)) {
    return sendAuthError(
      res,
      400,
      'AUTH_PROFILE_INVALID_MARKETING_POLICY',
      'marketing_email_opt_in 값이 올바르지 않습니다.'
    );
  }

  if (
    normalizeVersion(marketing_version) &&
    requestedMarketingVersion !== legalVersions.marketing
  ) {
    return sendAuthError(
      res,
      409,
      'AUTH_SIGNUP_LEGAL_VERSION_MISMATCH',
      '약관 버전이 변경되었습니다. 페이지를 새로고침 후 다시 시도해주세요.',
      {
        field_errors: {
          marketing_version:
            '마케팅 동의 문서 버전이 변경되었습니다. 페이지를 새로고침 해주세요.',
        },
      }
    );
  }

  try {
    if (wantsPwChange || hasMarketingInput) {
      userRow = await dbGet(
        `
        SELECT
          pw,
          COALESCE(marketing_email_opt_in, 0) AS marketing_email_opt_in
        FROM users
        WHERE id = ?
        `,
        [userId]
      );

      if (!userRow) {
        return sendAuthError(res, 404, 'AUTH_USER_NOT_FOUND', '사용자를 찾을 수 없습니다.');
      }
    }

    if (hasMarketingInput) {
      const currentMarketingOptIn = Number(userRow.marketing_email_opt_in) === 1;
      nextMarketingOptIn = normalizeBoolean(marketing_email_opt_in);
      marketingChanged = currentMarketingOptIn !== nextMarketingOptIn;

      if (marketingChanged) {
        fields.push('marketing_email_opt_in = ?');
        params.push(nextMarketingOptIn ? 1 : 0);
        fields.push('marketing_opt_in_updated_at = ?');
        params.push(toIso(Date.now()));
      }
    }

    if (wantsPwChange) {
      if (!currentPw) {
        return sendAuthError(
          res,
          400,
          'AUTH_CURRENT_PASSWORD_REQUIRED',
          '비밀번호를 변경하려면 현재 비밀번호를 입력해주세요.',
          { field_errors: { currentPw: '현재 비밀번호를 입력해주세요.' } }
        );
      }

      const passwordValidation = isStrongPassword(newPw);
      if (!passwordValidation.ok) {
        return sendAuthError(
          res,
          400,
          passwordValidation.code,
          passwordValidation.message,
          { field_errors: { newPw: passwordValidation.fieldErrors.pw } }
        );
      }

      const okPw = await bcrypt.compare(currentPw, userRow.pw);
      if (!okPw) {
        return sendAuthError(
          res,
          400,
          'AUTH_CURRENT_PASSWORD_MISMATCH',
          '현재 비밀번호가 일치하지 않습니다.',
          { field_errors: { currentPw: '현재 비밀번호가 올바르지 않습니다.' } }
        );
      }

      const newHashedPw = await bcrypt.hash(passwordValidation.normalized, 10);
      fields.push('pw = ?');
      params.push(newHashedPw);
    }

    if (fields.length === 0) {
      return sendAuthError(res, 400, 'AUTH_PROFILE_NO_CHANGES', '변경할 내용을 입력하세요.');
    }

    params.push(userId);

    if (marketingChanged) {
      await dbRun('BEGIN IMMEDIATE');
      try {
        await dbRun(
          `
          UPDATE users
          SET ${fields.join(', ')}
          WHERE id = ?
          `,
          params
        );

        await insertUserConsentEvent({
          userId,
          consentType: 'marketing',
          consentVersion: requestedMarketingVersion,
          isGranted: nextMarketingOptIn,
          source: 'mypage',
          ipHash: getIpHashFromRequest(req),
          userAgent: getUserAgent(req),
          createdAt: toIso(Date.now()),
        });

        await dbRun('COMMIT');
      } catch (transactionError) {
        try {
          await dbRun('ROLLBACK');
        } catch (rollbackError) {
          console.error('[profile/update] rollback failed:', rollbackError);
        }
        throw transactionError;
      }
    } else {
      await dbRun(
        `
        UPDATE users
        SET ${fields.join(', ')}
        WHERE id = ?
        `,
        params
      );
    }

    return res.json({
      ok: true,
      message: '정보가 성공적으로 수정되었습니다.',
    });
  } catch (error) {
    console.error(error);
    return sendAuthError(res, 500, 'AUTH_PROFILE_UPDATE_FAILED', '내 정보 수정 중 오류가 발생했습니다.');
  }
});

module.exports = router;
