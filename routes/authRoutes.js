// routes/authRoutes.js
// - 회원가입, 인증, 로그인/로그아웃, 프로필 수정 등 인증 관련 API를 담당
const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const db = require('../db');
const { transporter, JWT_SECRET } = require('../config');
const { authRequired } = require('../middleware/auth');
const {
  loginLimiter,
  signupLimiter,
  passwordLimiter,
  otpResendLimiter,
} = require('../middleware/rateLimiters');
const { getBaseUrl } = require('../utils/baseUrl');

const router = express.Router();

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
    // 1) 비밀번호 해시 + 이메일 소문자 정규화
    const hashed = await bcrypt.hash(pw, 10);
    const normalizedEmail = email.trim().toLowerCase();

    // 2) 이메일 OTP 생성 (10분 유효)
    const otpCode = String(crypto.randomInt(100000, 1000000));
    const otpHash = await bcrypt.hash(otpCode, 10);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 10).toISOString();

    // 3) 신규 사용자 저장
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
      VALUES (?, ?, ?, ?, 0, 0, NULL, NULL)
      `,
      [name, nickname, normalizedEmail, hashed],
      function (err) {
        if (err) {
          if (err.message && err.message.includes('UNIQUE')) {
            return res
              .status(400)
              .json({ ok: false, message: '이미 사용 중인 이메일입니다.' });
          }
          console.error(err);
          return res
            .status(500)
            .json({ ok: false, message: 'DB 오류가 발생했습니다.' });
        }

        const otpExpiresMinutes = 10;

        db.run(
          `
          INSERT INTO otp_verifications (user_id, code_hash, expires_at, attempts)
          VALUES (?, ?, ?, 0)
          `,
          [this.lastID, otpHash, expiresAt],
          (otpErr) => {
            if (otpErr) {
              console.error('OTP 저장 오류:', otpErr);
              return res
                .status(500)
                .json({ ok: false, message: 'OTP 저장 중 오류가 발생했습니다.' });
            }

            res.json({
              ok: true,
              message: '인증 번호를 이메일로 발송했습니다.',
              user_id: this.lastID,
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
                      인증 번호는 ${otpExpiresMinutes}분 동안만 유효합니다.
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
          }
        );
      }
    );
  } catch (e) {
    console.error(e);
    return res
      .status(500)
      .json({ ok: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 6-2) 이메일 OTP 인증 처리
router.post('/verify-email', async (req, res) => {
  const { user_id: userId, verification_code: verificationCode } = req.body || {};

  if (!userId || !verificationCode) {
    return res.status(400).json({
      ok: false,
      message: '인증에 필요한 정보가 누락되었습니다.',
    });
  }

  db.get(
    `
    SELECT id, is_verified
    FROM users
    WHERE id = ?
    `,
    [userId],
    (userErr, user) => {
      if (userErr) {
        console.error('사용자 조회 오류:', userErr);
        return res.status(500).json({ ok: false, message: '서버 오류가 발생했습니다.' });
      }

      if (!user) {
        return res.status(404).json({ ok: false, message: '사용자를 찾을 수 없습니다.' });
      }

      if (user.is_verified) {
        return res.json({ ok: true, message: '이미 이메일 인증이 완료된 계정입니다.' });
      }

      db.get(
        `
        SELECT id, code_hash, expires_at, attempts
        FROM otp_verifications
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [userId],
        async (otpErr, otpRow) => {
          if (otpErr) {
            console.error('OTP 조회 오류:', otpErr);
            return res.status(500).json({ ok: false, message: '서버 오류가 발생했습니다.' });
          }

          if (!otpRow) {
            return res.status(400).json({
              ok: false,
              message: '인증 번호가 존재하지 않습니다. 회원가입을 다시 진행해 주세요.',
            });
          }

          const now = Date.now();
          const expiresTime = new Date(otpRow.expires_at).getTime();
          const maxAttempts = 5;

          if (isNaN(expiresTime) || expiresTime < now) {
            return res.status(400).json({
              ok: false,
              message: '인증 번호가 만료되었습니다. 회원가입을 다시 진행해 주세요.',
            });
          }

          if (otpRow.attempts >= maxAttempts) {
            return res.status(400).json({
              ok: false,
              message: '인증 시도 횟수를 초과했습니다. 회원가입을 다시 진행해 주세요.',
            });
          }

          const matches = await bcrypt.compare(String(verificationCode), otpRow.code_hash);

          if (!matches) {
            db.run(
              `
              UPDATE otp_verifications
              SET attempts = attempts + 1
              WHERE id = ?
              `,
              [otpRow.id],
              (attemptErr) => {
                if (attemptErr) {
                  console.error('OTP 시도 횟수 업데이트 오류:', attemptErr);
                }
                return res.status(400).json({
                  ok: false,
                  message: '인증 번호가 올바르지 않습니다.',
                });
              }
            );
            return;
          }

          db.run(
            `
            UPDATE users
            SET is_verified = 1
            WHERE id = ?
            `,
            [userId],
            (updateErr) => {
              if (updateErr) {
                console.error('이메일 인증 업데이트 오류:', updateErr);
                return res.status(500).json({
                  ok: false,
                  message: '이메일 인증에 실패했습니다.',
                });
              }

              db.run(
                `
                DELETE FROM otp_verifications
                WHERE user_id = ?
                `,
                [userId],
                (deleteErr) => {
                  if (deleteErr) {
                    console.error('OTP 삭제 오류:', deleteErr);
                  }
                  return res.json({ ok: true, message: '이메일 인증이 완료되었습니다.' });
                }
              );
            }
          );
        }
      );
    }
  );
});

