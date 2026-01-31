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
} = require('../config');
const { sendPasswordResetEmail } = require('../services/mailer');
const { authRequired } = require('../middleware/auth');
const { getBaseUrl } = require('../utils/baseUrl');
const { cleanupExpiredPending } = require('../utils/pendingSignup');
const {
  loginLimiter,
  signupLimiter,
  passwordLimiter,
  otpResendLimiter,
} = require('../middleware/rateLimiters');

const router = express.Router();

const OTP_TTL_MINUTES = 10;
const OTP_COOLDOWN_MS = 1000 * 60;
const PENDING_TTL_HOURS = 24;
const MAX_OTP_ATTEMPTS = 5;

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

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

async function commitPendingSignup(pending) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE', (beginErr) => {
        if (beginErr) return reject(beginErr);

        db.run(
          `
          INSERT INTO users (
            name,
            nickname,
            email,
            pw,
            is_admin,
            is_verified,
            verification_token,
            verification_expires
          )
          VALUES (?, ?, ?, ?, 0, 1, NULL, NULL)
          `,
          [pending.name, pending.nickname, pending.email, pending.pw_hash],
          function (insertErr) {
            if (insertErr) {
              return db.run('ROLLBACK', () => reject(insertErr));
            }

            const newUserId = this.lastID;

            db.run(
              'DELETE FROM pending_signups WHERE id = ?',
              [pending.id],
              (deleteErr) => {
                if (deleteErr) {
                  return db.run('ROLLBACK', () => reject(deleteErr));
                }

                db.run('COMMIT', (commitErr) => {
                  if (commitErr) return reject(commitErr);
                  resolve(newUserId);
                });
              }
            );
          }
        );
      });
    });
  });
}

// 6-1) 회원가입 + 이메일 OTP 발송
router.post('/signup', signupLimiter, async (req, res) => {
  const { name, nickname, email, pw } = req.body;

  if (!name || !nickname || !email || !pw) {
    return res.status(400).json({
      ok: false,
      message: '이름, 닉네임, 이메일, 비밀번호를 모두 입력하세요.',
    });
  }

  try {
    await cleanupExpiredPending();

    // 1) 비밀번호 해시 + 이메일 소문자 정규화
    const hashed = await bcrypt.hash(pw, 10);
    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [
      normalizedEmail,
    ]);
    if (existingUser) {
      return res.status(409).json({
        ok: false,
        message: '이미 가입된 이메일입니다.',
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

    // 2) 이메일 OTP 생성 (10분 유효)
    const otpCode = String(crypto.randomInt(100000, 1000000));
    const otpHash = await bcrypt.hash(otpCode, 10);
    const otpExpiresAt = new Date(
      Date.now() + 1000 * 60 * OTP_TTL_MINUTES
    ).toISOString();
    const pendingExpiresAt = new Date(
      Date.now() + 1000 * 60 * 60 * PENDING_TTL_HOURS
    ).toISOString();

    const pendingResult = await dbRun(
      `
      INSERT INTO pending_signups (name, nickname, email, pw_hash, expires_at)
      VALUES (?, ?, ?, ?, ?)
      `,
      [name, nickname, normalizedEmail, hashed, pendingExpiresAt]
    );

    const pendingId = pendingResult.lastID;

    await dbRun(
      `
      INSERT INTO pending_otp_verifications (pending_id, code_hash, expires_at, attempts)
      VALUES (?, ?, ?, 0)
      `,
      [pendingId, otpHash, otpExpiresAt]
    );

    res.json({
      ok: true,
      message: '인증 번호를 이메일로 발송했습니다.',
      pending_id: pendingId,
      email_masked: maskEmail(normalizedEmail),
      otp_ttl: OTP_TTL_MINUTES * 60,
      resend_after: Math.ceil(OTP_COOLDOWN_MS / 1000),
    });

    transporter.sendMail(
      {
        from: `"글숲" <${process.env.GMAIL_USER}>`,
        to: normalizedEmail,
        subject: '[글숲] 이메일 인증 번호를 확인해주세요',
        html: `
          <div style="font-family: 'Noto Sans KR', sans-serif; line-height: 1.6;">
            <p><strong>${nickname || name}님, 안녕하세요.</strong></p>
            <p>글숲에 가입해 주셔서 감사합니다. 아래 인증 번호를 입력해 이메일 인증을 완료해주세요.</p>
            <p style="margin: 16px 0; font-size: 1.5rem; font-weight: 700; letter-spacing: 0.2em;">
              ${otpCode}
            </p>
            <p style="font-size: 0.9rem; color:#888;">
              인증 번호는 ${OTP_TTL_MINUTES}분 동안만 유효합니다.
            </p>
          </div>
        `,
      },
      (mailErr) => {
        if (mailErr) {
          console.error('인증 메일 발송 오류:', mailErr);
        }
      }
    );
  } catch (e) {
    if (e && e.code === 'SQLITE_CONSTRAINT') {
      return res
        .status(409)
        .json({ ok: false, message: '이미 가입 진행 중인 이메일입니다.' });
    }
    console.error(e);
    return res
      .status(500)
      .json({ ok: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 6-2) 이메일 OTP 인증 처리
router.post('/verify-email', async (req, res) => {
  const { pending_id: pendingId, verification_code: verificationCode } =
    req.body || {};

  if (!pendingId || !verificationCode) {
    return res.status(400).json({
      ok: false,
      message: '인증에 필요한 정보가 누락되었습니다.',
    });
  }

  try {
    await cleanupExpiredPending();

    const pending = await dbGet(
      `
      SELECT id, name, nickname, email, pw_hash
      FROM pending_signups
      WHERE id = ?
      `,
      [pendingId]
    );

    if (!pending) {
      return res.status(404).json({
        ok: false,
        message: '가입 정보를 찾을 수 없습니다. 회원가입을 다시 진행해 주세요.',
      });
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
      return res.status(400).json({
        ok: false,
        message: '인증 번호가 존재하지 않습니다. 회원가입을 다시 진행해 주세요.',
      });
    }

    const now = Date.now();
    const expiresTime = new Date(otpRow.expires_at).getTime();

    if (Number.isNaN(expiresTime) || expiresTime < now) {
      return res.status(400).json({
        ok: false,
        message: '인증 번호가 만료되었습니다. 회원가입을 다시 진행해 주세요.',
      });
    }

    if (otpRow.attempts >= MAX_OTP_ATTEMPTS) {
      await dbRun('DELETE FROM pending_signups WHERE id = ?', [pendingId]);
      return res.status(400).json({
        ok: false,
        message: '인증 시도 횟수를 초과했습니다. 회원가입을 다시 진행해 주세요.',
      });
    }

    const matches = await bcrypt.compare(
      String(verificationCode),
      otpRow.code_hash
    );

    if (!matches) {
      const nextAttempts = otpRow.attempts + 1;
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
        return res.status(400).json({
          ok: false,
          message: '인증 시도 횟수를 초과했습니다. 회원가입을 다시 진행해 주세요.',
        });
      }

      return res.status(400).json({
        ok: false,
        message: '인증 번호가 올바르지 않습니다.',
      });
    }

    const userId = await commitPendingSignup(pending);
    try {
      await backfillUserAchievementStates(userId);
    } catch (backfillError) {
      console.error('신규 유저 업적 backfill 실패:', backfillError);
    }

    return res.json({
      ok: true,
      message: '이메일 인증이 완료되었습니다.',
      user_id: userId,
      redirect_url: `${getBaseUrl(req)}/html/login.html`,
    });
  } catch (error) {
    if (error && error.code === 'SQLITE_CONSTRAINT') {
      return res.status(409).json({
        ok: false,
        message: '이미 가입된 이메일입니다. 로그인 페이지로 이동해 주세요.',
      });
    }
    console.error('OTP 처리 오류:', error);
    return res
      .status(500)
      .json({ ok: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 6-2-1) 이메일 OTP 재발송
router.post('/verify-email/resend', otpResendLimiter, async (req, res) => {
  const { pending_id: pendingId, email } = req.body || {};

  if (!pendingId && !email) {
    return res.status(400).json({
      ok: false,
      message: '재발송에 필요한 정보가 누락되었습니다.',
    });
  }

  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;

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
      return res
        .status(404)
        .json({ ok: false, message: '가입 진행 정보를 찾을 수 없습니다.' });
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
      return res.status(429).json({
        ok: false,
        message: `재발송은 ${retryAfter}초 후에 가능합니다.`,
        retry_after: retryAfter,
      });
    }

    const otpCode = String(crypto.randomInt(100000, 1000000));
    const otpHash = await bcrypt.hash(otpCode, 10);
    const expiresAt = new Date(
      Date.now() + 1000 * 60 * OTP_TTL_MINUTES
    ).toISOString();

    await dbRun(
      `
      DELETE FROM pending_otp_verifications
      WHERE pending_id = ?
      `,
      [pending.id]
    );

    await dbRun(
      `
      INSERT INTO pending_otp_verifications (pending_id, code_hash, expires_at, attempts)
      VALUES (?, ?, ?, 0)
      `,
      [pending.id, otpHash, expiresAt]
    );

    res.json({
      ok: true,
      message: '인증 번호를 다시 발송했습니다.',
      retry_after: Math.ceil(OTP_COOLDOWN_MS / 1000),
    });

    transporter.sendMail(
      {
        from: `"글숲" <${process.env.GMAIL_USER}>`,
        to: pending.email,
        subject: '[글숲] 이메일 인증 번호를 다시 확인해주세요',
        html: `
          <div style="font-family: 'Noto Sans KR', sans-serif; line-height: 1.6;">
            <p><strong>${pending.nickname || pending.name}님, 안녕하세요.</strong></p>
            <p>요청하신 인증 번호를 다시 보내드립니다. 아래 번호를 입력해 이메일 인증을 완료해주세요.</p>
            <p style="margin: 16px 0; font-size: 1.5rem; font-weight: 700; letter-spacing: 0.2em;">
              ${otpCode}
            </p>
            <p style="font-size: 0.9rem; color:#888;">
              인증 번호는 ${OTP_TTL_MINUTES}분 동안만 유효합니다.
            </p>
          </div>
        `,
      },
      (mailErr) => {
        if (mailErr) {
          console.error('인증 메일 재발송 오류:', mailErr);
        }
      }
    );
  } catch (error) {
    console.error('OTP 재발송 오류:', error);
    return res.status(500).json({
      ok: false,
      message: 'OTP 재발송 중 오류가 발생했습니다.',
    });
  }
});

// 6-3) 비밀번호 재설정 메일 요청
router.post('/password-reset-request', passwordLimiter, (req, res) => {
  const { email } = req.body || {};

  if (!email) {
    return res
      .status(400)
      .json({ ok: false, message: '이메일을 입력해주세요.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const responseMessage =
    '입력하신 이메일이 등록되어 있다면, 비밀번호 재설정 메일이 발송됩니다.';

  db.get(
    'SELECT id, name FROM users WHERE email = ? AND is_verified = 1',
    [normalizedEmail],
    (err, user) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '서버 오류가 발생했습니다.' });
      }

      if (!user) {
        // 미검증 계정/미존재 계정 모두 동일 응답(메일 전송 없음)
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[password-reset-request] user not found or unverified');
        }
        return res.json({ ok: true, message: responseMessage });
      }

      // 유효 시간 1시간짜리 재설정 토큰 생성
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60);

      db.run(
        `
        UPDATE users
        SET reset_token = ?, reset_expires = ?
        WHERE id = ?
        `,
        [token, expiresAt.toISOString(), user.id],
        function (updateErr) {
          if (updateErr) {
            console.error(updateErr);
            return res
              .status(500)
              .json({ ok: false, message: '서버 오류가 발생했습니다.' });
          }

          const resetUrl = `${getBaseUrl(req)}/html/reset-password.html?token=${token}`;

          // 사용자가 존재할 때만 안내 메일 전송
          sendPasswordResetEmail({
            to: normalizedEmail,
            name: user.name,
            resetUrl,
          })
            .then((info) => {
              if (info?.messageId) {
                console.log('reset mail sent:', info.messageId);
              }
              return res.json({ ok: true, message: responseMessage });
            })
            .catch((mailErr) => {
              console.error('비밀번호 재설정 메일 전송 오류:', mailErr);
              db.run(
                `
                UPDATE users
                SET reset_token = NULL, reset_expires = NULL
                WHERE id = ?
                `,
                [user.id],
                (cleanupErr) => {
                  if (cleanupErr && process.env.NODE_ENV !== 'production') {
                    console.warn(
                      '[password-reset-request] failed to clear reset token:',
                      cleanupErr
                    );
                  }
                }
              );
              return res.json({ ok: true, message: responseMessage });
            });
        }
      );
    }
  );
});

// 6-4) 비밀번호 실제 변경 처리
router.post('/password-reset', passwordLimiter, async (req, res) => {
  const { token, newPw } = req.body || {};

  if (!token || !newPw) {
    return res
      .status(400)
      .json({ ok: false, message: '토큰과 새 비밀번호를 모두 입력해주세요.' });
  }

  if (newPw.length < 8) {
    return res.status(400).json({
      ok: false,
      message: '비밀번호는 8자 이상으로 설정해주세요.',
    });
  }

  // 1) 토큰으로 사용자와 만료 시간 확인
  db.get(
    'SELECT id, reset_expires FROM users WHERE reset_token = ?',
    [token],
    async (err, user) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '서버 오류가 발생했습니다.' });
      }

      if (!user || !user.reset_expires) {
        return res
          .status(400)
          .json({ ok: false, message: '유효하지 않은 링크입니다.' });
      }

      const now = Date.now();
      const expiresTime = new Date(user.reset_expires).getTime();

      if (isNaN(expiresTime) || expiresTime < now) {
        return res.status(400).json({
          ok: false,
          message: '비밀번호 재설정 링크가 만료되었습니다. 다시 요청해주세요.',
        });
      }

      try {
        // 2) 비밀번호 해시 후 토큰 삭제
        const hashedPw = await bcrypt.hash(newPw, 10);

        db.run(
          `
          UPDATE users
          SET pw = ?, reset_token = NULL, reset_expires = NULL
          WHERE id = ?
          `,
          [hashedPw, user.id],
          function (updateErr) {
            if (updateErr) {
              console.error(updateErr);
              return res.status(500).json({
                ok: false,
                message: '비밀번호 변경 중 오류가 발생했습니다.',
              });
            }

            return res.json({
              ok: true,
              message: '비밀번호가 변경되었습니다. 다시 로그인해주세요.',
            });
          }
        );
      } catch (hashErr) {
        console.error(hashErr);
        return res
          .status(500)
          .json({ ok: false, message: '서버 오류가 발생했습니다.' });
      }
    }
  );
});