// 6-2-1) 이메일 OTP 재발송
router.post('/verify-email/resend', otpResendLimiter, async (req, res) => {
  const { user_id: userId, email } = req.body || {};

  if (!userId && !email) {
    return res.status(400).json({
      ok: false,
      message: '재발송에 필요한 정보가 누락되었습니다.',
    });
  }

  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
  const cooldownMs = 1000 * 60;
  const otpExpiresMinutes = 10;

  const query = normalizedEmail
    ? 'SELECT id, name, nickname, email, is_verified FROM users WHERE email = ?'
    : 'SELECT id, name, nickname, email, is_verified FROM users WHERE id = ?';
  const params = normalizedEmail ? [normalizedEmail] : [userId];

  db.get(query, params, (userErr, user) => {
    if (userErr) {
      console.error('사용자 조회 오류:', userErr);
      return res.status(500).json({ ok: false, message: '서버 오류가 발생했습니다.' });
    }

    if (!user) {
      return res.status(404).json({ ok: false, message: '사용자를 찾을 수 없습니다.' });
    }

    if (user.is_verified) {
      return res.json({ ok: true, message: '이미 이메일 인증이 완료된 계정입니다.' });
    }

    db.get(
      `
      SELECT id, created_at
      FROM otp_verifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [user.id],
      async (otpErr, otpRow) => {
        if (otpErr) {
          console.error('OTP 조회 오류:', otpErr);
          return res.status(500).json({ ok: false, message: '서버 오류가 발생했습니다.' });
        }

        if (otpRow && otpRow.created_at) {
          const createdAt = new Date(otpRow.created_at).getTime();
          const elapsedMs = Date.now() - createdAt;
          if (!Number.isNaN(createdAt) && elapsedMs < cooldownMs) {
            const retryAfter = Math.ceil((cooldownMs - elapsedMs) / 1000);
            return res.status(429).json({
              ok: false,
              message: `재발송은 ${retryAfter}초 후에 가능합니다.`,
              retry_after: retryAfter,
            });
          }
        }

        const otpCode = String(crypto.randomInt(100000, 1000000));
        const otpHash = await bcrypt.hash(otpCode, 10);
        const expiresAt = new Date(Date.now() + 1000 * 60 * otpExpiresMinutes).toISOString();

        db.run(
          `
          DELETE FROM otp_verifications
          WHERE user_id = ?
          `,
          [user.id],
          (deleteErr) => {
            if (deleteErr) {
              console.error('OTP 정리 오류:', deleteErr);
            }

            db.run(
              `
              INSERT INTO otp_verifications (user_id, code_hash, expires_at, attempts)
              VALUES (?, ?, ?, 0)
              `,
              [user.id, otpHash, expiresAt],
              (insertErr) => {
                if (insertErr) {
                  console.error('OTP 저장 오류:', insertErr);
                  return res.status(500).json({
                    ok: false,
                    message: 'OTP 저장 중 오류가 발생했습니다.',
                  });
                }

                res.json({
                  ok: true,
                  message: '인증 번호를 다시 발송했습니다.',
                  retry_after: Math.ceil(cooldownMs / 1000),
                });

                transporter.sendMail(
                  {
                    from: `"글숲" <${process.env.GMAIL_USER}>`,
                    to: user.email,
                    subject: '[글숲] 이메일 인증 번호를 다시 확인해주세요',
                    html: `
                      <div style="font-family: 'Noto Sans KR', sans-serif; line-height: 1.6;">
                        <p><strong>${user.nickname || user.name}님, 안녕하세요.</strong></p>
                        <p>요청하신 인증 번호를 다시 보내드립니다. 아래 번호를 입력해 이메일 인증을 완료해주세요.</p>
                        <p style="margin: 16px 0; font-size: 1.5rem; font-weight: 700; letter-spacing: 0.2em;">
                          ${otpCode}
                        </p>
                        <p style="font-size: 0.9rem; color:#888;">
                          인증 번호는 ${otpExpiresMinutes}분 동안만 유효합니다.
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
              }
            );
          }
        );
      }
    );
  });
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

  db.get(
    'SELECT id, name, is_verified FROM users WHERE email = ?',
    [normalizedEmail],
    (err, user) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ ok: false, message: '서버 오류가 발생했습니다.' });
      }

      if (!user) {
        return res.json({
          ok: true,
          message:
            '입력하신 이메일이 등록되어 있다면, 비밀번호 재설정 메일이 발송됩니다.',
        });
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
          transporter.sendMail(
            {
              from: `"글숲" <${process.env.GMAIL_USER}>`,
              to: normalizedEmail,
              subject: '[글숲] 비밀번호 재설정 안내',
              html: `
                <div style="font-family: 'Noto Sans KR', sans-serif; line-height: 1.6;">
                  <p><strong>${user.name}님, 안녕하세요.</strong></p>
                  <p>아래 버튼을 눌러 비밀번호를 재설정해주세요.</p>
                  <p style="margin: 24px 0;">
                    <a href="${resetUrl}"
                       style="display:inline-block;padding:10px 18px;background:#2e8b57;color:#fff;
                              text-decoration:none;border-radius:6px;">
                      비밀번호 재설정하기
                    </a>
                  </p>
                  <p>만약 위 버튼이 동작하지 않으면 아래 링크를 복사해서 주소창에 붙여넣어 주세요.</p>
                  <p style="font-size:0.9rem;word-break:break-all;">${resetUrl}</p>
                  <p style="font-size:0.9rem;color:#888;">이 링크는 1시간 동안만 유효합니다.</p>
                </div>
              `,
            },
            (mailErr, info) => {
              if (mailErr) {
                console.error('비밀번호 재설정 메일 전송 오류:', mailErr);
                return res.status(500).json({
                  ok: false,
                  message:
                    '메일 전송 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
                });
              }

              console.log('reset mail sent:', info.messageId);
              return res.json({
                ok: true,
                message:
                  '입력하신 이메일이 등록되어 있다면, 비밀번호 재설정 메일이 발송되었습니다.',
              });
            }
          );
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

      if (!user) {
        return res
          .status(400)
          .json({ ok: false, message: '등록되지 않은 이메일입니다.' });
      }

      const match = await bcrypt.compare(pw, user.pw);
      if (!match) {
        return res
          .status(400)
          .json({ ok: false, message: '비밀번호가 틀렸습니다.' });
      }

      if (!user.is_verified) {
        return res.status(403).json({
          ok: false,
          message:
            '이메일 인증이 완료되지 않았습니다. 메일함에서 인증 링크를 확인해주세요.',
        });
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
        { expiresIn: '2h' }
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