// 6-5) 로그인
router.post('/login', loginLimiter, (req, res) => {
  const { email, pw } = req.body;

  if (!email || !pw) {
    return res
      .status(400)
      .json({ ok: false, message: '이메일과 비밀번호를 입력하세요.' });
  }

  // 입력된 이메일을 소문자로 정리
  const normalizedEmail = email.trim().toLowerCase();

  db.get(
    'SELECT * FROM users WHERE email = ?',
    [normalizedEmail],
    async (err, user) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: 'DB 오류가 발생했습니다.' });
      }

      const invalidCredentialsResponse = () =>
        res.status(401).json({
          ok: false,
          message: '이메일 또는 비밀번호가 올바르지 않습니다.',
        });

      if (!user) {
        return invalidCredentialsResponse();
      }

      const match = await bcrypt.compare(pw, user.pw);
      if (!match) {
        return invalidCredentialsResponse();
      }

      const token = jwt.sign(
        {
          id: user.id,
          name: user.name,
          nickname: user.nickname,
          email: user.email,
          isAdmin: !!user.is_admin,
          isVerified: !!user.is_verified,
        },
        JWT_SECRET,
        {
          expiresIn: '2h',
          algorithm: JWT_ALGORITHM,
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        }
      );

      const tokenMaxAgeMs = 2 * 60 * 60 * 1000; // 2h, JWT 만료와 동일하게 유지

      res.cookie('token', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: tokenMaxAgeMs,
      });

      return res.json({
        ok: true,
        message: `환영합니다, ${user.name}님!`,
        name: user.name,
        nickname: user.nickname || null,
        // ✅ 모바일(Expo/RN)에서 쿠키보다 안정적인 Bearer 인증을 위해 토큰도 함께 반환
        token,
      });
    }
  );
});

// 6-6) 로그아웃
router.post('/logout', (req, res) => {
  res.clearCookie('token', {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  res.json({ ok: true, message: '로그아웃되었습니다.' });
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
      email,
      is_admin,
      is_verified,
      COALESCE(level, 1) AS level,
      COALESCE(xp, 0) AS xp,
      COALESCE(streak_days, 0) AS streak_days,
      COALESCE(max_streak_days, 0) AS max_streak_days,
      (SELECT COUNT(*) FROM follows f1 WHERE f1.followee_id = users.id)   AS follower_count,
      (SELECT COUNT(*) FROM follows f2 WHERE f2.follower_id = users.id) AS following_count
    FROM users
    WHERE id = ?
    `,
    [userId],
    (err, row) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: 'DB 오류가 발생했습니다.' });
      }

      if (!row) {
        return res
          .status(404)
          .json({ ok: false, message: '사용자를 찾을 수 없습니다.' });
      }

      // 기본 프로필 + 팔로워/팔로잉 집계 응답
      res.json({
        ok: true,
        message: '내 정보를 불러왔습니다.',
        id: row.id,
        name: row.name,
        nickname: row.nickname,
        bio: row.bio || null,
        about: row.about || null,
        email: row.email,
        is_admin: !!row.is_admin,
        is_verified: !!row.is_verified,
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

// 7-1-1) 내가 팔로잉 중인 사용자 목록 조회
router.get('/me/followings', authRequired, (req, res) => {
  const userId = req.user.id;

  db.all(
    `
    SELECT
      u.id,
      u.name,
      u.nickname,
      u.bio,
      u.about,
      u.email,
      (SELECT COUNT(*) FROM follows f2 WHERE f2.followee_id = u.id) AS follower_count
    FROM follows f
    INNER JOIN users u ON u.id = f.followee_id
    WHERE f.follower_id = ?
    ORDER BY (u.nickname IS NULL OR u.nickname = ''), u.nickname, u.name
    `,
    [userId],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '팔로잉 목록을 불러오는 중 오류가 발생했습니다.' });
      }

      const followings = (rows || []).map((row) => ({
        id: row.id,
        name: row.name,
        nickname: row.nickname,
        bio: row.bio || null,
        about: row.about || null,
        email: row.email,
        follower_count: row.follower_count || 0,
      }));

      return res.json({
        ok: true,
        message: '팔로잉 목록을 불러왔습니다.',
        followings,
      });
    }
  );
});

// 7-2) 내 정보 수정
// - 닉네임/소개/비밀번호 변경을 한 번의 요청에서 처리
router.put('/me', authRequired, (req, res) => {
  const userId = req.user.id;
  const { nickname, currentPw, newPw, bio, about } = req.body || {};

  const fields = [];
  const params = [];

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

  const wantsPwChange = !!newPw;

  if (!wantsPwChange) {
    if (fields.length === 0) {
      return res.status(400).json({
        ok: false,
        message: '변경할 내용을 입력하세요.',
      });
    }

    params.push(userId);

    db.run(
      `
      UPDATE users
      SET ${fields.join(', ')}
      WHERE id = ?
      `,
      params,
      function (updateErr) {
        if (updateErr) {
          console.error(updateErr);
          return res.status(500).json({
            ok: false,
            message: '내 정보 수정 중 오류가 발생했습니다.',
          });
        }

        return res.json({
          ok: true,
          message: '정보가 성공적으로 수정되었습니다.',
        });
      }
    );
    return;
  }

  if (!currentPw) {
    return res.status(400).json({
      ok: false,
      message: '비밀번호를 변경하려면 현재 비밀번호를 입력해주세요.',
    });
  }

  db.get('SELECT pw FROM users WHERE id = ?', [userId], async (err, user) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ ok: false, message: 'DB 오류가 발생했습니다.' });
    }

    if (!user) {
      return res
        .status(404)
        .json({ ok: false, message: '사용자를 찾을 수 없습니다.' });
    }

    const okPw = await bcrypt.compare(currentPw, user.pw);
    if (!okPw) {
      return res
        .status(400)
        .json({ ok: false, message: '현재 비밀번호가 일치하지 않습니다.' });
    }

    if (!newPw || newPw.length < 6) {
      return res.status(400).json({
        ok: false,
        message: '새 비밀번호는 최소 6자 이상이어야 합니다.',
      });
    }

    const newHashedPw = await bcrypt.hash(newPw, 10);
    fields.push('pw = ?');
    params.push(newHashedPw);

    if (fields.length === 0) {
      return res.status(400).json({
        ok: false,
        message: '변경할 내용을 입력하세요.',
      });
    }

    params.push(userId);

    db.run(
      `
      UPDATE users
      SET ${fields.join(', ')}
      WHERE id = ?
      `,
      params,
      function (updateErr) {
        if (updateErr) {
          console.error(updateErr);
          return res.status(500).json({
            ok: false,
            message: '내 정보 수정 중 오류가 발생했습니다.',
          });
        }

        return res.json({
          ok: true,
          message: '정보가 성공적으로 수정되었습니다.',
        });
      }
    );
  });
});

module.exports = router;
